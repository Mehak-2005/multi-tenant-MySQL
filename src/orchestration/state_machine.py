"""
Job state machine for multi-tenant MySQL provisioning.

Defines the valid states and allowed state transitions.
"""

JOB_STATES = {
    "PENDING",
    "BOOTSTRAPPING",
    "READY",
    "FAILED",
    "TERMINATED",
}


ALLOWED_TRANSITIONS = {
    "PENDING": {
        "BOOTSTRAPPING",
    },
    "BOOTSTRAPPING": {
        "READY",
        "FAILED",
    },
    "READY": {
        "TERMINATED",
    },
    "FAILED": {
        "TERMINATED",
    },
    "TERMINATED": set(),
}