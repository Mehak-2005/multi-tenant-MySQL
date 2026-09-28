from __future__ import annotations

import base64


def build_mysql_user_data(
    secret_arn: str,
    mysql_port: int = 3307,
    aws_region: str = "ap-south-1",
) -> str:
    """
    Build EC2 user-data for an Ubuntu MySQL host.

    The EC2 instance retrieves credentials from AWS Secrets Manager
    using the IAM role attached to the instance.

    No credentials are embedded in this script.
    """

    script = f"""#!/bin/bash

set -Eeuo pipefail
umask 077


# ============================================================
# LOGGING
# ============================================================

LOG_FILE="/var/log/mysql-bootstrap.log"

exec > >(tee -a "$LOG_FILE" | logger -t mysql-bootstrap -s 2>/dev/console) 2>&1

echo "=================================================="
echo "=== MySQL bootstrap started ==="
echo "=================================================="


# ============================================================
# CONFIGURATION
# ============================================================

SECRET_ARN="{secret_arn}"
AWS_REGION="{aws_region}"
MYSQL_PORT="{mysql_port}"

MYSQL_OVERRIDE="/etc/mysql/mysql.conf.d/99-multi-tenant.cnf"

export DEBIAN_FRONTEND=noninteractive

echo "Secret ARN configured."
echo "AWS Region: $AWS_REGION"
echo "MySQL Port: $MYSQL_PORT"


# ============================================================
# 1. UPDATE UBUNTU PACKAGES
# ============================================================

echo "[1/10] Updating packages..."

apt-get update -y


# ============================================================
# 2. INSTALL REQUIRED PACKAGES
# ============================================================

echo "[2/10] Installing required packages..."

apt-get install -y \\
    mysql-server \\
    python3-boto3 \\
    jq \\
    net-tools


# ============================================================
# 3. RETRIEVE CREDENTIALS FROM SECRETS MANAGER
# ============================================================

echo "[3/10] Retrieving host credentials from Secrets Manager..."

SECRET_JSON=$(python3 - "$AWS_REGION" "$SECRET_ARN" <<'PY'
import boto3
import sys

region = sys.argv[1]
secret_arn = sys.argv[2]

client = boto3.client(
    "secretsmanager",
    region_name=region,
)

response = client.get_secret_value(
    SecretId=secret_arn,
)

print(response["SecretString"])
PY
)

if [ -z "$SECRET_JSON" ]; then
    echo "ERROR: Secrets Manager returned an empty response."
    exit 1
fi


ROOT_PASSWORD=$(echo "$SECRET_JSON" | jq -r '.root_password')
ADMIN_USERNAME=$(echo "$SECRET_JSON" | jq -r '.admin_username')
ADMIN_PASSWORD=$(echo "$SECRET_JSON" | jq -r '.admin_password')


if [ -z "$ROOT_PASSWORD" ] || [ "$ROOT_PASSWORD" = "null" ]; then
    echo "ERROR: Root password was not retrieved."
    exit 1
fi

if [ -z "$ADMIN_USERNAME" ] || [ "$ADMIN_USERNAME" = "null" ]; then
    echo "ERROR: Admin username was not retrieved."
    exit 1
fi

if [ -z "$ADMIN_PASSWORD" ] || [ "$ADMIN_PASSWORD" = "null" ]; then
    echo "ERROR: Admin password was not retrieved."
    exit 1
fi

echo "Credentials successfully retrieved."


# ============================================================
# 4. STOP MYSQL AND CONFIGURE IT
# ============================================================

echo "[4/10] Configuring MySQL..."

echo "Stopping MySQL before configuration..."

systemctl stop mysql || true

sleep 2


# ------------------------------------------------------------
# Create a late-loading override file.
#
# This is important because Ubuntu's default mysqld.cnf
# normally contains:
#
#   bind-address = 127.0.0.1
#   port = 3306
#
# Our 99-... file loads after the default settings.
# ------------------------------------------------------------

cat > "$MYSQL_OVERRIDE" <<EOF
[mysqld]
bind-address = 0.0.0.0
port = $MYSQL_PORT
EOF

chmod 644 "$MYSQL_OVERRIDE"

echo "Created MySQL override configuration:"
cat "$MYSQL_OVERRIDE"


# ============================================================
# 5. START MYSQL WITH FINAL CONFIGURATION
# ============================================================

echo "[5/10] Starting MySQL..."

systemctl daemon-reload
systemctl enable mysql
systemctl start mysql

sleep 5


# ============================================================
# 6. WAIT FOR MYSQL SOCKET
# ============================================================

echo "[6/10] Waiting for MySQL socket readiness..."

MYSQL_SOCKET_READY=false

for i in $(seq 1 60); do

    if mysqladmin \\
        --protocol=socket \\
        --user=root \\
        --silent \\
        ping >/dev/null 2>&1; then

        echo "MySQL socket is ready."

        MYSQL_SOCKET_READY=true
        break
    fi

    echo "Waiting for MySQL socket... attempt $i/60"

    sleep 2
done


if [ "$MYSQL_SOCKET_READY" != "true" ]; then

    echo "ERROR: MySQL socket did not become ready."

    echo "===== MYSQL SERVICE ====="
    systemctl status mysql --no-pager -l || true

    echo "===== MYSQL LISTENING PORTS ====="
    ss -lntp | grep mysqld || true

    echo "===== MYSQL JOURNAL ====="
    journalctl \\
        -u mysql \\
        --no-pager \\
        -n 100 || true

    exit 1
fi


# ============================================================
# 7. CREATE ROOT + HOST ADMINISTRATOR
# ============================================================

echo "[7/10] Creating administrator accounts..."


# ------------------------------------------------------------
# Root configuration
# ------------------------------------------------------------

mysql \\
    --protocol=socket \\
    --user=root \\
    <<SQL
ALTER USER 'root'@'localhost'
IDENTIFIED WITH caching_sha2_password
BY '${{ROOT_PASSWORD}}';

CREATE USER IF NOT EXISTS
'${{ADMIN_USERNAME}}'@'%'
IDENTIFIED WITH caching_sha2_password
BY '${{ADMIN_PASSWORD}}';

ALTER USER
'${{ADMIN_USERNAME}}'@'%'
IDENTIFIED WITH caching_sha2_password
BY '${{ADMIN_PASSWORD}}';

GRANT ALL PRIVILEGES
ON *.*
TO '${{ADMIN_USERNAME}}'@'%'
WITH GRANT OPTION;

FLUSH PRIVILEGES;
SQL


echo "Administrator account created."

echo "Verifying host administrator..."

mysql \\
    --protocol=socket \\
    --user=root \\
    --password="$ROOT_PASSWORD" \\
    --batch \\
    --skip-column-names \\
    --execute="SELECT User, Host FROM mysql.user WHERE User = '$ADMIN_USERNAME';"


# ============================================================
# 8. MYSQL HARDENING
# ============================================================

echo "[8/10] Applying MySQL hardening..."


mysql \\
    --protocol=socket \\
    --user=root \\
    --password="$ROOT_PASSWORD" \\
    <<SQL

DELETE FROM mysql.user
WHERE User = ''
   OR (
        User = 'root'
        AND Host NOT IN ('localhost')
      );

DROP DATABASE IF EXISTS test;

DELETE FROM mysql.db
WHERE Db = 'test'
   OR Db LIKE 'test\\\\_%';

FLUSH PRIVILEGES;

SQL


echo "MySQL hardening completed."


# ============================================================
# 9. RESTART MYSQL AND VERIFY TCP LISTENER
# ============================================================

echo "[9/10] Restarting MySQL after hardening..."

systemctl restart mysql

sleep 5


echo "Checking MySQL TCP listener..."

TCP_READY=false

for i in $(seq 1 60); do

    if ss -lntp 2>/dev/null | grep -Eq "0\\.0\\.0\\.0:$MYSQL_PORT|\\*:$MYSQL_PORT"; then

        echo "MySQL is listening on port $MYSQL_PORT."

        TCP_READY=true
        break
    fi

    echo "Waiting for MySQL TCP listener... attempt $i/60"

    sleep 2
done


if [ "$TCP_READY" != "true" ]; then

    echo "ERROR: MySQL is not listening on port $MYSQL_PORT."

    echo "===== MYSQL SERVICE ====="
    systemctl status mysql --no-pager -l || true

    echo "===== MYSQL LISTENING PORTS ====="
    ss -lntp | grep mysqld || true

    echo "===== MYSQL EFFECTIVE CONFIG ====="
    my_print_defaults mysqld || true

    echo "===== MYSQL JOURNAL ====="
    journalctl \\
        -u mysql \\
        --no-pager \\
        -n 100 || true

    exit 1
fi


# ============================================================
# 10. FINAL MYSQL READINESS CHECK
# ============================================================

echo "[10/10] Final readiness check..."

FINAL_READY=false

for i in $(seq 1 60); do

    if mysql \\
        --host=127.0.0.1 \\
        --port="$MYSQL_PORT" \\
        --user="$ADMIN_USERNAME" \\
        --password="$ADMIN_PASSWORD" \\
        --connect-timeout=5 \\
        --batch \\
        --skip-column-names \\
        --execute="SELECT 1;" \\
        >/dev/null 2>&1; then

        echo "MYSQL_READY"

        echo "=== MySQL bootstrap completed successfully ==="

        FINAL_READY=true
        break
    fi

    echo "Final readiness check failed. Retrying..."

    sleep 2
done


if [ "$FINAL_READY" != "true" ]; then

    echo "ERROR: MySQL is installed but the final readiness check failed."

    echo "===== MYSQL SERVICE STATUS ====="
    systemctl status mysql --no-pager -l || true

    echo "===== MYSQL LISTENING PORTS ====="
    ss -lntp | grep mysqld || true

    echo "===== MYSQL EFFECTIVE DEFAULTS ====="
    my_print_defaults mysqld || true

    echo "===== MYSQL ERROR LOG ====="

    journalctl \\
        -u mysql \\
        --no-pager \\
        -n 100 || true

    exit 1
fi


# ============================================================
# CLEAN UP SENSITIVE SHELL VARIABLES
# ============================================================

unset ROOT_PASSWORD
unset ADMIN_PASSWORD
unset SECRET_JSON
unset ADMIN_USERNAME

echo "=================================================="
echo "=== MySQL bootstrap finished successfully ==="
echo "=================================================="

exit 0
"""

    return script


def build_mysql_user_data_base64(
    secret_arn: str,
    mysql_port: int = 3307,
    aws_region: str = "ap-south-1",
) -> str:
    """
    Return EC2 user-data encoded as base64,
    suitable for EC2 RunInstances.
    """

    script = build_mysql_user_data(
        secret_arn=secret_arn,
        mysql_port=mysql_port,
        aws_region=aws_region,
    )

    return base64.b64encode(
        script.encode("utf-8")
    ).decode("utf-8")