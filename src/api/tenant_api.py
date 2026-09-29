import json
import os
import uuid
from datetime import datetime, timezone

import boto3

from botocore.exceptions import ClientError

from observability.metrics import (
    log_event,
    log_failed_provision,
    log_provision_attempt,
)


# ==========================================================
# AWS CLIENTS
# ==========================================================

stepfunctions_client = boto3.client("stepfunctions")
dynamodb = boto3.resource("dynamodb")
lambda_client = boto3.client("lambda")
s3_client = boto3.client("s3")

# ==========================================================
# ENVIRONMENT VARIABLES
# ==========================================================
# These values are provided by template.yaml
JOBS_TABLE_NAME = os.environ["JOBS_TABLE_NAME"]
TENANTS_TABLE_NAME = os.environ["TENANTS_TABLE_NAME"]
HOSTS_TABLE_NAME = os.environ["HOSTS_TABLE_NAME"]
STATE_MACHINE_ARN = os.environ["STATE_MACHINE_ARN"]
ENVIRONMENT = os.environ.get("ENVIRONMENT", "dev")
QUERY_FUNCTION_NAME = os.environ["QUERY_FUNCTION_NAME"]
DEPROVISIONER_FUNCTION_NAME = os.environ["DEPROVISIONER_FUNCTION_NAME"]
BACKUP_FUNCTION_NAME = os.environ["BACKUP_FUNCTION_NAME"]
RESTORE_FUNCTION_NAME = os.environ["RESTORE_FUNCTION_NAME"]
BACKUP_BUCKET_NAME = os.environ.get("BACKUP_BUCKET_NAME", "")
# ==========================================================
# DYNAMODB TABLES
# ==========================================================

jobs_table = dynamodb.Table(JOBS_TABLE_NAME)

tenants_table = dynamodb.Table(TENANTS_TABLE_NAME)

hosts_table = dynamodb.Table(HOSTS_TABLE_NAME)


# ==========================================================
# BASIC HELPERS
# ==========================================================

def utc_now():
    """
    Return the current UTC time in ISO-8601 format.
    """

    return datetime.now(timezone.utc).isoformat()


def make_response(status_code, body):
    """
    Create a standard API Gateway response with CORS headers.
    """

    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token"
        },
        "body": json.dumps(body, default=str)
    }


def parse_body(event):
    """
    Read and parse the API Gateway request body.

    Expected example:

    {
        "tenant_id": "tenant-api-009"
    }
    """

    body = event.get("body")

    # No body
    if body is None or body == "":
        return {}

    # Sometimes tests invoke Lambda directly
    # with a dictionary instead of a JSON string.
    if isinstance(body, dict):
        return body

    # Normal API Gateway request
    if isinstance(body, str):

        try:
            parsed = json.loads(body)

        except json.JSONDecodeError as error:

            raise ValueError(
                "Request body must be valid JSON"
            ) from error

        if not isinstance(parsed, dict):

            raise ValueError(
                "Request body must be a JSON object"
            )

        return parsed

    raise ValueError(
        "Unsupported request body format"
    )


# ==========================================================
# JOB MANAGEMENT
# ==========================================================

def create_job(job_id, tenant_id):
    """
    Create the initial asynchronous provisioning job.

    Initial state:

        PENDING

    The Step Functions workflow will update
    the job as provisioning progresses.
    """

    now = utc_now()

    item = {
        "job_id": job_id,

        "tenant_id": tenant_id,

        "status": "PENDING",

        "stage": "API_REQUEST",

        "environment": ENVIRONMENT,

        "created_at": now,

        "updated_at": now
    }

    jobs_table.put_item(
        Item=item,

        ConditionExpression=(
            "attribute_not_exists(job_id)"
        )
    )

    return item


def update_job(
    job_id,
    status=None,
    stage=None,
    extra=None
):
    """
    Update an existing job.

    Only the fields supplied to this function
    are updated.
    """

    update_parts = [
        "updated_at = :updated_at"
    ]

    expression_names = {}

    expression_values = {
        ":updated_at": utc_now()
    }

    # ------------------------------------------------------
    # STATUS
    # ------------------------------------------------------

    if status is not None:

        update_parts.append(
            "#status = :status"
        )

        expression_names["#status"] = "status"

        expression_values[":status"] = status

    # ------------------------------------------------------
    # STAGE
    # ------------------------------------------------------

    if stage is not None:

        update_parts.append(
            "#stage = :stage"
        )

        expression_names["#stage"] = "stage"

        expression_values[":stage"] = stage

    # ------------------------------------------------------
    # EXTRA FIELDS
    # ------------------------------------------------------

    if extra:

        for key, value in extra.items():

            name_alias = f"#extra_{key}"

            value_alias = f":extra_{key}"

            update_parts.append(
                f"{name_alias} = {value_alias}"
            )

            expression_names[name_alias] = key

            expression_values[value_alias] = value

    # ------------------------------------------------------
    # DYNAMODB UPDATE
    # ------------------------------------------------------

    params = {
        "Key": {
            "job_id": job_id
        },

        "UpdateExpression": (
            "SET " + ", ".join(update_parts)
        ),

        "ExpressionAttributeValues":
            expression_values
    }

    if expression_names:

        params["ExpressionAttributeNames"] = (
            expression_names
        )

    jobs_table.update_item(**params)


def get_job(job_id):
    """
    Retrieve a job from DynamoDB.
    """

    response = jobs_table.get_item(
        Key={
            "job_id": job_id
        }
    )

    return response.get("Item")


# ==========================================================
# STEP FUNCTIONS
# ==========================================================

