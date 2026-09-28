import json
import time
from datetime import datetime, timezone


NAMESPACE = "MultiTenantMySQL"


def utc_timestamp():
    return datetime.now(timezone.utc).isoformat()


def log_event(event, **kwargs):
    """
    Write a structured JSON log entry.
    """

    record = {
        "timestamp": utc_timestamp(),
        "event": event,
        **kwargs,
    }

    print(json.dumps(record, default=str))


def log_metric(metric_name, value, unit="Count", **dimensions):
    """
    Write a CloudWatch Embedded Metric Format log entry.
    """

    metric = {
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": NAMESPACE,
                    "Dimensions": [
                        list(dimensions.keys())
                    ] if dimensions else [],
                    "Metrics": [
                        {
                            "Name": metric_name,
                            "Unit": unit,
                        }
                    ],
                }
            ],
        },
        metric_name: value,
        **dimensions,
    }

    print(json.dumps(metric, default=str))


def log_provision_duration(duration_ms):
    """
    Record tenant/host provisioning duration.
    """

    log_metric(
        "provision_duration_ms",
        duration_ms,
        "Milliseconds",
    )


def log_failed_provision():
    """
    Record one failed provisioning attempt.
    """

    log_metric(
        "failed_provisions",
        1,
        "Count",
    )
def log_provision_attempt():
    log_metric(
        "provision_attempts",
        1,
        "Count",
    )

def log_active_tenants(count):
    """
    Record the current number of active tenants.
    """

    log_metric(
        "active_tenants",
        count,
        "Count",
    )