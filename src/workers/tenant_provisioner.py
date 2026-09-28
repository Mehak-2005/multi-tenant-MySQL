import json
import os
import re
import secrets
import hashlib
from datetime import datetime, timezone

import boto3
import pymysql
from botocore.exceptions import ClientError
from observability.metrics import (
    log_event,
    log_provision_duration,
    log_active_tenants,
    log_failed_provision,
    log_metric,
)

# ==========================================================
# AWS CLIENTS
# ==========================================================

dynamodb = boto3.resource("dynamodb")
secretsmanager = boto3.client("secretsmanager")


# ==========================================================
# ENVIRONMENT VARIABLES
# ==========================================================

HOSTS_TABLE_NAME = os.environ["HOSTS_TABLE_NAME"]
TENANTS_TABLE_NAME = os.environ["TENANTS_TABLE_NAME"]

MYSQL_PORT = int(
    os.environ.get("MYSQL_PORT", "3307")
)

SECRET_PREFIX = os.environ.get(
    "SECRET_PREFIX",
    "multi-tenant-mysql/hosts/dev/"
)

ENVIRONMENT = os.environ.get(
    "ENVIRONMENT",
    "dev"
)


# ==========================================================
# DYNAMODB TABLES
# ==========================================================

hosts_table = dynamodb.Table(
    HOSTS_TABLE_NAME
)

tenants_table = dynamodb.Table(
    TENANTS_TABLE_NAME
)


# ==========================================================
# RESPONSE HELPER
# ==========================================================

def response(status_code, body):
    """
    Return a standard Lambda response.
    """

    return {
        "statusCode": status_code,
        "body": body
    }


# ==========================================================
# TIME HELPER
# ==========================================================

def utc_now():
    """
    Return current UTC timestamp.
    """

    return datetime.now(
        timezone.utc
    ).isoformat()
def get_active_tenant_count():
    """
    Count all tenants whose status is READY.

    DynamoDB Scan is paginated, so continue scanning
    until there are no more pages.
    """

    active_count = 0

    scan_kwargs = {
        "FilterExpression": "#status = :ready",
        "ExpressionAttributeNames": {
            "#status": "status"
        },
        "ExpressionAttributeValues": {
            ":ready": "READY"
        }
    }

    while True:

        result = tenants_table.scan(
            **scan_kwargs
        )

        active_count += len(
            result.get("Items", [])
        )

        last_key = result.get(
            "LastEvaluatedKey"
        )

        if not last_key:
            break

        scan_kwargs["ExclusiveStartKey"] = last_key

    return active_count

def calculate_provision_duration_ms(
    execution_start_time
):
    """
    Calculate the total provisioning duration
    from Step Functions execution start until now.
    """

    if not execution_start_time:
        return None

    try:
        start_time = datetime.fromisoformat(
            execution_start_time.replace(
                "Z",
                "+00:00"
            )
        )

        end_time = datetime.now(
            timezone.utc
        )

        duration_ms = (
            end_time - start_time
        ).total_seconds() * 1000

        return round(duration_ms)

    except Exception:
        return None
# ==========================================================
# PASSWORD GENERATION
# ==========================================================

def generate_password(length=32):
    """
    Generate a cryptographically secure password.
    """

    return secrets.token_urlsafe(length)


# ==========================================================
# MYSQL IDENTIFIER HELPERS
# ==========================================================

def safe_identifier(
    value,
    prefix,
    max_length=60
):
    """
    Convert a tenant ID into a safe MySQL identifier.

    A SHA-256 suffix is included to reduce collisions.
    """

    value = str(value)

    clean = re.sub(
        r"[^a-zA-Z0-9_]",
        "_",
        value
    )

    clean = clean.strip("_")

    if not clean:
        clean = "tenant"

    digest = hashlib.sha256(
        value.encode("utf-8")
    ).hexdigest()[:12]

    identifier = (
        f"{prefix}_{clean}_{digest}"
    )

    return identifier[:max_length]


def mysql_quote_identifier(identifier):
    """
    Safely quote a MySQL database identifier.
    """

    return (
        "`"
        + identifier.replace("`", "``")
        + "`"
    )


def mysql_quote_username(username):
    """
    Safely quote a MySQL username.
    """

    return (
        "'"
        + username.replace("'", "''")
        + "'"
    )


# ==========================================================
# HOST LOOKUP
# ==========================================================

def get_host(host_id):
    """
    Retrieve a host record from DynamoDB.
    """

    result = hosts_table.get_item(
        Key={
            "host_id": host_id
        }
    )

    return result.get("Item")


# ==========================================================
# SECRET LOOKUP
# ==========================================================

def get_secret(secret_arn):
    """
    Retrieve a JSON secret from Secrets Manager.
    """

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

    try:
        return json.loads(
            secret_string
        )

    except json.JSONDecodeError as error:
        raise RuntimeError(
            "SecretString is not valid JSON"
        ) from error