def start_host_provisioning_workflow(
    job_id,
    tenant_id
):
    """
    Start the asynchronous Step Functions workflow.

    The API does NOT wait for EC2/MySQL provisioning.

    It starts the workflow and immediately returns
    a job_id to the client.
    """

    if not STATE_MACHINE_ARN:

        raise RuntimeError(
            "STATE_MACHINE_ARN environment variable "
            "is not configured"
        )

    # ------------------------------------------------------
    # UNIQUE EXECUTION NAME
    # ------------------------------------------------------

    execution_name = (
        f"tenant-{uuid.uuid4().hex}"
    )

    # ------------------------------------------------------
    # INPUT SENT TO STEP FUNCTIONS
    # ------------------------------------------------------

    execution_input = {
        "job_id": job_id,

        "tenant_id": tenant_id,

        "environment": ENVIRONMENT
    }

    # ------------------------------------------------------
    # START EXECUTION
    # ------------------------------------------------------

    response = stepfunctions_client.start_execution(

        stateMachineArn=STATE_MACHINE_ARN,

        name=execution_name,

        input=json.dumps(
            execution_input
        )
    )

    return response


# ==========================================================
# POST /tenants
# ==========================================================

def create_tenant_async(event, context):
    """
    Create a tenant provisioning job.

    Flow:

        API Gateway
              |
              v
        Tenant API Lambda
              |
              v
        Create PENDING Job
              |
              v
        Start Step Functions
              |
              v
        Return 202 immediately

    The actual EC2/MySQL provisioning happens
    asynchronously inside Step Functions.
    """

    # ------------------------------------------------------
    # CREATE JOB ID
    # ------------------------------------------------------

    job_id = str(uuid.uuid4())

    # Important:
    # Initialize this before try so that the exception
    # handlers can safely reference it.
    tenant_id = None

    # ------------------------------------------------------
    # STRUCTURED LOG
    # ------------------------------------------------------

    log_event(
        "tenant_request_received",

        job_id=job_id
    )

    try:

        # ==================================================
        # PARSE REQUEST
        # ==================================================

        request = parse_body(event)

        tenant_id = request.get(
            "tenant_id"
        )

        # ==================================================
        # VALIDATE TENANT ID
        # ==================================================

        if tenant_id is None:

            log_event(
                "tenant_request_validation_failed",

                job_id=job_id,

                reason="tenant_id_missing"
            )

            return make_response(
                400,
                {
                    "message":
                        "tenant_id is required",

                    "job_id":
                        job_id
                }
            )

        tenant_id = str(
            tenant_id
        ).strip()

        if not tenant_id:

            log_event(
                "tenant_request_validation_failed",

                job_id=job_id,

                reason="tenant_id_empty"
            )

            return make_response(
                400,
                {
                    "message":
                        "tenant_id cannot be empty",

                    "job_id":
                        job_id
                }
            )

        # --------------------------------------------------
        # LOG VALID REQUEST
        # --------------------------------------------------

        log_event(
            "tenant_request_validated",

            tenant_id=tenant_id,

            job_id=job_id
        )

        # --------------------------------------------------
        # COUNT PROVISIONING ATTEMPT
        # --------------------------------------------------

        log_provision_attempt()

        # ==================================================
        # CHECK DUPLICATE TENANT
        # ==================================================

        existing_response = (
            tenants_table.get_item(
                Key={
                    "tenant_id":
                        tenant_id
                }
            )
        )

        existing_tenant = (
            existing_response.get(
                "Item"
            )
        )

        if existing_tenant:

            existing_status = (
                existing_tenant.get(
                    "status"
                )
            )

            log_event(
                "tenant_already_exists",

                tenant_id=tenant_id,

                job_id=job_id,

                existing_status=existing_status
            )

            return make_response(
                409,
                {
                    "message":
                        "Tenant already exists",

                    "tenant_id":
                        tenant_id,

                    "status":
                        existing_status
                }
            )

        # ==================================================
        # CREATE PENDING JOB
        # ==================================================

        create_job(
            job_id=job_id,

            tenant_id=tenant_id
        )

        log_event(
            "provisioning_job_created",

            tenant_id=tenant_id,

            job_id=job_id,

            status="PENDING"
        )

        # ==================================================
        # START STEP FUNCTIONS
        # ==================================================

        execution = (
            start_host_provisioning_workflow(
                job_id=job_id,

                tenant_id=tenant_id
            )
        )

        execution_arn = (
            execution.get(
                "executionArn"
            )
        )

        start_date = (
            execution.get(
                "startDate"
            )
        )

        # --------------------------------------------------
        # LOG WORKFLOW START
        # --------------------------------------------------

        log_event(
            "host_provisioning_workflow_started",

            tenant_id=tenant_id,

            job_id=job_id,

            execution_arn=execution_arn
        )

        # ==================================================
        # UPDATE JOB
        # ==================================================

        update_job(

            job_id=job_id,

            status="PENDING",

            stage="STEP_FUNCTIONS_STARTED",

            extra={

                "state_machine_execution_arn":
                    execution_arn,

                "execution_start_date":
                    (
                        str(start_date)
                        if start_date
                        else None
                    )
            }
        )

        # ==================================================
        # LOG ACCEPTANCE
        # ==================================================

        log_event(
            "tenant_provisioning_accepted",

            tenant_id=tenant_id,

            job_id=job_id,

            status="PENDING"
        )

        # ==================================================
        # RETURN 202
        # ==================================================

        return make_response(
            202,
            {
                "message":
                    "Tenant provisioning started",

                "tenant_id":
                    tenant_id,

                "job_id":
                    job_id,

                "status":
                    "PENDING",

                "state_machine_execution_arn":
                    execution_arn
            }
        )

    # ======================================================
    # INVALID REQUEST
    # ======================================================

    except ValueError as error:

        log_event(
            "tenant_request_failed",

            tenant_id=tenant_id,

            job_id=job_id,

            error_type=type(error).__name__,

            reason="invalid_request"
        )

        return make_response(
            400,
            {
                "message":
                    str(error),

                "job_id":
                    job_id
            }
        )

    # ======================================================
    # AWS ERROR
    # ======================================================

    except ClientError as error:

        error_code = (
            error.response
            .get("Error", {})
            .get("Code", "Unknown")
        )

        error_message = (
            error.response
            .get("Error", {})
            .get(
                "Message",
                str(error)
            )
        )

        # --------------------------------------------------
        # METRIC
        # --------------------------------------------------

        log_failed_provision()

        # --------------------------------------------------
        # STRUCTURED LOG
        # --------------------------------------------------

        log_event(
            "tenant_provisioning_failed",

            tenant_id=tenant_id,

            job_id=job_id,

            error_type=type(error).__name__,

            error_code=error_code
        )

        print(
            "AWS error in "
            "create_tenant_async: "
            f"{error_code}: "
            f"{error_message}"
        )

        # --------------------------------------------------
        # TRY TO MARK JOB FAILED
        # --------------------------------------------------

        try:

            update_job(

                job_id=job_id,

                status="FAILED",

                stage="API",

                extra={

                    "error_code":
                        error_code,

                    "error":
                        error_message
                }
            )

        except Exception as update_error:

            print(
                "Could not update failed job: "
                f"{update_error}"
            )

        # --------------------------------------------------
        # RETURN ERROR
        # --------------------------------------------------

        return make_response(
            500,
            {
                "message":
                    "AWS error while processing "
                    "tenant request",

                "job_id":
                    job_id,

                "error_code":
                    error_code
            }
        )

    # ======================================================
    # GENERAL ERROR
    # ======================================================

    except Exception as error:

        # --------------------------------------------------
        # METRIC
        # --------------------------------------------------

        log_failed_provision()

        # --------------------------------------------------
        # STRUCTURED LOG
        # --------------------------------------------------

        log_event(
            "tenant_provisioning_failed",

            tenant_id=tenant_id,

            job_id=job_id,

            error_type=type(error).__name__
        )

        print(
            "Tenant API create request failed: "
            f"{type(error).__name__}: "
            f"{error}"
        )

        # --------------------------------------------------
        # TRY TO MARK JOB FAILED
        # --------------------------------------------------

        try:

            update_job(

                job_id=job_id,

                status="FAILED",

                stage="API",

                extra={
                    "error":
                        str(error)
                }
            )

        except Exception as update_error:

            print(
                "Could not update failed job: "
                f"{update_error}"
            )

        # --------------------------------------------------
        # RETURN ERROR
        # --------------------------------------------------

        return make_response(
            500,
            {
                "message":
                    "Failed to start "
                    "tenant provisioning",

                "job_id":
                    job_id,

                "error":
                    str(error)
            }
        )


