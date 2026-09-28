from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import uuid
from typing import Any

import boto3
from botocore.exceptions import ClientError

from orchestration.user_data import build_mysql_user_data_base64


# ============================================================
# AWS CLIENTS
# ============================================================

ec2 = boto3.client("ec2")
secrets_manager = boto3.client("secretsmanager")
ssm = boto3.client("ssm")


# ============================================================
# STRUCTURED LOGGING
# ============================================================

def structured_log(event: str, **fields: Any) -> None:
    """
    Write structured JSON logs.

    Never pass passwords, secret contents, or credentials
    to this function.
    """

    payload = {
        "event": event,
        **fields,
    }

    print(json.dumps(payload, default=str))


# ============================================================
# PASSWORD GENERATION
# ============================================================

def generate_password(length: int = 48) -> str:
    """
    Generate a strong alphanumeric password.

    Only letters and digits are used to avoid shell/MySQL
    quoting problems during EC2 bootstrap.
    """

    alphabet = (
        "abcdefghijklmnopqrstuvwxyz"
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "0123456789"
    )

    return "".join(
        secrets.choice(alphabet)
        for _ in range(length)
    )


def generate_admin_username() -> str:
    """
    Generate a unique MySQL host administrator username.
    """

    suffix = secrets.token_hex(4)

    return f"hostadmin_{suffix}"


# ============================================================
# ENVIRONMENT VARIABLES
# ============================================================

def get_required_env(name: str) -> str:
    """
    Read a required Lambda environment variable.
    """

    value = os.environ.get(name)

    if not value:
        raise RuntimeError(
            f"Missing required environment variable: {name}"
        )

    return value


# ============================================================
# REQUEST ID / SECRET NAME HELPERS
# ============================================================

def sanitize_request_id(request_id: str) -> str:
    """
    Convert a request ID into a safe Secrets Manager
    secret-name component.
    """

    sanitized = re.sub(
        r"[^A-Za-z0-9/_+=.@-]",
        "-",
        str(request_id),
    )

    return sanitized[:128]


def build_client_request_token(request_id: str) -> str:
    """
    Secrets Manager ClientRequestToken must contain
    32-64 characters.

    SHA-256 produces a deterministic 64-character token.
    """

    return hashlib.sha256(
        request_id.encode("utf-8")
    ).hexdigest()


# ============================================================
# SECRET CREATION
# ============================================================

def create_or_get_bootstrap_secret(
    secret_name: str,
    client_request_token: str,
    secret_value: dict[str, str],
) -> str:
    """
    Create the bootstrap secret.

    If the secret already exists, return its existing ARN.
    This makes retries safer.
    """

    try:
        response = secrets_manager.create_secret(
            Name=secret_name,

            Description=(
                "Bootstrap credentials for a multi-tenant "
                "MySQL EC2 host"
            ),

            SecretString=json.dumps(secret_value),

            ClientRequestToken=client_request_token,
        )

        return response["ARN"]

    except ClientError as exc:

        error_code = (
            exc.response
            .get("Error", {})
            .get("Code")
        )

        if error_code == "ResourceExistsException":

            existing_secret = (
                secrets_manager.describe_secret(
                    SecretId=secret_name
                )
            )

            return existing_secret["ARN"]

        raise


# ============================================================
# LAMBDA HANDLER
# ============================================================

