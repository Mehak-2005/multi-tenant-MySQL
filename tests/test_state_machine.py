from src.orchestration.state_machine import (
    JOB_STATES,
    ALLOWED_TRANSITIONS,
)


def test_job_states_exist():
    assert "PENDING" in JOB_STATES
    assert "BOOTSTRAPPING" in JOB_STATES
    assert "READY" in JOB_STATES
    assert "FAILED" in JOB_STATES
    assert "TERMINATED" in JOB_STATES


def test_pending_can_move_to_bootstrapping():
    assert "BOOTSTRAPPING" in ALLOWED_TRANSITIONS["PENDING"]


def test_bootstrapping_can_move_to_ready():
    assert "READY" in ALLOWED_TRANSITIONS["BOOTSTRAPPING"]


def test_bootstrapping_can_move_to_failed():
    assert "FAILED" in ALLOWED_TRANSITIONS["BOOTSTRAPPING"]


def test_ready_can_move_to_terminated():
    assert "TERMINATED" in ALLOWED_TRANSITIONS["READY"]


def test_terminated_has_no_next_state():
    assert ALLOWED_TRANSITIONS["TERMINATED"] == set()


def test_pending_cannot_directly_move_to_ready():
    assert "READY" not in ALLOWED_TRANSITIONS["PENDING"]