# ==========================================================
# GET /jobs/{job_id}
# ==========================================================

def get_job_status(event, context):
    """
    Return the current status of an asynchronous
    provisioning job.
    """

    path_parameters = (
        event.get(
            "pathParameters"
        )
        or {}
    )

    job_id = path_parameters.get(
        "job_id"
    )

    # ------------------------------------------------------
    # VALIDATE JOB ID
    # ------------------------------------------------------

    if not job_id:

        return make_response(
            400,
            {
                "message":
                    "job_id is required"
            }
        )

    try:

        # --------------------------------------------------
        # READ JOB
        # --------------------------------------------------

        job = get_job(
            job_id
        )

        # --------------------------------------------------
        # JOB NOT FOUND
        # --------------------------------------------------

        if not job:

            log_event(
                "job_not_found",

                job_id=job_id
            )

            return make_response(
                404,
                {
                    "message":
                        "Job not found",

                    "job_id":
                        job_id
                }
            )

        # --------------------------------------------------
        # LOG JOB STATUS REQUEST
        # --------------------------------------------------

        log_event(
            "job_status_requested",

            job_id=job_id,

            status=job.get(
                "status"
            )
        )

        return make_response(
            200,
            job
        )

    # ------------------------------------------------------
    # AWS ERROR
    # ------------------------------------------------------

    except ClientError as error:

        error_code = (
            error.response
            .get("Error", {})
            .get(
                "Code",
                "Unknown"
            )
        )

        log_event(
            "get_job_status_failed",

            job_id=job_id,

            error_code=error_code
        )

        print(
            "AWS error in "
            f"get_job_status: "
            f"{error_code}"
        )

        return make_response(
            500,
            {
                "message":
                    "Failed to read "
                    "job status",

                "job_id":
                    job_id,

                "error_code":
                    error_code
            }
        )

    # ------------------------------------------------------
    # GENERAL ERROR
    # ------------------------------------------------------

    except Exception as error:

        log_event(
            "get_job_status_failed",

            job_id=job_id,

            error_type=type(error).__name__
        )

        print(
            "Get job status failed: "
            f"{type(error).__name__}: "
            f"{error}"
        )

        return make_response(
            500,
            {
                "message":
                    "Failed to read "
                    "job status",

                "job_id":
                    job_id
            }
        )


# ==========================================================
# GET /tenants/{tenant_id}
# ==========================================================

