import json
import os
import re
from decimal import Decimal
from datetime import date, datetime

import boto3
import pymysql
from botocore.exceptions import ClientError


# ==========================================================
# ENVIRONMENT
# ==========================================================

TENANTS_TABLE_NAME = os.environ["TENANTS_TABLE_NAME"]

HOSTS_TABLE_NAME = os.environ["HOSTS_TABLE_NAME"]

MYSQL_PORT = int(
    os.environ.get(
        "MYSQL_PORT",
        "3307"
    )
)

ENVIRONMENT = os.environ.get(
    "ENVIRONMENT",
    "dev"
)


# ==========================================================
# AWS CLIENTS
# ==========================================================

dynamodb = boto3.resource(
    "dynamodb"
)

tenants_table = dynamodb.Table(
    TENANTS_TABLE_NAME
)

hosts_table = dynamodb.Table(
    HOSTS_TABLE_NAME
)

secretsmanager = boto3.client(
    "secretsmanager"
)


# ==========================================================
# SECURITY SETTINGS
# ==========================================================

MAX_SQL_LENGTH = 10000


# Statements that can change security boundaries,
# databases, users, permissions, or server-level settings.
BLOCKED_SQL_PATTERNS = [

    r"\bDROP\s+DATABASE\b",

    r"\bCREATE\s+DATABASE\b",

    r"\bALTER\s+DATABASE\b",

    r"\bDROP\s+USER\b",

    r"\bCREATE\s+USER\b",

    r"\bALTER\s+USER\b",

    r"\bRENAME\s+USER\b",

    r"\bGRANT\b",

    r"\bREVOKE\b",

    r"\bUSE\s+[`A-Za-z0-9_$-]+\b",

    r"\bSET\s+GLOBAL\b",

    r"\bSET\s+PERSIST\b",

    r"\bSET\s+PASSWORD\b",

    r"\bSHUTDOWN\b",

    r"\bFLUSH\s+PRIVILEGES\b",

    r"\bRESET\s+MASTER\b",

    r"\bINSTALL\s+PLUGIN\b",

    r"\bUNINSTALL\s+PLUGIN\b",

    r"\bLOAD\s+DATA\s+INFILE\b",

    r"\bLOAD\s+XML\b",

]


# ==========================================================
# HELPERS
# ==========================================================

def response(status_code, body):
    """
    Create a standard Lambda response.
    """

    return {
        "statusCode": status_code,
        "body": body
    }


# ==========================================================
# SECRETS MANAGER
# ==========================================================

