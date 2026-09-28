import json
import os
from datetime import datetime, timezone

import boto3
import pymysql
from botocore.exceptions import ClientError


# ==========================================================
# ENVIRONMENT
# ==========================================================

HOSTS_TABLE_NAME = os.environ["HOSTS_TABLE_NAME"]
TENANTS_TABLE_NAME = os.environ["TENANTS_TABLE_NAME"]

MYSQL_PORT = int(
    os.environ.get("MYSQL_PORT", "3307")
)

ENVIRONMENT = os.environ.get(
    "ENVIRONMENT",
    "dev"
)


# ==========================================================
# AWS CLIENTS
# ==========================================================

dynamodb = boto3.resource("dynamodb")

hosts_table = dynamodb.Table(
    HOSTS_TABLE_NAME
)

tenants_table = dynamodb.Table(
    TENANTS_TABLE_NAME
)

secretsmanager = boto3.client(
    "secretsmanager"
)

ec2 = boto3.client(
    "ec2"
)


# ==========================================================
# HELPERS
# ==========================================================

def utc_now():
    return datetime.now(
        timezone.utc
    ).isoformat()


def response(status_code, body):
    return {
        "statusCode": status_code,
        "body": body
    }


def get_secret(secret_arn):
    result = secretsmanager.get_secret_value(
        SecretId=secret_arn
    )

    secret_string = result.get(
        "SecretString"
    )

    if not secret_string:
        raise RuntimeError(
            "Secret does not contain SecretString"
        )

    return json.loads(
        secret_string
    )


def extract_admin_credentials(secret):
    username = (
        secret.get("admin_username")
        or secret.get("mysql_admin_username")
        or secret.get("username")
    )

    password = (
        secret.get("admin_password")
        or secret.get("mysql_admin_password")
        or secret.get("password")
    )

    if not username:
        raise RuntimeError(
            "Host admin username not found"
        )

    if not password:
        raise RuntimeError(
            "Host admin password not found"
        )

    return username, password


def quote_identifier(value):
    return (
        "`"
        + str(value).replace("`", "``")
        + "`"
    )


def quote_mysql_username(value):
    return (
        "'"
        + str(value).replace("'", "''")
        + "'"
    )


def connect_to_mysql(
    host_ip,
    admin_username,
    admin_password
):
    return pymysql.connect(
        host=host_ip,
        port=MYSQL_PORT,
        user=admin_username,
        password=admin_password,
        connect_timeout=10,
        read_timeout=10,
        write_timeout=10,
        autocommit=True
    )


# ==========================================================
# MAIN HANDLER
# ==========================================================