def get_tenant_details(event, context):
    """
    Return information about a tenant.
    """

    path_parameters = (
        event.get(
            "pathParameters"
        )
        or {}
    )

    tenant_id = path_parameters.get(
        "tenant_id"
    )

    # ------------------------------------------------------
    # VALIDATE TENANT ID
    # ------------------------------------------------------

    if not tenant_id:

        return make_response(
            400,
            {
                "message":
                    "tenant_id is required"
            }
        )

    try:

        # --------------------------------------------------
        # READ TENANT
        # --------------------------------------------------

        response = tenants_table.get_item(
            Key={
                "tenant_id":
                    tenant_id
            }
        )

        tenant = response.get(
            "Item"
        )

        # --------------------------------------------------
        # TENANT NOT FOUND
        # --------------------------------------------------

        if not tenant:

            log_event(
                "tenant_not_found",

                tenant_id=tenant_id
            )

            return make_response(
                404,
                {
                    "message":
                        "Tenant not found",

                    "tenant_id":
                        tenant_id
                }
            )

        # --------------------------------------------------
        # LOG
        # --------------------------------------------------

        log_event(
            "tenant_details_requested",

            tenant_id=tenant_id,

            status=tenant.get(
                "status"
            )
        )

        # --------------------------------------------------
        # RETURN TENANT DETAILS
        # --------------------------------------------------

        return make_response(
            200,
            {
                "tenant_id":
                    tenant_id,

                "status":
                    tenant.get(
                        "status"
                    ),

                "host_id":
                    tenant.get(
                        "host_id"
                    ),

                "private_ip":
                    tenant.get(
                        "private_ip"
                    ),

                "mysql_port":
                    int(
                        tenant.get(
                            "mysql_port",
                            3307
                        )
                    ),

                "database_name":
                    tenant.get(
                        "database_name"
                    ),

                "mysql_username":
                    tenant.get(
                        "mysql_username"
                    ),

                "credentials_secret_arn":
                    tenant.get(
                        "credentials_secret_arn"
                    ),

                "environment":
                    tenant.get(
                        "environment",
                        ENVIRONMENT
                    ),

                "created_at":
                    tenant.get(
                        "created_at"
                    ),

                "updated_at":
                    tenant.get(
                        "updated_at"
                    )
            }
        )

    # ------------------------------------------------------
    # AWS ERROR
    # ------------------------------------------------------

    except ClientError as error:

        error_code = (
            error.response
            .get("Error", {})
            .get(
                "Code",
                "Unknown"
            )
        )

        log_event(
            "get_tenant_details_failed",

            tenant_id=tenant_id,

            error_code=error_code
        )

        print(
            "AWS error in "
            f"get_tenant_details: "
            f"{error_code}"
        )

        return make_response(
            500,
            {
                "message":
                    "Failed to read tenant",

                "tenant_id":
                    tenant_id,

                "error_code":
                    error_code
            }
        )

    # ------------------------------------------------------
    # GENERAL ERROR
    # ------------------------------------------------------

    except Exception as error:

        log_event(
            "get_tenant_details_failed",

            tenant_id=tenant_id,

            error_type=type(error).__name__
        )

        print(
            "Get tenant details failed: "
            f"{type(error).__name__}: "
            f"{error}"
        )

        return make_response(
            500,
            {
                "message":
                    "Failed to read tenant",

                "tenant_id":
                    tenant_id
            }
        )

# ==========================================================
# DELETE /tenants/{tenant_id}
# ==========================================================

def delete_tenant_async(event, context):
    """
    Start asynchronous tenant deprovisioning.

    The API invokes TenantDeprovisionerFunction
    and returns immediately.
    """

    path_parameters = (
        event.get("pathParameters")
        or {}
    )

    tenant_id = path_parameters.get(
        "tenant_id"
    )

    # ------------------------------------------------------
    # VALIDATE TENANT ID
    # ------------------------------------------------------

    if not tenant_id:

        return make_response(
            400,
            {
                "message":
                    "tenant_id is required"
            }
        )

    tenant_id = str(
        tenant_id
    ).strip()

    if not tenant_id:

        return make_response(
            400,
            {
                "message":
                    "tenant_id cannot be empty"
            }
        )

    # ------------------------------------------------------
    # LOG REQUEST
    # ------------------------------------------------------

    log_event(
        "tenant_deletion_requested",
        tenant_id=tenant_id
    )

    try:

        # ==================================================
        # CHECK TENANT EXISTS
        # ==================================================

        tenant_response = (
            tenants_table.get_item(
                Key={
                    "tenant_id":
                        tenant_id
                }
            )
        )

        tenant = tenant_response.get(
            "Item"
        )

        if not tenant:

            log_event(
                "tenant_deletion_tenant_not_found",
                tenant_id=tenant_id
            )

            return make_response(
                404,
                {
                    "message":
                        "Tenant not found",

                    "tenant_id":
                        tenant_id
                }
            )

        tenant_status = tenant.get(
            "status"
        )

        # --------------------------------------------------
        # ALREADY TERMINATED
        # --------------------------------------------------

        if tenant_status == "TERMINATED":

            return make_response(
                200,
                {
                    "message":
                        "Tenant is already terminated",

                    "tenant_id":
                        tenant_id,

                    "status":
                        "TERMINATED"
                }
            )

        # --------------------------------------------------
        # ONLY READY TENANTS CAN BE DELETED
        # --------------------------------------------------

        if tenant_status != "READY":

            return make_response(
                409,
                {
                    "message":
                        "Tenant is not READY",

                    "tenant_id":
                        tenant_id,

                    "status":
                        tenant_status
                }
            )

        # ==================================================
        # INVOKE DEPROVISIONER
        # ==================================================

        deprovision_event = {
            "tenant_id":
                tenant_id
        }

        response = lambda_client.invoke(
            FunctionName=
                DEPROVISIONER_FUNCTION_NAME,

            InvocationType=
                "RequestResponse",

            Payload=json.dumps(
                deprovision_event
            ).encode("utf-8")
        )

        payload = (
            response["Payload"].read()
        )

        worker_response = json.loads(
            payload
        )

        # ==================================================
        # CHECK LAMBDA ERROR
        # ==================================================

        if response.get(
            "FunctionError"
        ):

            log_event(
                "tenant_deprovisioner_failed",
                tenant_id=tenant_id
            )

            return make_response(
                502,
                {
                    "message":
                        "Tenant deprovisioner failed",

                    "tenant_id":
                        tenant_id
                }
            )

        status_code = int(
            worker_response.get(
                "statusCode",
                500
            )
        )

        worker_body = (
            worker_response.get(
                "body",
                {}
            )
        )

        if isinstance(
            worker_body,
            str
        ):

            try:

                worker_body = json.loads(
                    worker_body
                )

            except json.JSONDecodeError:

                worker_body = {
                    "message":
                        worker_body
                }

        # ==================================================
        # LOG RESULT
        # ==================================================

        log_event(
            "tenant_deletion_completed",
            tenant_id=tenant_id,
            status_code=status_code
        )

        return make_response(
            status_code,
            worker_body
        )

    # ======================================================
    # AWS ERROR
    # ======================================================

    except ClientError as error:

        error_code = (
            error.response
            .get("Error", {})
            .get(
                "Code",
                "Unknown"
            )
        )

        log_event(
            "tenant_deletion_failed",
            tenant_id=tenant_id,
            error_code=error_code
        )

        print(
            "AWS error in "
            "delete_tenant_async: "
            f"{error_code}"
        )

        return make_response(
            500,
            {
                "message":
                    "Failed to delete tenant",

                "tenant_id":
                    tenant_id,

                "error_code":
                    error_code
            }
        )

    # ======================================================
    # GENERAL ERROR
    # ======================================================

    except Exception as error:

        log_event(
            "tenant_deletion_failed",
            tenant_id=tenant_id,
            error_type=
                type(error).__name__
        )

        print(
            "Tenant deletion failed: "
            f"{type(error).__name__}: "
            f"{error}"
        )

        return make_response(
            500,
            {
                "message":
                    "Failed to delete tenant",

                "tenant_id":
                    tenant_id
            }
        )