# ==========================================================
# HOST ADMIN CREDENTIALS
# ==========================================================

def extract_admin_credentials(secret):
    """
    Extract the MySQL admin credentials from
    the host bootstrap secret.
    """

    username = (
        secret.get("admin_username")
        or secret.get(
            "mysql_admin_username"
        )
        or secret.get("username")
    )

    password = (
        secret.get("admin_password")
        or secret.get(
            "mysql_admin_password"
        )
        or secret.get("password")
    )

    if not username:
        raise RuntimeError(
            "Admin username not found in host secret"
        )

    if not password:
        raise RuntimeError(
            "Admin password not found in host secret"
        )

    return username, password


# ==========================================================
# TENANT SECRET
# ==========================================================

def create_or_update_tenant_secret(
    tenant_id,
    host_id,
    database_name,
    mysql_username,
    mysql_password,
    host_private_ip,
    mysql_port
):
    """
    Create or update the tenant's Secrets Manager secret.

    The MySQL password is never returned in the
    Lambda response.
    """

    secret_name = (
        "multi-tenant-mysql/tenants/"
        f"{ENVIRONMENT}/{tenant_id}"
    )

    secret_payload = {
        "tenant_id": tenant_id,
        "host_id": host_id,
        "host": host_private_ip,
        "port": mysql_port,
        "database": database_name,
        "username": mysql_username,
        "password": mysql_password
    }

    secret_string = json.dumps(
        secret_payload
    )

    try:

        result = secretsmanager.create_secret(
            Name=secret_name,
            Description=(
                f"MySQL credentials for tenant "
                f"{tenant_id}"
            ),
            SecretString=secret_string,
            Tags=[
                {
                    "Key": "Project",
                    "Value": "MultiTenantMySQL"
                },
                {
                    "Key": "Environment",
                    "Value": ENVIRONMENT
                },
                {
                    "Key": "TenantId",
                    "Value": tenant_id
                }
            ]
        )

        return result["ARN"]

    except secretsmanager.exceptions.ResourceExistsException:

        existing = secretsmanager.describe_secret(
            SecretId=secret_name
        )

        secret_arn = existing["ARN"]

        secretsmanager.put_secret_value(
            SecretId=secret_arn,
            SecretString=secret_string
        )

        return secret_arn


# ==========================================================
# MYSQL CONNECTION
# ==========================================================

def connect_to_mysql(
    host_ip,
    admin_username,
    admin_password
):
    """
    Connect to the private MySQL host.
    """

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
# CREATE TENANT DATABASE + USER
# ==========================================================

def create_tenant_database_and_user(
    connection,
    tenant_id
):
    """
    Create:

    1. Tenant-specific database
    2. Tenant-specific MySQL user
    3. Password for the user
    4. Privileges only on the tenant database
    """

    # ------------------------------------------------------
    # Generate names
    # ------------------------------------------------------

    database_name = safe_identifier(
        tenant_id,
        prefix="tenant_db",
        max_length=60
    )

    mysql_username = safe_identifier(
        tenant_id,
        prefix="tenant_user",
        max_length=32
    )

    mysql_password = generate_password()

    database_identifier = mysql_quote_identifier(
        database_name
    )

    quoted_username = mysql_quote_username(
        mysql_username
    )

    # ------------------------------------------------------
    # Execute SQL
    # ------------------------------------------------------

    with connection.cursor() as cursor:

        # ==================================================
        # 1. CREATE DATABASE
        # ==================================================

        cursor.execute(
            f"CREATE DATABASE IF NOT EXISTS "
            f"{database_identifier}"
        )

        # ==================================================
        # 2. CREATE MYSQL USER
        #
        # IMPORTANT:
        # This query contains %s for the password.
        # Therefore literal % must be written as %%.
        # ==================================================

        cursor.execute(
            f"CREATE USER IF NOT EXISTS "
            f"{quoted_username}@'%%' "
            f"IDENTIFIED BY %s",
            (mysql_password,)
        )

        # ==================================================
        # 3. RESET PASSWORD
        #
        # This also contains %s, so use %% for the
        # literal MySQL '%' host.
        # ==================================================

        cursor.execute(
            f"ALTER USER "
            f"{quoted_username}@'%%' "
            f"IDENTIFIED BY %s",
            (mysql_password,)
        )

        # ==================================================
        # 4. GRANT PRIVILEGES ONLY ON TENANT DB
        #
        # IMPORTANT:
        # This query has NO %s parameters.
        # Therefore we use a SINGLE literal %.
        # ==================================================

        cursor.execute(
            f"GRANT ALL PRIVILEGES "
            f"ON {database_identifier}.* "
            f"TO {quoted_username}@'%'"
        )

        # ==================================================
        # 5. APPLY PRIVILEGES
        # ==================================================

        cursor.execute(
            "FLUSH PRIVILEGES"
        )

        # ==================================================
        # 6. VERIFY DATABASE EXISTS
        # ==================================================

        cursor.execute(
            "SELECT SCHEMA_NAME "
            "FROM information_schema.SCHEMATA "
            "WHERE SCHEMA_NAME = %s",
            (database_name,)
        )

        database_check = cursor.fetchone()

        if not database_check:
            raise RuntimeError(
                "Tenant database creation could not be verified"
            )

        # ==================================================
        # 7. VERIFY USER EXISTS
        # ==================================================

        cursor.execute(
            "SELECT User, Host "
            "FROM mysql.user "
            "WHERE User = %s "
            "AND Host = '%%'",
            (mysql_username,)
        )

        user_check = cursor.fetchone()

        if not user_check:
            raise RuntimeError(
                "Tenant MySQL user creation "
                "could not be verified"
            )

    return (
        database_name,
        mysql_username,
        mysql_password
    )