def get_secret(secret_arn):
    """
    Read a secret from AWS Secrets Manager.

    Secret contents are never printed or returned directly.
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

    return json.loads(
        secret_string
    )


# ==========================================================
# JSON SERIALIZATION
# ==========================================================

def json_safe(value):
    """
    Convert MySQL/DynamoDB values into
    JSON-safe values.
    """

    if isinstance(
        value,
        Decimal
    ):

        if value == value.to_integral_value():

            return int(value)

        return float(value)

    if isinstance(
        value,
        (
            datetime,
            date
        )
    ):

        return value.isoformat()

    if isinstance(
        value,
        bytes
    ):

        return value.decode(
            "utf-8",
            errors="replace"
        )

    if isinstance(
        value,
        dict
    ):

        return {
            str(key): json_safe(val)
            for key, val in value.items()
        }

    if isinstance(
        value,
        (
            list,
            tuple
        )
    ):

        return [
            json_safe(item)
            for item in value
        ]

    return value


# ==========================================================
# SQL SECURITY
# ==========================================================

def remove_sql_comments(sql):
    """
    Remove common SQL comments before security validation.

    This prevents simple comment-based bypasses such as:

        DR/*comment*/OP DATABASE ...

    or:

        DROP -- comment
        DATABASE ...

    Security validation is intentionally conservative.
    """

    # Remove block comments.
    sql = re.sub(
        r"/\*.*?\*/",
        " ",
        sql,
        flags=re.DOTALL
    )

    # Remove MySQL # comments.
    sql = re.sub(
        r"#.*?$",
        " ",
        sql,
        flags=re.MULTILINE
    )

    # Remove -- comments.
    sql = re.sub(
        r"--[ \t].*$",
        " ",
        sql,
        flags=re.MULTILINE
    )

    return sql


def has_multiple_statements(sql):
    """
    Detect multiple SQL statements separated by semicolons.

    A single trailing semicolon is allowed:

        SELECT * FROM users;

    But this is rejected:

        SELECT * FROM users;
        DROP DATABASE something;
    """

    quote = None
    escaped = False
    semicolon_positions = []

    for index, character in enumerate(sql):

        if escaped:

            escaped = False

            continue

        if character == "\\":
            escaped = True
            continue

        if quote:

            if character == quote:
                quote = None

            continue

        if character in (
            "'",
            '"',
            "`"
        ):

            quote = character

            continue

        if character == ";":

            semicolon_positions.append(
                index
            )

    if not semicolon_positions:

        return False

    # More than one semicolon means multiple statements.
    if len(semicolon_positions) > 1:

        return True

    # One semicolon is allowed only if it is the final
    # non-whitespace character.
    semicolon_position = semicolon_positions[0]

    remaining = sql[
        semicolon_position + 1:
    ].strip()

    return bool(remaining)


def contains_blocked_statement(sql):
    """
    Check for dangerous SQL statements that can modify
    database security boundaries or server configuration.
    """

    for pattern in BLOCKED_SQL_PATTERNS:

        if re.search(
            pattern,
            sql,
            flags=re.IGNORECASE
        ):

            return True

    return False


def extract_database_references(sql):
    """
    Find explicit database.table references used in
    FROM, JOIN, UPDATE, INTO and TABLE clauses.

    Examples detected:

        other_db.users
        another_database.orders
        `other_db`.`users`

    Normal column references such as:

        users.id

    are not treated as database references unless they
    appear in a table-selection position.
    """

    pattern = re.compile(
        r"""
        \b
        (?:FROM|JOIN|INTO|UPDATE|TABLE)
        \s+

        (
            `[^`]+`
            |
            [A-Za-z0-9_$-]+
        )

        \s*\.\s*

        (
            `[^`]+`
            |
            [A-Za-z0-9_$-]+
        )
        """,
        flags=re.IGNORECASE | re.VERBOSE
    )

    references = []

    for match in pattern.finditer(sql):

        database_name = match.group(
            1
        )

        database_name = database_name.strip(
            "`"
        )

        references.append(
            database_name
        )

    return references


def validate_sql_security(
    sql,
    tenant_database
):
    """
    Validate a SQL statement before sending it to MySQL.

    Security rules:

    1. SQL must be one statement.
    2. Dangerous database/security operations are blocked.
    3. Explicit cross-database references are blocked.
    4. The tenant database is the only allowed database.
    """

    normalized_sql = remove_sql_comments(
        sql
    ).strip()

    if not normalized_sql:

        raise ValueError(
            "SQL statement is empty"
        )

    # ------------------------------------------------------
    # MULTIPLE STATEMENT PROTECTION
    # ------------------------------------------------------

    if has_multiple_statements(
        normalized_sql
    ):

        raise ValueError(
            "Multiple SQL statements are not allowed"
        )

    # ------------------------------------------------------
    # DANGEROUS STATEMENT PROTECTION
    # ------------------------------------------------------

    if contains_blocked_statement(
        normalized_sql
    ):

        raise ValueError(
            "This SQL operation is not allowed"
        )

    # ------------------------------------------------------
    # CROSS-DATABASE PROTECTION
    # ------------------------------------------------------

    database_references = (
        extract_database_references(
            normalized_sql
        )
    )

    for referenced_database in database_references:

        if referenced_database.lower() != (
            tenant_database.lower()
        ):

            raise ValueError(
                "Cross-database access is not allowed"
            )

    return normalized_sql


# ==========================================================
# MYSQL CONNECTION
# ==========================================================

def connect_to_mysql(
    host,
    port,
    username,
    password,
    database
):
    """
    Connect to MySQL using the tenant-specific
    credentials and tenant-specific database.

    The database parameter is fixed by the tenant record
    and is NOT taken from the user's SQL request.
    """

    return pymysql.connect(
        host=host,
        port=port,
        user=username,
        password=password,
        database=database,
        connect_timeout=10,
        read_timeout=30,
        write_timeout=30,
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor
    )


# ==========================================================
# HANDLER
# ==========================================================

def handler(
    event,
    context
):

    tenant_id = event.get(
        "tenant_id"
    )

    sql = event.get(
        "sql"
    )


    # ======================================================
    # 1. BASIC INPUT VALIDATION
    # ======================================================

    if not tenant_id:

        return response(
            400,
            {
                "message":
                    "tenant_id is required"
            }
        )


    if not sql:

        return response(
            400,
            {
                "message":
                    "sql is required"
            }
        )


    if not isinstance(
        sql,
        str
    ):

        return response(
            400,
            {
                "message":
                    "sql must be a string"
            }
        )


    sql = sql.strip()


    if not sql:

        return response(
            400,
            {
                "message":
                    "sql cannot be empty"
            }
        )


    # ------------------------------------------------------
    # QUERY SIZE LIMIT
    # ------------------------------------------------------

    if len(sql) > MAX_SQL_LENGTH:

        return response(
            400,
            {
                "message":
                    "SQL statement is too long",

                "max_length":
                    MAX_SQL_LENGTH
            }
        )


    connection = None


    try:

        # ==================================================
        # 2. GET TENANT RECORD
        # ==================================================

        tenant_result = tenants_table.get_item(
            Key={
                "tenant_id":
                    tenant_id
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


        # ==================================================
        # 3. TENANT MUST BE READY
        # ==================================================

        tenant_status = tenant.get(
            "status"
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
        # 4. GET TENANT INFORMATION
        # ==================================================

        host_id = tenant.get(
            "host_id"
        )

        database_name = tenant.get(
            "database_name"
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


        if not credentials_secret_arn:

            raise RuntimeError(
                "Tenant credentials secret ARN is missing"
            )


        # ==================================================
        # 5. SECURITY VALIDATION
        # ==================================================
        #
        # IMPORTANT:
        #
        # The database is obtained from DynamoDB.
        #
        # The user cannot choose another database.
        #
        # ==================================================

        try:

            validate_sql_security(
                sql=sql,
                tenant_database=database_name
            )

        except ValueError as security_error:

            return response(
                403,
                {
                    "message":
                        "SQL query rejected by security policy",

                    "tenant_id":
                        tenant_id,

                    "reason":
                        str(security_error)
                }
            )


        # ==================================================
        # 6. GET HOST
        # ==================================================

        host_result = hosts_table.get_item(
            Key={
                "host_id":
                    host_id
            }
        )

        host_record = host_result.get(
            "Item"
        )


        if not host_record:

            return response(
                404,
                {
                    "message":
                        "Host not found",

                    "host_id":
                        host_id
                }
            )


        # ==================================================
        # 7. HOST MUST BE READY
        # ==================================================

        if host_record.get(
            "status"
        ) != "READY":

            return response(
                409,
                {
                    "message":
                        "Host is not READY",

                    "host_id":
                        host_id,

                    "status":
                        host_record.get(
                            "status"
                        )
                }
            )


        private_ip = host_record.get(
            "private_ip"
        )


        mysql_port = int(
            host_record.get(
                "mysql_port",
                MYSQL_PORT
            )
        )


        if not private_ip:

            raise RuntimeError(
                "Host private IP is missing"
            )


        # ==================================================
        # 8. READ TENANT CREDENTIAL SECRET
        # ==================================================

        tenant_secret = get_secret(
            credentials_secret_arn
        )


        mysql_username = tenant_secret.get(
            "username"
        )

        mysql_password = tenant_secret.get(
            "password"
        )

        secret_database = tenant_secret.get(
            "database"
        )


        if not mysql_username:

            raise RuntimeError(
                "Tenant MySQL username is missing"
            )


        if not mysql_password:

            raise RuntimeError(
                "Tenant MySQL password is missing"
            )


        # ==================================================
        # 9. VERIFY SECRET DATABASE
        # ==================================================
        #
        # Defense-in-depth check.
        #
        # The database stored in Secrets Manager must
        # match the database stored in DynamoDB.
        #
        # ==================================================

        if secret_database:

            if secret_database != database_name:

                raise RuntimeError(
                    "Tenant database mismatch detected"
                )


        # ==================================================
        # 10. CONNECT USING TENANT USER
        # ==================================================
        #
        # This is the second security boundary.
        #
        # Even if someone bypassed the application-level
        # SQL validation, the MySQL user itself only has
        # privileges on its tenant database.
        #
        # ==================================================

        connection = connect_to_mysql(
            host=private_ip,
            port=mysql_port,
            username=mysql_username,
            password=mysql_password,
            database=database_name
        )


        # ==================================================
        # 11. EXECUTE ONE SQL STATEMENT
        # ==================================================

        with connection.cursor() as cursor:

            cursor.execute(
                sql
            )

            rows = []

            if cursor.description:

                rows = cursor.fetchall()

            affected_rows = cursor.rowcount


        # ==================================================
        # 12. RETURN RESULT
        # ==================================================
        #
        # IMPORTANT:
        #
        # Do NOT return the original SQL.
        #
        # SQL could contain sensitive values such as:
        #
        # INSERT INTO users(password) VALUES(...)
        #
        # ==================================================

        return response(
            200,
            {
                "message":
                    "SQL executed successfully",

                "tenant_id":
                    tenant_id,

                "database_name":
                    database_name,

                "affected_rows":
                    affected_rows,

                "rows":
                    json_safe(rows)
            }
        )


    # ======================================================
    # MYSQL ERRORS
    # ======================================================

    except pymysql.MySQLError as error:
        # Do not log the SQL, username password,
        # or Secrets Manager contents.
        print(
            json.dumps(
                {
                    "event":"tenant_query_mysql_error",
                    "tenant_id":tenant_id,
                    "error_type":type(error).__name__,
                    "error_code": getattr(error, "args", [None])[0],
                    "error_message": str(error),
                },
                default=str
            )
        )


        return response(
            400,
            {
                "message": "SQL execution failed",
                "tenant_id":tenant_id,
                "error_type":type(error).__name__
            }
        )


    # ======================================================
    # AWS ERRORS
    # ======================================================

    except ClientError as error:

        error_code = (
            error.response
            .get(
                "Error",
                {}
            )
            .get(
                "Code",
                "Unknown"
            )
        )


        print(
            json.dumps(
                {
                    "event":
                        "tenant_query_aws_error",

                    "tenant_id":
                        tenant_id,

                    "error_code":
                        error_code
                }
            )
        )


        return response(
            500,
            {
                "message":
                    "Failed to execute tenant query",

                "tenant_id":
                    tenant_id,

                "error_code":
                    error_code
            }
        )


    # ======================================================
    # GENERAL ERRORS
    # ======================================================

    except Exception as error:

        print(
            json.dumps(
                {
                    "event":
                        "tenant_query_error",

                    "tenant_id":
                        tenant_id,

                    "error_type":
                        type(error).__name__
                }
            )
        )


        return response(
            500,
            {
                "message":
                    "Tenant query failed",

                "tenant_id":
                    tenant_id,

                "error_type":
                    type(error).__name__
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