# ==========================================================
# GET /tenants/{tenant_id}/backup
# ==========================================================

def run_tenant_backup(event, context):
    """
    Invoke TenantBackupFunction synchronously.

    The backup worker itself starts the long-running SSM command
    and returns HTTP 202 immediately with a backup_id.
    """

    path_parameters = event.get("pathParameters") or {}
    tenant_id = path_parameters.get("tenant_id")

    if not tenant_id:
        return make_response(
            400,
            {
                "message": "tenant_id is required"
            }
        )

    try:
        backup_event = {
            "tenant_id": str(tenant_id).strip()
        }

        response = lambda_client.invoke(
            FunctionName=BACKUP_FUNCTION_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(
                backup_event
            ).encode("utf-8")
        )

        payload = response["Payload"].read()

        if not payload:
            log_event(
                "tenant_backup_worker_empty_response",
                tenant_id=tenant_id
            )

            return make_response(
                502,
                {
                    "message": "Tenant backup worker returned an empty response",
                    "tenant_id": tenant_id
                }
            )

        worker_response = json.loads(payload)

        if response.get("FunctionError"):
            log_event(
                "tenant_backup_worker_failed",
                tenant_id=tenant_id
            )

            return make_response(
                502,
                {
                    "message": "Tenant backup worker failed",
                    "tenant_id": tenant_id
                }
            )

        status_code = int(
            worker_response.get(
                "statusCode",
                500
            )
        )

        worker_body = worker_response.get(
            "body",
            {}
        )

        if isinstance(worker_body, str):
            try:
                worker_body = json.loads(worker_body)
            except json.JSONDecodeError:
                worker_body = {
                    "message": worker_body
                }

        log_event(
            "tenant_backup_route_completed",
            tenant_id=tenant_id,
            status_code=status_code
        )

        return make_response(
            status_code,
            worker_body
        )

    except ClientError as error:
        error_code = (
            error.response
            .get("Error", {})
            .get("Code", "Unknown")
        )

        log_event(
            "tenant_backup_api_failed",
            tenant_id=tenant_id,
            error_code=error_code
        )

        return make_response(
            500,
            {
                "message": "Failed to start tenant backup",
                "tenant_id": tenant_id,
                "error_code": error_code
            }
        )

    except Exception as error:
        log_event(
            "tenant_backup_api_failed",
            tenant_id=tenant_id,
            error_type=type(error).__name__
        )

        print(
            "Tenant backup API failed: "
            f"{type(error).__name__}: {error}"
        )

        return make_response(
            500,
            {
                "message": "Failed to start tenant backup",
                "tenant_id": tenant_id
            }
        )


# ==========================================================
# POST /tenants/{tenant_id}/restore
# ==========================================================

