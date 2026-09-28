import json
import os
import shlex
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


TENANTS_TABLE_NAME = os.environ["TENANTS_TABLE_NAME"]
HOSTS_TABLE_NAME = os.environ["HOSTS_TABLE_NAME"]
BACKUP_BUCKET_NAME = os.environ["BACKUP_BUCKET_NAME"]
ENVIRONMENT = os.environ.get("ENVIRONMENT", "dev")


dynamodb = boto3.resource("dynamodb")

tenants_table = dynamodb.Table(
    TENANTS_TABLE_NAME
)

hosts_table = dynamodb.Table(
    HOSTS_TABLE_NAME
)

ssm = boto3.client("ssm")


def response(status_code, body):
    return {
        "statusCode": status_code,
        "body": body
    }


def utc_now():
    return datetime.now(
        timezone.utc
    ).isoformat()


def handler(event, context):

    tenant_id = event.get("tenant_id")

    if not tenant_id:
        return response(
            400,
            {
                "message": "tenant_id is required"
            }
        )

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
                    "message": "Tenant not found",
                    "tenant_id": tenant_id
                }
            )

        if tenant.get("status") != "READY":
            return response(
                409,
                {
                    "message": "Tenant is not READY",
                    "tenant_id": tenant_id,
                    "status": tenant.get("status")
                }
            )

        host_id = tenant.get("host_id")
        database_name = tenant.get(
            "database_name"
        )

        if not host_id:
            raise RuntimeError(
                "Tenant host_id is missing"
            )

        if not database_name:
            raise RuntimeError(
                "Tenant database_name is missing"
            )

        # ==================================================
        # 2. GET HOST
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
                    "message": "Host not found",
                    "host_id": host_id
                }
            )

        if host.get("status") != "READY":
            return response(
                409,
                {
                    "message": "Host is not READY",
                    "host_id": host_id,
                    "status": host.get("status")
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
                "Host private IP is missing"
            )

        if not host_secret_arn:
            raise RuntimeError(
                "Host secret ARN is missing"
            )

        # ==================================================
        # 3. BACKUP ID + S3 KEY
        # ==================================================

        backup_id = str(
            uuid.uuid4()
        )

        s3_key = (
            f"tenants/"
            f"{tenant_id}/"
            f"{backup_id}.sql.gz"
        )

        # ==================================================
        # 4. SAFELY QUOTE VALUES
        # ==================================================

        secret_arn_q = shlex.quote(
            host_secret_arn
        )

        database_q = shlex.quote(
            database_name
        )

        bucket_q = shlex.quote(
            BACKUP_BUCKET_NAME
        )

        key_q = shlex.quote(
            s3_key
        )

        # ==================================================
        # 5. REMOTE BACKUP SCRIPT
        # ==================================================
        #
        # EC2 retrieves its host secret using boto3.
        # The real MySQL password is never sent in the
        # SSM command itself.
        #
        # mysqldump is restricted to this tenant's DB.
        # The compressed dump is uploaded directly to S3
        # using boto3.
        #
        # ==================================================

        commands = [

            "set -e",

            "TMP_DIR=$(mktemp -d)",

            'trap \'rm -rf "$TMP_DIR"\' EXIT',

            # ------------------------------
            # Build Python backup script
            # ------------------------------

            "cat > \"$TMP_DIR/run_backup.py\" <<'PY'",

            "import json",
            "import os",
            "import subprocess",
            "import boto3",

            "",

            "secret_arn = os.environ[\"HOST_SECRET_ARN\"]",
            "bucket = os.environ[\"BACKUP_BUCKET\"]",
            "key = os.environ[\"BACKUP_KEY\"]",
            "database = os.environ[\"DATABASE_NAME\"]",

            "",

            'region = os.environ.get("AWS_REGION", "ap-south-1")',
            "",
            'sm = boto3.client("secretsmanager", region_name=region)', 

            "secret_response = sm.get_secret_value(",
            "    SecretId=secret_arn",
            ")",

            "secret = json.loads(",
            "    secret_response[\"SecretString\"]",
            ")",

            "username = (",
            "    secret.get(\"admin_username\")",
            "    or secret.get(\"mysql_admin_username\")",
            "    or secret.get(\"username\")",
            ")",

            "password = (",
            "    secret.get(\"admin_password\")",
            "    or secret.get(\"mysql_admin_password\")",
            "    or secret.get(\"password\")",
            ")",

            "if not username:",
            "    raise RuntimeError(\"Host admin username missing\")",

            "if not password:",
            "    raise RuntimeError(\"Host admin password missing\")",

            "",

            "config_path = \"/tmp/my.cnf\"",

            "with open(config_path, \"w\") as f:",
            "    f.write(\"[client]\\n\")",
            "    f.write(\"host=127.0.0.1\\n\")",
            "    f.write(\"port=3307\\n\")",
            "    f.write(f\"user={username}\\n\")",
            "    f.write(f\"password={password}\\n\")",

            "os.chmod(config_path, 0o600)",

            "",

            "dump_path = \"/tmp/tenant_backup.sql\"",

            "gzip_path = dump_path + \".gz\"",

            "dump_command = [",
            "    \"mysqldump\",",
            "    f\"--defaults-extra-file={config_path}\",",
            "    \"--single-transaction\",",
            "    \"--routines\",",
            "    \"--triggers\",",
            "    \"--databases\",",
            "    database",
            "]",

            "with open(dump_path, \"wb\") as output:",
            "    subprocess.run(",
            "        dump_command,",
            "        stdout=output,",
            "        stderr=subprocess.PIPE,",
            "        check=True",
            "    )",

            "subprocess.run(",
            "    [\"gzip\", \"-f\", dump_path],",
            "    check=True",
            ")",

            "",

            "s3 = boto3.client(\"s3\", region_name=region)",

            "s3.upload_file(",
            "    gzip_path,",
            "    bucket,",
            "    key,",
            "    ExtraArgs={",
            "        \"ServerSideEncryption\": \"AES256\",",
            "        \"ContentType\": \"application/gzip\"",
            "    }",
            ")",

            "print(\"BACKUP_COMPLETED\")",
            "print(f\"S3_BUCKET={bucket}\")",
            "print(f\"S3_KEY={key}\")",

            "PY",

            # ------------------------------
            # Export values
            # ------------------------------

            f"export HOST_SECRET_ARN={secret_arn_q}",

            f"export BACKUP_BUCKET={bucket_q}",

            f"export BACKUP_KEY={key_q}",

            f"export DATABASE_NAME={database_q}",

            # ------------------------------
            # Execute backup
            # ------------------------------

            "python3 \"$TMP_DIR/run_backup.py\""
        ]

        # ==================================================
        # 6. SEND SSM COMMAND
        # ==================================================

        command_result = ssm.send_command(
            InstanceIds=[
                host_id
            ],

            DocumentName="AWS-RunShellScript",

            Comment=(
                f"MySQL backup "
                f"for tenant {tenant_id}"
            ),

            Parameters={
                "commands": commands
            },

            TimeoutSeconds=1800
        )
        print(
             "SSM SEND COMMAND RESPONSE:",
             json.dumps(
                  command_result,
                  default=str
            )
        )

        command_id = (
            command_result["Command"]["CommandId"]
        )

        print(
            "SSM COMMAND ID:",
            command_id
        )
        # ==================================================
        # 7. RETURN IMMEDIATELY
        # ==================================================

        return response(
            202,
            {
                "message":
                    "Tenant backup started",

                "tenant_id":
                    tenant_id,

                "host_id":
                    host_id,

                "database_name":
                    database_name,

                "backup_id":
                    backup_id,

                "command_id":
                    command_id,

                "s3_bucket":
                    BACKUP_BUCKET_NAME,

                "s3_key":
                    s3_key,

                "status":
                    "IN_PROGRESS",

                "created_at":
                    utc_now()
            }
        )

    except ClientError as error:

        error_code = (
            error.response
            .get("Error", {})
            .get("Code", "Unknown")
        )

        print(
            "AWS backup error:",
            error_code,
            str(error)
        )

        return response(
            500,
            {
                "message":
                    "Failed to start tenant backup",

                "tenant_id":
                    tenant_id,

                "error_code":
                    error_code
            }
        )

    except Exception as error:

        print(
            "Tenant backup failed:",
            type(error).__name__,
            str(error)
        )

        return response(
            500,
            {
                "message":
                    "Tenant backup failed",

                "tenant_id":
                    tenant_id,

                "error":
                    str(error)
            }
        )