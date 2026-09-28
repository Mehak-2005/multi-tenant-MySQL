from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import boto3
import pymysql


# ============================================================
# AWS CLIENTS
# ============================================================

secrets_manager = boto3.client("secretsmanager")
dynamodb = boto3.resource("dynamodb")


# ============================================================
# HELPERS
# ============================================================

def get_required_env(name: str) -> str:
    value = os.environ.get(name)

    if not value:
        raise RuntimeError(
            f"Missing required environment variable: {name}"
        )

    return value


def structured_log(
    event: str,
    **fields: Any
) -> None:
    payload = {
        "event": event,
        **fields,
    }

    print(
        json.dumps(
            payload,
            default=str
        )
    )


def response(
    status_code: int,
    body: dict[str, Any]
) -> dict[str, Any]:
    """
    Standard Lambda response format.

    Step Functions uses statusCode to decide
    whether the host is READY or still bootstrapping.
    """

    return {
        "statusCode": status_code,
        "body": body,
    }


# ============================================================
# MYSQL READINESS
# ============================================================

def check_mysql(
    host: str,
    port: int,
    username: str,
    password: str,
) -> bool:
    """
    Check whether MySQL is actually accepting connections.

    Returns:
        True  -> MySQL is ready
        False -> MySQL is temporarily unavailable

    OperationalError is treated as "not ready yet".
    This is important during EC2 startup because MySQL
    may take some time to become reachable.
    """

    connection = None

    try:

        connection = pymysql.connect(
            host=host,
            port=port,
            user=username,
            password=password,
            connect_timeout=5,
            read_timeout=5,
            write_timeout=5,
            autocommit=True,
        )

        with connection.cursor() as cursor:

            cursor.execute(
                "SELECT 1"
            )

            result = cursor.fetchone()

        return result == (1,)

    except pymysql.err.OperationalError as error:

        structured_log(
            "mysql_operational_error",
            host=host,
            port=port,
            error_type=type(error).__name__,
        )

        return False

    finally:

        if connection:

            try:
                connection.close()

            except Exception:
                pass


# ============================================================
# LAMBDA HANDLER
# ============================================================