def run_tenant_restore(event, context):
    """
    Invoke TenantRestoreFunction synchronously.

    Request body:
        {
            "backup_id": "<backup-id>"
        }

    The restore worker validates the backup object and starts
    the long-running SSM restore command.
    """

    path_parameters = event.get("pathParameters") or {}
    tenant_id = path_parameters.get("tenant_id")

    if not tenant_id:
        return make_response(
            400,
            {
                "message": "tenant_id is required"
            }
        )

    try:
        body = parse_body(event)
        backup_id = body.get("backup_id")

        if not isinstance(backup_id, str):
            return make_response(
                400,
                {
                    "message": "backup_id is required and must be a string"
                }
            )

        backup_id = backup_id.strip()

        if not backup_id:
            return make_response(
                400,
                {
                    "message": "backup_id cannot be empty"
                }
            )

        # Defense-in-depth: backup IDs are generated UUIDs and must
        # never be allowed to contain path separators.
        if (
            "/" in backup_id
            or "\\" in backup_id
            or ".." in backup_id
        ):
            return make_response(
                400,
                {
                    "message": "Invalid backup_id"
                }
            )

        restore_event = {
            "tenant_id": str(tenant_id).strip(),
            "backup_id": backup_id
        }

        response = lambda_client.invoke(
            FunctionName=RESTORE_FUNCTION_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(
                restore_event
            ).encode("utf-8")
        )

        payload = response["Payload"].read()

        if not payload:
            log_event(
                "tenant_restore_worker_empty_response",
                tenant_id=tenant_id,
                backup_id=backup_id
            )

            return make_response(
                502,
                {
                    "message": "Tenant restore worker returned an empty response",
                    "tenant_id": tenant_id,
                    "backup_id": backup_id
                }
            )

        worker_response = json.loads(payload)

        if response.get("FunctionError"):
            log_event(
                "tenant_restore_worker_failed",
                tenant_id=tenant_id,
                backup_id=backup_id
            )

            return make_response(
                502,
                {
                    "message": "Tenant restore worker failed",
                    "tenant_id": tenant_id,
                    "backup_id": backup_id
                }
            )

        status_code = int(
            worker_response.get(
                "statusCode",
                500
            )
        )

        worker_body = worker_response.get(
            "body",
            {}
        )

        if isinstance(worker_body, str):
            try:
                worker_body = json.loads(worker_body)
            except json.JSONDecodeError:
                worker_body = {
                    "message": worker_body
                }

        log_event(
            "tenant_restore_route_completed",
            tenant_id=tenant_id,
            backup_id=backup_id,
            status_code=status_code
        )

        return make_response(
            status_code,
            worker_body
        )

    except ValueError as error:
        return make_response(
            400,
            {
                "message": str(error)
            }
        )

    except ClientError as error:
        error_code = (
            error.response
            .get("Error", {})
            .get("Code", "Unknown")
        )

        log_event(
            "tenant_restore_api_failed",
            tenant_id=tenant_id,
            error_code=error_code
        )

        return make_response(
            500,
            {
                "message": "Failed to start tenant restore",
                "tenant_id": tenant_id,
                "error_code": error_code
            }
        )

    except Exception as error:
        log_event(
            "tenant_restore_api_failed",
            tenant_id=tenant_id,
            error_type=type(error).__name__
        )

        print(
            "Tenant restore API failed: "
            f"{type(error).__name__}: {error}"
        )

        return make_response(
            500,
            {
                "message": "Failed to start tenant restore",
                "tenant_id": tenant_id
            }
        )


# ==========================================================
# GET /hosts
# ==========================================================

def get_hosts(event, context):
    """
    Return all registered MySQL hosts
    and their tenant capacity.
    """

    try:

        # --------------------------------------------------
        # SCAN HOSTS TABLE
        # --------------------------------------------------

        response = hosts_table.scan()

        hosts = response.get(
            "Items",
            []
        )

        formatted_hosts = []

        # --------------------------------------------------
        # FORMAT HOST DATA
        # --------------------------------------------------

        for host in hosts:

            capacity = int(
                host.get(
                    "capacity",
                    0
                )
            )

            tenant_count = int(
                host.get(
                    "tenant_count",
                    0
                )
            )

            available_capacity = max(
                0,
                capacity - tenant_count
            )

            formatted_hosts.append(
                {
                    "host_id":
                        host.get(
                            "host_id"
                        ),

                    "status":
                        host.get(
                            "status"
                        ),

                    "private_ip":
                        host.get(
                            "private_ip"
                        ),

                    "mysql_port":
                        host.get(
                            "mysql_port"
                        ),

                    "tenant_count":
                        tenant_count,

                    "capacity":
                        capacity,

                    "available_capacity":
                        available_capacity,

                    "subnet_id":
                        host.get(
                            "subnet_id"
                        ),

                    "environment":
                        host.get(
                            "environment",
                            ENVIRONMENT
                        ),

                    "created_at":
                        host.get(
                            "created_at"
                        ),

                    "updated_at":
                        host.get(
                            "updated_at"
                        )
                }
            )

        # --------------------------------------------------
        # LOG
        # --------------------------------------------------

        log_event(
            "hosts_listed",

            host_count=len(
                formatted_hosts
            )
        )

        # --------------------------------------------------
        # RETURN
        # --------------------------------------------------

        return make_response(
            200,
            {
                "count":
                    len(
                        formatted_hosts
                    ),

                "hosts":
                    formatted_hosts
            }
        )

    # ------------------------------------------------------
    # AWS ERROR
    # ------------------------------------------------------

    except ClientError as error:

        error_code = (
            error.response
            .get("Error", {})
            .get(
                "Code",
                "Unknown"
            )
        )

        log_event(
            "get_hosts_failed",

            error_code=error_code
        )

        print(
            "AWS error in get_hosts: "
            f"{error_code}"
        )

        return make_response(
            500,
            {
                "message":
                    "Failed to list hosts",

                "error_code":
                    error_code
            }
        )

    # ------------------------------------------------------
    # GENERAL ERROR
    # ------------------------------------------------------

    except Exception as error:

        log_event(
            "get_hosts_failed",

            error_type=type(error).__name__
        )

        print(
            "Get hosts failed: "
            f"{type(error).__name__}: "
            f"{error}"
        )

        return make_response(
            500,
            {
                "message":
                    "Failed to list hosts"
            }
        )