def handler(event, context):

    tenant_id = event.get(
        "tenant_id"
    )

    if not tenant_id:
        return response(
            400,
            {
                "message":
                    "tenant_id is required"
            }
        )

    connection = None

    try:

        # ==================================================
        # 1. GET TENANT
        # ==================================================

        tenant_result = tenants_table.get_item(
            Key={
                "tenant_id": tenant_id
            }
        )

        tenant = tenant_result.get(
            "Item"
        )

        if not tenant:
            return response(
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

        if tenant_status == "TERMINATED":
            return response(
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

        if tenant_status != "READY":
            return response(
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
        # 2. READ TENANT DETAILS
        # ==================================================

        host_id = tenant.get(
            "host_id"
        )

        database_name = tenant.get(
            "database_name"
        )

        mysql_username = tenant.get(
            "mysql_username"
        )

        credentials_secret_arn = tenant.get(
            "credentials_secret_arn"
        )

        if not host_id:
            raise RuntimeError(
                "Tenant host_id is missing"
            )

        if not database_name:
            raise RuntimeError(
                "Tenant database_name is missing"
            )

        if not mysql_username:
            raise RuntimeError(
                "Tenant mysql_username is missing"
            )

        # ==================================================
        # 3. GET HOST
        # ==================================================

        host_result = hosts_table.get_item(
            Key={
                "host_id": host_id
            }
        )

        host = host_result.get(
            "Item"
        )

        if not host:
            return response(
                404,
                {
                    "message":
                        "Host not found",
                    "host_id":
                        host_id
                }
            )

        private_ip = host.get(
            "private_ip"
        )

        host_secret_arn = host.get(
            "secret_arn"
        )

        if not private_ip:
            raise RuntimeError(
                "Host private_ip is missing"
            )

        if not host_secret_arn:
            raise RuntimeError(
                "Host secret_arn is missing"
            )

        # ==================================================
        # 4. READ HOST ADMIN SECRET
        # ==================================================

        host_secret = get_secret(
            host_secret_arn
        )

        (
            admin_username,
            admin_password
        ) = extract_admin_credentials(
            host_secret
        )

        # ==================================================
        # 5. CONNECT TO MYSQL
        # ==================================================

        connection = connect_to_mysql(
            host_ip=private_ip,
            admin_username=admin_username,
            admin_password=admin_password
        )

        # ==================================================
        # 6. DROP TENANT DATABASE + USER
        # ==================================================

        database_identifier = quote_identifier(
            database_name
        )

        quoted_username = quote_mysql_username(
            mysql_username
        )

        with connection.cursor() as cursor:

            # Drop database
            cursor.execute(
                f"DROP DATABASE IF EXISTS "
                f"{database_identifier}"
            )

            # Drop tenant user
            cursor.execute(
                f"DROP USER IF EXISTS "
                f"{quoted_username}@'%'"
            )

            cursor.execute(
                "FLUSH PRIVILEGES"
            )

        # ==================================================
        # 7. DELETE TENANT CREDENTIAL SECRET
        # ==================================================

        if credentials_secret_arn:

            try:
                secretsmanager.delete_secret(
                    SecretId=credentials_secret_arn,
                    ForceDeleteWithoutRecovery=True
                )

            except ClientError as error:

                error_code = (
                    error.response
                    .get("Error", {})
                    .get("Code")
                )

                if error_code != "ResourceNotFoundException":
                    raise

        # ==================================================
        # 8. UPDATE HOST CAPACITY
        # ==================================================

        # First try the LAST-TENANT case atomically.
        last_tenant = False

        try:

            hosts_table.update_item(
                Key={
                    "host_id": host_id
                },
                UpdateExpression=(
                    "SET #status = :terminating, "
                    "tenant_count = :zero, "
                    "updated_at = :updated_at"
                ),
                ConditionExpression=(
                    "#status = :ready "
                    "AND tenant_count = :one"
                ),
                ExpressionAttributeNames={
                    "#status": "status"
                },
                ExpressionAttributeValues={
                    ":terminating": "TERMINATING",
                    ":ready": "READY",
                    ":one": 1,
                    ":zero": 0,
                    ":updated_at": utc_now()
                }
            )

            last_tenant = True

        except ClientError as error:

            if (
                error.response
                .get("Error", {})
                .get("Code")
                != "ConditionalCheckFailedException"
            ):
                raise

        # ==================================================
        # 9. NORMAL HOST CASE
        # ==================================================

        if not last_tenant:

            hosts_table.update_item(
                Key={
                    "host_id": host_id
                },
                UpdateExpression=(
                    "SET tenant_count = "
                    "tenant_count - :one, "
                    "updated_at = :updated_at"
                ),
                ConditionExpression=(
                    "tenant_count > :zero "
                    "AND #status = :ready"
                ),
                ExpressionAttributeNames={
                    "#status": "status"
                },
                ExpressionAttributeValues={
                    ":one": 1,
                    ":zero": 0,
                    ":ready": "READY",
                    ":updated_at": utc_now()
                }
            )

        # ==================================================
        # 10. TERMINATE HOST IF LAST TENANT
        # ==================================================

        host_terminated = False

        if last_tenant:

            ec2.terminate_instances(
                InstanceIds=[
                    host_id
                ]
            )

            host_terminated = True

            hosts_table.update_item(
                Key={
                    "host_id": host_id
                },
                UpdateExpression=(
                    "SET #status = :terminated, "
                    "updated_at = :updated_at"
                ),
                ExpressionAttributeNames={
                    "#status": "status"
                },
                ExpressionAttributeValues={
                    ":terminated":
                        "TERMINATED",
                    ":updated_at":
                        utc_now()
                }
            )

        # ==================================================
        # 11. MARK TENANT TERMINATED
        # ==================================================

        tenants_table.update_item(
            Key={
                "tenant_id": tenant_id
            },
            UpdateExpression=(
                "SET #status = :terminated, "
                "updated_at = :updated_at"
            ),
            ExpressionAttributeNames={
                "#status": "status"
            },
            ExpressionAttributeValues={
                ":terminated":
                    "TERMINATED",
                ":updated_at":
                    utc_now()
            }
        )

        # ==================================================
        # SUCCESS
        # ==================================================

        return response(
            200,
            {
                "message":
                    "Tenant deprovisioned successfully",
                "tenant_id":
                    tenant_id,
                "host_id":
                    host_id,
                "database_dropped":
                    True,
                "mysql_user_removed":
                    True,
                "credentials_secret_deleted":
                    bool(
                        credentials_secret_arn
                    ),
                "host_terminated":
                    host_terminated,
                "status":
                    "TERMINATED"
            }
        )

    except ClientError as error:

        error_code = (
            error.response
            .get("Error", {})
            .get("Code", "Unknown")
        )

        error_message = (
            error.response
            .get("Error", {})
            .get("Message", str(error))
        )

        print(
            "AWS error in tenant deprovisioner:",
            error_code,
            error_message
        )

        return response(
            500,
            {
                "message":
                    "Tenant deprovisioning failed",
                "tenant_id":
                    tenant_id,
                "error_code":
                    error_code
            }
        )

    except Exception as error:

        print(
            "Tenant deprovisioner failed:",
            type(error).__name__,
            str(error)
        )

        return response(
            500,
            {
                "message":
                    "Tenant deprovisioning failed",
                "tenant_id":
                    tenant_id,
                "error":
                    str(error)
            }
        )

    finally:

        if connection:

            try:
                connection.close()
            except Exception:
                pass