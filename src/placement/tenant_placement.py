import os
import boto3
from botocore.exceptions import ClientError


dynamodb = boto3.resource("dynamodb")

HOSTS_TABLE_NAME = os.environ["HOSTS_TABLE_NAME"]

hosts_table = dynamodb.Table(HOSTS_TABLE_NAME)


def find_ready_hosts():
    """
    Find MySQL hosts that are READY.

    We use a Scan for now because HostsTable currently has only
    host_id as its key. Later, we can add a GSI for better scaling.
    """

    hosts = []

    response = hosts_table.scan()

    hosts.extend(response.get("Items", []))

    while "LastEvaluatedKey" in response:
        response = hosts_table.scan(
            ExclusiveStartKey=response["LastEvaluatedKey"]
        )
        hosts.extend(response.get("Items", []))

    ready_hosts = []

    for host in hosts:
        status = host.get("status")
        tenant_count = int(host.get("tenant_count", 0))
        capacity = int(host.get("capacity", 0))

        if status == "READY" and tenant_count < capacity:
            ready_hosts.append(host)

    return ready_hosts


def reserve_host_slot(host_id: str):
    """
    Atomically reserve one tenant slot.

    This is the important concurrency protection.

    The update will succeed only when:
        status == READY
        AND tenant_count < capacity

    DynamoDB checks this condition atomically.
    """

    try:
        response = hosts_table.update_item(
            Key={
                "host_id": host_id
            },

            UpdateExpression="""
                SET tenant_count = tenant_count + :one
            """,

            ConditionExpression="""
                #status = :ready
                AND tenant_count < #capacity
            """,

            ExpressionAttributeNames={
                "#status": "status",
                "#capacity": "capacity"
            },

            ExpressionAttributeValues={
                ":one": 1,
                ":ready": "READY"
            },

            ReturnValues="ALL_NEW"
        )

        return response["Attributes"]

    except ClientError as error:

        if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None

        raise


def find_and_reserve_host():
    """
    Find a suitable READY host and atomically reserve a tenant slot.

    Returns:
        Updated host record if successful
        None if no host has available capacity
    """

    ready_hosts = find_ready_hosts()

    # Sort so that the host with fewer tenants is tried first.
    ready_hosts.sort(
        key=lambda host: int(host.get("tenant_count", 0))
    )

    for host in ready_hosts:

        host_id = host["host_id"]

        updated_host = reserve_host_slot(host_id)

        if updated_host is not None:

            return updated_host

    return None


def handler(event, context):

    tenant_id = event.get("tenant_id")

    if not tenant_id:
        return {
            "statusCode": 400,
            "body": {
                "message": "tenant_id is required"
            }
        }

    host = find_and_reserve_host()

    if host is None:

        return {
            "statusCode": 409,
            "body": {
                "message": "No READY host has available capacity",
                "tenant_id": tenant_id,
                "action": "PROVISION_NEW_HOST"
            }
        }

    return {
        "statusCode": 200,
        "body": {
            "message": "Host reserved successfully",
            "tenant_id": tenant_id,
            "host_id": host["host_id"],
            "private_ip": host.get("private_ip"),
            "mysql_port": host.get("mysql_port"),
            "tenant_count": int(host.get("tenant_count", 0)),
            "capacity": int(host.get("capacity", 0)),
            "status": host.get("status")
        }
    }