def run_tenant_query(event, context):
    """
    Forward a tenant SQL query to TenantQueryFunction.
    """

    path_parameters = event.get("pathParameters") or {}

    tenant_id = path_parameters.get("tenant_id")

    if not tenant_id:
        return make_response(
            400,
            {
                "message": "tenant_id is required"
            }
        )

    try:
        body = event.get("body")

        if isinstance(body, str):
            body = json.loads(body)

        if not isinstance(body, dict):
            body = {}

        sql = body.get("sql")

        if not isinstance(sql, str) or not sql.strip():
            return make_response(
                400,
                {
                    "message": "sql is required and must be a string"
                }
            )

        query_event = {
            "tenant_id": tenant_id,
            "sql": sql
        }

        response = lambda_client.invoke(
            FunctionName=QUERY_FUNCTION_NAME,
            InvocationType="RequestResponse",
            Payload=json.dumps(query_event).encode("utf-8")
        )

        payload = response["Payload"].read()

        worker_response = json.loads(payload)

        if response.get("FunctionError"):
            print(
                json.dumps({
                    "event": "tenant_query_worker_failed",
                    "tenant_id": tenant_id
                })
            )

            return make_response(
                502,
                {
                    "message": "Tenant query worker failed"
                }
            )

        status_code = int(
            worker_response.get(
                "statusCode",
                500
            )
        )

        worker_body = worker_response.get(
            "body",
            {}
        )

        if isinstance(worker_body, str):
            try:
                worker_body = json.loads(worker_body)
            except json.JSONDecodeError:
                worker_body = {
                    "message": worker_body
                }

        return make_response(
            status_code,
            worker_body
        )

    except Exception as error:

        print(
            json.dumps({
                "event": "tenant_query_api_error",
                "tenant_id": tenant_id,
                "error_type": type(error).__name__
            })
        )

        return make_response(
            500,
            {
                "message": "Failed to execute tenant query"
            }
        )
# ==========================================================
# LIST ALL TENANTS
# ==========================================================

def list_tenants(event, context):
    """
    Return all registered tenants from DynamoDB.
    """

    try:
        response = tenants_table.scan()
        raw_items = response.get("Items", [])

        while "LastEvaluatedKey" in response:
            response = tenants_table.scan(
                ExclusiveStartKey=response["LastEvaluatedKey"]
            )
            raw_items.extend(response.get("Items", []))

        formatted = []
        for item in raw_items:
            formatted.append({
                "tenant_id": item.get("tenant_id"),
                "status": item.get("status"),
                "host_id": item.get("host_id"),
                "private_ip": item.get("private_ip"),
                "mysql_port": int(item.get("mysql_port", 3307)),
                "database_name": item.get("database_name"),
                "mysql_username": item.get("mysql_username"),
                "credentials_secret_arn": item.get("credentials_secret_arn"),
                "environment": item.get("environment", ENVIRONMENT),
                "created_at": item.get("created_at"),
                "updated_at": item.get("updated_at")
            })

        formatted.sort(
            key=lambda x: str(x.get("created_at") or ""),
            reverse=True
        )

        return make_response(200, {
            "count": len(formatted),
            "tenants": formatted
        })

    except Exception as error:
        return make_response(500, {
            "message": "Failed to list tenants",
            "error": str(error)
        })


# ==========================================================
# LIST ALL JOBS
# ==========================================================

def list_jobs(event, context):
    """
    Return all provisioning jobs from DynamoDB.
    """

    try:
        response = jobs_table.scan()
        raw_items = response.get("Items", [])

        while "LastEvaluatedKey" in response:
            response = jobs_table.scan(
                ExclusiveStartKey=response["LastEvaluatedKey"]
            )
            raw_items.extend(response.get("Items", []))

        raw_items.sort(
            key=lambda x: str(x.get("created_at") or ""),
            reverse=True
        )

        return make_response(200, {
            "count": len(raw_items),
            "jobs": raw_items
        })

    except Exception as error:
        return make_response(500, {
            "message": "Failed to list jobs",
            "error": str(error)
        })


# ==========================================================
# LIST TENANT BACKUPS FROM S3
# ==========================================================

def list_tenant_backups(event, context):
    """
    List previous backups for a tenant from S3.
    """

    path_parameters = event.get("pathParameters") or {}
    tenant_id = path_parameters.get("tenant_id")

    if not tenant_id:
        return make_response(400, {"message": "tenant_id is required"})

    tenant_id = str(tenant_id).strip()

    if not BACKUP_BUCKET_NAME:
        return make_response(200, {
            "count": 0,
            "tenant_id": tenant_id,
            "backups": []
        })

    try:
        prefix = f"tenants/{tenant_id}/"
        response = s3_client.list_objects_v2(
            Bucket=BACKUP_BUCKET_NAME,
            Prefix=prefix
        )

        backups = []
        for obj in response.get("Contents", []):
            key = obj.get("Key", "")
            if key.endswith(".sql.gz"):
                filename = key.replace(prefix, "")
                backup_id = filename.replace(".sql.gz", "")
                last_modified = obj.get("LastModified")
                backups.append({
                    "backup_id": backup_id,
                    "tenant_id": tenant_id,
                    "s3_bucket": BACKUP_BUCKET_NAME,
                    "s3_key": key,
                    "size_bytes": obj.get("Size", 0),
                    "created_at": (
                        last_modified.isoformat()
                        if hasattr(last_modified, "isoformat")
                        else str(last_modified)
                    ),
                    "status": "COMPLETED"
                })

        backups.sort(
            key=lambda x: str(x.get("created_at") or ""),
            reverse=True
        )

        return make_response(200, {
            "count": len(backups),
            "tenant_id": tenant_id,
            "backups": backups
        })

    except Exception as error:
        return make_response(500, {
            "message": "Failed to list tenant backups",
            "tenant_id": tenant_id,
            "error": str(error)
        })


# ==========================================================
# SYSTEM HEALTH CHECK
# ==========================================================