# ==========================================================
# SAVE TENANT RECORD
# ==========================================================

def save_tenant(
    tenant_id,
    host_id,
    host,
    database_name,
    mysql_username,
    tenant_secret_arn
):
    """
    Save tenant metadata in DynamoDB.

    The plaintext password is NOT stored here.
    """

    item = {
        "tenant_id": tenant_id,

        "host_id": host_id,

        "private_ip": host,

        "mysql_port": MYSQL_PORT,

        "database_name": database_name,

        "mysql_username": mysql_username,

        "credentials_secret_arn": (
            tenant_secret_arn
        ),

        "status": "READY",

        "created_at": utc_now(),

        "updated_at": utc_now()
    }

    tenants_table.put_item(
        Item=item,
        ConditionExpression=(
            "attribute_not_exists(tenant_id)"
        )
    )

    return item


# ==========================================================
# LAMBDA HANDLER
# ==========================================================
def handler(event, context):

    tenant_id = event.get("tenant_id")
    host_id = event.get("host_id")

    execution_start_time = event.get(
        "execution_start_time"
    )

    log_event(
        "tenant_provisioning_started",
        tenant_id=tenant_id,
        host_id=host_id
    )


    # ------------------------------------------------------
    # VALIDATE INPUT
    # ------------------------------------------------------

    if not tenant_id:

        return response(
            400,
            {
                "message": (
                    "tenant_id is required"
                )
            }
        )

    if not host_id:

        return response(
            400,
            {
                "message": (
                    "host_id is required"
                )
            }
        )

    connection = None

    try:

        # ==================================================
        # 1. GET HOST
        # ==================================================

        host_record = get_host(
            host_id
        )

        if not host_record:

            return response(
                404,
                {
                    "message": "Host not found",
                    "host_id": host_id
                }
            )

        if host_record.get(
            "status"
        ) != "READY":

            return response(
                409,
                {
                    "message": (
                        "Host is not READY"
                    ),
                    "host_id": host_id,
                    "status": host_record.get(
                        "status"
                    )
                }
            )

        private_ip = host_record.get(
            "private_ip"
        )

        secret_arn = host_record.get(
            "secret_arn"
        )

        if not private_ip:

            raise RuntimeError(
                "Host private IP is missing"
            )

        if not secret_arn:

            raise RuntimeError(
                "Host secret ARN is missing"
            )

        # ==================================================
        # 2. READ HOST ADMIN SECRET
        # ==================================================

        host_secret = get_secret(
            secret_arn
        )

        (
            admin_username,
            admin_password
        ) = extract_admin_credentials(
            host_secret
        )

        # ==================================================
        # 3. CONNECT TO MYSQL
        # ==================================================

        connection = connect_to_mysql(
            host_ip=private_ip,
            admin_username=admin_username,
            admin_password=admin_password
        )

        # ==================================================
        # 4. CREATE DATABASE + USER + GRANTS
        # ==================================================

        (
            database_name,
            mysql_username,
            mysql_password
        ) = create_tenant_database_and_user(
            connection=connection,
            tenant_id=tenant_id
        )

        # ==================================================
        # 5. STORE TENANT CREDENTIALS
        # ==================================================

        tenant_secret_arn = (
            create_or_update_tenant_secret(
                tenant_id=tenant_id,
                host_id=host_id,
                database_name=database_name,
                mysql_username=mysql_username,
                mysql_password=mysql_password,
                host_private_ip=private_ip,
                mysql_port=MYSQL_PORT
            )
        )

        # ==================================================
        # 6. SAVE TENANT RECORD
        # ==================================================

        tenant_record = save_tenant(
            tenant_id=tenant_id,
            host_id=host_id,
            host=private_ip,
            database_name=database_name,
            mysql_username=mysql_username,
            tenant_secret_arn=tenant_secret_arn
        )

                # --------------------------------------------------
        # 7. UPDATE ACTIVE TENANTS METRIC
        # --------------------------------------------------

        try:
            active_tenant_count = (
                get_active_tenant_count()
            )

            log_active_tenants(
                active_tenant_count
            )

            log_event(
                "active_tenants_recorded",
                tenant_id=tenant_id,
                active_tenants=active_tenant_count
            )
        except Exception as metric_error:
            # Observability must not break tenant provisioning.
            log_event(
                "active_tenants_metric_error",
                tenant_id=tenant_id,
                host_id=host_id,
                error_type=type(metric_error).__name__,
            )

        # --------------------------------------------------
        # 7. CALCULATE PROVISIONING DURATION
        # --------------------------------------------------

        duration_ms = calculate_provision_duration_ms(
            execution_start_time
        )

        if duration_ms is not None:

            try:
                log_provision_duration(
                    duration_ms
                )

                log_event(
                    "provision_duration_recorded",
                    tenant_id=tenant_id,
                    host_id=host_id,
                    duration_ms=duration_ms
                )
            except Exception as metric_error:
                # Observability must not break tenant provisioning.
                log_event(
                    "provision_duration_metric_error",
                    tenant_id=tenant_id,
                    host_id=host_id,
                    error_type=type(metric_error).__name__,
                )

        # ==================================================
        # 7. SUCCESS
        # ==================================================

        log_event(
            "tenant_provisioning_completed",
            tenant_id=tenant_id,
            host_id=host_id,
            database_name=database_name,
            mysql_username=mysql_username,
        )

        # Publish zero on success so CloudWatch creates the metric
        # even when there have been no failures yet.
        try:
            log_metric(
                "failed_provisions",
                0,
                "Count",
            )
        except Exception as metric_error:
            # Observability must never break provisioning.
            log_event(
                "failed_provision_metric_error",
                tenant_id=tenant_id,
                host_id=host_id,
                error_type=type(metric_error).__name__,
            )

        return response(
            200,
            {
                "message": (
                    "Tenant provisioned successfully"
                ),

                "tenant_id": tenant_id,

                "host_id": host_id,

                "private_ip": private_ip,

                "mysql_port": MYSQL_PORT,

                "database_name": database_name,

                "mysql_username": mysql_username,

                "credentials_secret_arn": (
                    tenant_secret_arn
                ),

                "status": "READY",

                "created_at": tenant_record[
                    "created_at"
                ]
            }
        )

    # ======================================================
    # AWS ERRORS
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
            .get("Message", "AWS error")
        )

        log_event(
            "tenant_provisioning_failed",
            tenant_id=tenant_id,
            host_id=host_id,
            error_type="AWS",
            error_code=error_code,
        )

        # Metrics must never prevent the Lambda from returning its
        # actual provisioning error.
        try:
            log_failed_provision()
        except Exception as metric_error:
            log_event(
                "failed_provision_metric_error",
                tenant_id=tenant_id,
                host_id=host_id,
                error_type=type(metric_error).__name__,
            )

        return response(
            500,
            {
                "message": (
                    "AWS error during tenant provisioning"
                ),
                "error_code": error_code
            }
        )

    # ======================================================
    # MYSQL ERRORS
    # ======================================================

    except pymysql.MySQLError as error:

        # Do NOT log passwords or secret values.
        log_event(
            "tenant_provisioning_failed",
            tenant_id=tenant_id,
            host_id=host_id,
            error_type=type(error).__name__,
        )

        try:
            log_failed_provision()
        except Exception as metric_error:
            log_event(
                "failed_provision_metric_error",
                tenant_id=tenant_id,
                host_id=host_id,
                error_type=type(metric_error).__name__,
            )

        return response(
            500,
            {
                "message": (
                    "MySQL error during tenant provisioning"
                ),
                "error_type": (
                    type(error).__name__
                )
            }
        )

    # ======================================================
    # OTHER ERRORS
    # ======================================================

    except Exception as error:

        log_event(
            "tenant_provisioning_failed",
            tenant_id=tenant_id,
            host_id=host_id,
            error_type=type(error).__name__,
        )

        try:
            log_failed_provision()
        except Exception as metric_error:
            log_event(
                "failed_provision_metric_error",
                tenant_id=tenant_id,
                host_id=host_id,
                error_type=type(metric_error).__name__,
            )

        return response(
            500,
            {
                "message": (
                    "Tenant provisioning failed"
                ),
                "error_type": (
                    type(error).__name__
                )
            }
        )

    # ======================================================
    # CLOSE MYSQL CONNECTION
    # ======================================================

    finally:

        if connection:

            try:
                connection.close()

            except Exception:
                pass