def handler(
    event: dict[str, Any],
    context: Any,
) -> dict[str, Any]:
    """
    Provision one private MySQL EC2 host.

    Expected event:

    {
        "subnet_id": "subnet-xxxxxxxx",
        "host_request_id": "first-host-test-001"
    }

    This function launches the EC2 instance but DOES NOT
    wait for EC2 or MySQL readiness.

    Readiness will be handled later by Step Functions.
    """

    # ========================================================
    # 1. VALIDATE REQUEST
    # ========================================================

    subnet_id = event.get("subnet_id")

    if not subnet_id:
        raise ValueError(
            "event.subnet_id is required"
        )

    host_request_id = (
        event.get("host_request_id")
        or uuid.uuid4().hex
    )

    host_request_id = str(host_request_id)

    # ========================================================
    # 2. READ CONFIGURATION
    # ========================================================

    region = get_required_env(
        "AWS_REGION"
    )

    security_group_id = get_required_env(
        "MYSQL_SECURITY_GROUP_ID"
    )

    instance_profile_name = get_required_env(
        "EC2_INSTANCE_PROFILE_NAME"
    )

    instance_type = get_required_env(
        "MYSQL_INSTANCE_TYPE"
    )

    mysql_port = int(
        get_required_env("MYSQL_PORT")
    )

    ami_parameter = get_required_env(
        "UBUNTU_AMI_SSM_PARAMETER"
    )

    secret_prefix = get_required_env(
        "SECRET_PREFIX"
    )

    environment = get_required_env(
        "ENVIRONMENT"
    )

    # ========================================================
    # 3. BUILD SECRET IDENTIFIERS
    # ========================================================

    safe_request_id = sanitize_request_id(
        host_request_id
    )

    secret_name = (
        f"{secret_prefix}{safe_request_id}"
    )

    client_request_token = (
        build_client_request_token(
            host_request_id
        )
    )

    # ========================================================
    # 4. GENERATE HOST CREDENTIALS
    # ========================================================

    root_password = generate_password()

    admin_username = generate_admin_username()

    admin_password = generate_password()

    secret_value = {
        "root_password": root_password,
        "admin_username": admin_username,
        "admin_password": admin_password,
    }

    # IMPORTANT:
    # Never log any password or secret contents.

    structured_log(
        "host_provisioning_started",

        host_request_id=host_request_id,

        subnet_id=subnet_id,

        instance_type=instance_type,

        mysql_port=mysql_port,

        environment=environment,
    )

    secret_arn: str | None = None
    instance_id: str | None = None

    try:

        # ====================================================
        # 5. CREATE OR REUSE SECRET
        # ====================================================

        secret_arn = create_or_get_bootstrap_secret(
            secret_name=secret_name,

            client_request_token=(
                client_request_token
            ),

            secret_value=secret_value,
        )

        structured_log(
            "bootstrap_secret_ready",

            host_request_id=host_request_id,

            secret_arn=secret_arn,
        )

        # ====================================================
        # 6. GET CURRENT UBUNTU AMI
        # ====================================================

        ami_response = ssm.get_parameter(
            Name=ami_parameter
        )

        ami_id = (
            ami_response["Parameter"]["Value"]
        )

        structured_log(
            "ami_resolved",

            host_request_id=host_request_id,

            ami_parameter=ami_parameter,

            ami_id=ami_id,
        )

        # ====================================================
        # 7. BUILD USER DATA
        # ====================================================

        user_data_b64 = (
            build_mysql_user_data_base64(
                secret_arn=secret_arn,

                mysql_port=mysql_port,

                aws_region=region,
            )
        )

        # ====================================================
        # 8. LAUNCH PRIVATE EC2
        # ====================================================

        instance_response = ec2.run_instances(

            ImageId=ami_id,

            InstanceType=instance_type,

            MinCount=1,

            MaxCount=1,

            IamInstanceProfile={
                "Name": instance_profile_name
            },

            NetworkInterfaces=[
                {
                    "DeviceIndex": 0,

                    "SubnetId": subnet_id,

                    "Groups": [
                        security_group_id
                    ],

                    # No public IP.
                    "AssociatePublicIpAddress": False,
                }
            ],

            BlockDeviceMappings=[
                {
                    "DeviceName": "/dev/sda1",

                    "Ebs": {
                        "VolumeSize": 30,

                        "VolumeType": "gp3",

                        "Encrypted": True,

                        "DeleteOnTermination": True,
                    },
                }
            ],

            UserData=user_data_b64,

            MetadataOptions={
                "HttpEndpoint": "enabled",

                "HttpTokens": "required",

                "HttpPutResponseHopLimit": 2,
            },

            TagSpecifications=[
                {
                    "ResourceType": "instance",

                    "Tags": [
                        {
                            "Key": "Name",

                            "Value": (
                                "multi-tenant-mysql-host-"
                                f"{safe_request_id[:8]}"
                            ),
                        },

                        {
                            "Key": "Project",

                            "Value": "MultiTenantMySQL",
                        },

                        {
                            "Key": "Environment",

                            "Value": environment,
                        },

                        {
                            "Key": "ManagedBy",

                            "Value": (
                                "ProvisionHostLambda"
                            ),
                        },
                    ],
                },

                {
                    "ResourceType": "volume",

                    "Tags": [
                        {
                            "Key": "Project",

                            "Value": "MultiTenantMySQL",
                        },

                        {
                            "Key": "Environment",

                            "Value": environment,
                        },
                    ],
                },
            ],
        )

        # ====================================================
        # 9. EXTRACT INSTANCE INFORMATION
        # ====================================================

        instance = (
            instance_response["Instances"][0]
        )

        instance_id = (
            instance["InstanceId"]
        )

        private_ip = instance.get(
            "PrivateIpAddress"
        )

        structured_log(
            "ec2_launched",

            host_request_id=host_request_id,

            instance_id=instance_id,

            private_ip=private_ip,

            subnet_id=subnet_id,

            mysql_port=mysql_port,
        )

        # ====================================================
        # 10. RETURN PROVISIONING RESULT
        # ====================================================

        return {
            "status": "BOOTSTRAPPING",

            "host_request_id": host_request_id,

            "instance_id": instance_id,

            "private_ip": private_ip,

            "secret_arn": secret_arn,

            "subnet_id": subnet_id,

            "mysql_port": mysql_port,

        }

    except Exception as exc:

        # Never log the exception object if it might contain
        # sensitive request data.

        structured_log(
            "host_provisioning_failed",

            host_request_id=host_request_id,

            instance_id=instance_id,

            error_type=type(exc).__name__,
        )

        # ====================================================
        # 11. CLEAN UP SECRET ONLY IF EC2 WAS NOT CREATED
        # ====================================================

        if secret_arn and not instance_id:

            try:

                secrets_manager.delete_secret(
                    SecretId=secret_arn,

                    ForceDeleteWithoutRecovery=True,
                )

                structured_log(
                    "bootstrap_secret_deleted_after_failure",

                    host_request_id=host_request_id,
                )

            except ClientError as cleanup_exc:

                structured_log(
                    "bootstrap_secret_cleanup_failed",

                    host_request_id=host_request_id,

                    cleanup_error_type=(
                        type(cleanup_exc).__name__
                    ),
                )

        raise