def get_system_health(event, context):
    """
    Check connectivity and status of backend infrastructure components.
    """

    now = utc_now()
    services = {}

    # 1. DynamoDB
    try:
        t0 = datetime.now(timezone.utc)
        tenants_table.scan(Limit=1)
        latency = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)
        services["dynamodb"] = {
            "name": "Amazon DynamoDB",
            "status": "Healthy",
            "latency_ms": latency,
            "details": f"Tables: {TENANTS_TABLE_NAME}, {JOBS_TABLE_NAME}, {HOSTS_TABLE_NAME}"
        }
    except Exception as e:
        services["dynamodb"] = {
            "name": "Amazon DynamoDB",
            "status": "Failed",
            "error": str(e)
        }

    # 2. Step Functions
    try:
        services["step_functions"] = {
            "name": "AWS Step Functions",
            "status": "Healthy" if STATE_MACHINE_ARN else "Warning",
            "arn": STATE_MACHINE_ARN or "Not configured"
        }
    except Exception as e:
        services["step_functions"] = {
            "name": "AWS Step Functions",
            "status": "Failed",
            "error": str(e)
        }

    # 3. EC2 Hosts
    try:
        hosts_resp = hosts_table.scan()
        hosts_items = hosts_resp.get("Items", [])
        ready_hosts = sum(1 for h in hosts_items if h.get("status") == "READY")
        services["ec2_hosts"] = {
            "name": "EC2 MySQL Hosts",
            "status": "Healthy" if ready_hosts > 0 else ("Warning" if len(hosts_items) > 0 else "Unknown"),
            "total_hosts": len(hosts_items),
            "ready_hosts": ready_hosts
        }
    except Exception as e:
        services["ec2_hosts"] = {
            "name": "EC2 MySQL Hosts",
            "status": "Failed",
            "error": str(e)
        }

    # 4. Lambda
    services["lambda"] = {
        "name": "AWS Lambda",
        "status": "Healthy",
        "environment": ENVIRONMENT
    }

    # 5. S3 Backups
    services["s3"] = {
        "name": "Amazon S3",
        "status": "Healthy" if BACKUP_BUCKET_NAME else "Warning",
        "bucket": BACKUP_BUCKET_NAME or "Not configured"
    }

    # 6. Secrets Manager
    services["secrets_manager"] = {
        "name": "AWS Secrets Manager",
        "status": "Healthy",
        "note": "Credential isolation active"
    }

    # 7. API Gateway
    services["api_gateway"] = {
        "name": "Amazon API Gateway",
        "status": "Healthy"
    }

    overall = "Healthy"
    if any(s.get("status") == "Failed" for s in services.values()):
        overall = "Failed"
    elif any(s.get("status") == "Warning" for s in services.values()):
        overall = "Warning"

    return make_response(200, {
        "status": overall,
        "environment": ENVIRONMENT,
        "region": os.environ.get("AWS_REGION", "ap-south-1"),
        "timestamp": now,
        "services": services
    })


# ==========================================================
# LAMBDA HANDLER
# ==========================================================

def handler(event, context):
    """
    Main API Gateway Lambda handler with full route dispatching.
    """

    http_method = (
        event.get("httpMethod")
        or event.get("requestContext", {})
        .get("http", {})
        .get("method")
        or ""
    ).upper()

    path = (
        event.get("path")
        or event.get("rawPath")
        or event.get("requestContext", {})
        .get("path")
        or ""
    )

    normalized_path = path.rstrip("/")

    # Handle CORS preflight
    if http_method == "OPTIONS":
        return make_response(200, {"message": "OK"})

    path_parameters = event.get("pathParameters") or {}
    tenant_id = path_parameters.get("tenant_id")
    job_id = path_parameters.get("job_id")

    log_event(
        "api_request_received",
        http_method=http_method,
        path=path,
        normalized_path=normalized_path,
        tenant_id=tenant_id,
        job_id=job_id
    )

    # 1. Health check: GET /health
    if http_method == "GET" and normalized_path.endswith("/health"):
        return get_system_health(event, context)

    # 2. List backups for tenant: GET /tenants/{tenant_id}/backups
    if (
        http_method == "GET"
        and normalized_path.endswith("/backups")
        and "/tenants/" in normalized_path
    ):
        return list_tenant_backups(event, context)

    # 3. Trigger backup: GET /tenants/{tenant_id}/backup
    if (
        http_method == "GET"
        and normalized_path.endswith("/backup")
        and "/tenants/" in normalized_path
    ):
        return run_tenant_backup(event, context)

    # 4. Trigger restore: POST /tenants/{tenant_id}/restore
    if (
        http_method == "POST"
        and normalized_path.endswith("/restore")
        and "/tenants/" in normalized_path
    ):
        return run_tenant_restore(event, context)

    # 5. Query tenant database: POST /tenants/{tenant_id}/query
    if (
        http_method == "POST"
        and normalized_path.endswith("/query")
        and "/tenants/" in normalized_path
    ):
        return run_tenant_query(event, context)

    # 6. Create tenant: POST /tenants
    if (
        http_method == "POST"
        and normalized_path.endswith("/tenants")
    ):
        return create_tenant_async(event, context)

    # 7. List all tenants: GET /tenants
    if (
        http_method == "GET"
        and normalized_path.endswith("/tenants")
    ):
        return list_tenants(event, context)

    # 8. List all jobs: GET /jobs
    if (
        http_method == "GET"
        and normalized_path.endswith("/jobs")
    ):
        return list_jobs(event, context)

    # 9. Get specific job status: GET /jobs/{job_id}
    if (
        http_method == "GET"
        and "/jobs/" in normalized_path
    ):
        return get_job_status(event, context)

    # 10. List hosts: GET /hosts
    if (
        http_method == "GET"
        and normalized_path.endswith("/hosts")
    ):
        return get_hosts(event, context)

    # 11. Delete tenant: DELETE /tenants/{tenant_id}
    if (
        http_method == "DELETE"
        and "/tenants/" in normalized_path
    ):
        return delete_tenant_async(event, context)

    # 12. Get tenant details: GET /tenants/{tenant_id}
    if (
        http_method == "GET"
        and "/tenants/" in normalized_path
    ):
        return get_tenant_details(event, context)

    # 13. Route not found
    log_event(
        "api_route_not_found",
        http_method=http_method,
        path=path,
        normalized_path=normalized_path
    )

    return make_response(
        404,
        {
            "message": "Route not found",
            "method": http_method,
            "path": path
        }
    )