def handler(
    event: dict[str, Any],
    context: Any,
) -> dict[str, Any]:

    # ========================================================
    # READ INPUT
    # ========================================================

    host_id = event.get(
        "host_id"
    )

    private_ip = event.get(
        "private_ip"
    )

    secret_arn = event.get(
        "secret_arn"
    )

    subnet_id = event.get(
        "subnet_id"
    )

    mysql_port = int(
        event.get("mysql_port")
        or get_required_env(
            "MYSQL_PORT"
        )
    )

    # ========================================================
    # VALIDATION
    # ========================================================

    if not host_id:

        raise ValueError(
            "event.host_id is required"
        )

    if not private_ip:

        raise ValueError(
            "event.private_ip is required"
        )

    if not secret_arn:

        raise ValueError(
            "event.secret_arn is required"
        )

    if not subnet_id:

        raise ValueError(
            "event.subnet_id is required"
        )

    # ========================================================
    # ENVIRONMENT
    # ========================================================

    hosts_table_name = get_required_env(
        "HOSTS_TABLE_NAME"
    )

    max_tenants = int(
        get_required_env(
            "MAX_TENANTS_PER_HOST"
        )
    )

    environment = get_required_env(
        "ENVIRONMENT"
    )

    structured_log(
        "host_readiness_check_started",
        host_id=host_id,
        private_ip=private_ip,
        mysql_port=mysql_port,
    )

    try:

        # ====================================================
        # 1. GET ADMIN CREDENTIALS
        # ====================================================

        secret_response = (
            secrets_manager.get_secret_value(
                SecretId=secret_arn
            )
        )

        secret_string = secret_response.get(
            "SecretString"
        )

        if not secret_string:

            raise RuntimeError(
                "Host secret does not contain SecretString"
            )

        secret_value = json.loads(
            secret_string
        )

        admin_username = secret_value.get(
            "admin_username"
        )

        admin_password = secret_value.get(
            "admin_password"
        )

        if not admin_username:

            raise RuntimeError(
                "admin_username is missing from host secret"
            )

        if not admin_password:

            raise RuntimeError(
                "admin_password is missing from host secret"
            )

        # ====================================================
        # 2. CHECK REAL MYSQL CONNECTIVITY
        # ====================================================

        mysql_ready = check_mysql(
            host=private_ip,
            port=mysql_port,
            username=admin_username,
            password=admin_password,
        )

        # ====================================================
        # 3. MYSQL NOT READY YET
        # ====================================================

        if not mysql_ready:

            structured_log(
                "host_readiness_check_failed",
                host_id=host_id,
                private_ip=private_ip,
                mysql_port=mysql_port,
                reason="mysql_not_ready",
            )

            # IMPORTANT:
            # Step Functions expects statusCode=409
            # and will wait and retry RegisterHost.

            return response(
                409,
                {
                    "status": "BOOTSTRAPPING",
                    "host_id": host_id,
                    "private_ip": private_ip,
                    "mysql_port": mysql_port,
                    "mysql_ready": False,
                    "message": (
                        "MySQL is not ready yet"
                    ),
                }
            )

        # ====================================================
        # 4. REGISTER READY HOST
        # ====================================================

        table = dynamodb.Table(
            hosts_table_name
        )

        now = datetime.now(
            timezone.utc
        ).isoformat()

        table.put_item(
            Item={
                "host_id": host_id,

                "private_ip": private_ip,

                "mysql_port": mysql_port,

                "subnet_id": subnet_id,

                "secret_arn": secret_arn,

                "status": "READY",

                "tenant_count": 0,

                "capacity": max_tenants,

                "environment": environment,

                "created_at": now,

                "updated_at": now,
            }
        )

        # ====================================================
        # 5. SUCCESS LOG
        # ====================================================

        structured_log(
            "host_registered_ready",

            host_id=host_id,

            private_ip=private_ip,

            mysql_port=mysql_port,

            subnet_id=subnet_id,

            capacity=max_tenants,
        )

        # ====================================================
        # 6. SUCCESS RESPONSE
        # ====================================================

        return response(
            200,
            {
                "status": "READY",

                "mysql_ready": True,

                "host_id": host_id,

                "private_ip": private_ip,

                "mysql_port": mysql_port,

                "subnet_id": subnet_id,

                "tenant_count": 0,

                "capacity": max_tenants,

                "message": (
                    "MySQL is ready and host "
                    "was registered successfully"
                ),
            }
        )

    # ========================================================
    # TEMPORARY MYSQL ERRORS
    # ========================================================

    except pymysql.err.OperationalError as error:

        structured_log(
            "mysql_connection_not_ready",

            host_id=host_id,

            private_ip=private_ip,

            mysql_port=mysql_port,

            error_type=type(error).__name__,
        )

        return response(
            409,
            {
                "status": "BOOTSTRAPPING",

                "host_id": host_id,

                "private_ip": private_ip,

                "mysql_port": mysql_port,

                "mysql_ready": False,

                "message": (
                    "MySQL connection is not ready yet"
                ),
            }
        )

    # ========================================================
    # OTHER MYSQL ERRORS
    # ========================================================

    except pymysql.MySQLError as error:

        structured_log(
            "mysql_readiness_error",

            host_id=host_id,

            error_type=type(error).__name__,
        )

        return response(
            500,
            {
                "status": "FAILED",

                "host_id": host_id,

                "mysql_ready": False,

                "message": (
                    "MySQL readiness check failed"
                ),
            }
        )

    # ========================================================
    # AWS ERRORS
    # ========================================================

    except Exception as error:

        structured_log(
            "host_registration_failed",

            host_id=host_id,

            error_type=type(error).__name__,

            error_message=str(error),
        )

        raise