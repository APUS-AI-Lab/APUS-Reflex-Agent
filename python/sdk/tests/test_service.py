"""HTTP service behavior: per-run sessions, real cancellation, and honest status."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import pytest

from deepseek_harness.api import DeepSeekHarnessConfig, RunResult
from deepseek_harness.models import Notification
from deepseek_harness.service import HarnessService


@dataclass
class _FakeResult:
    final_response: str
    finish_reason: str | None
    session_id: str
    events: list
    notifications: list


class _FakeHarness:
    """Stands in for ``DeepSeekHarness``; every run blocks until released."""

    def __init__(self) -> None:
        self.started = 0
        self.prompts: list[tuple[str, str]] = []
        self.cancelled: list[str] = []
        self.cancel_failure: Exception | None = None
        self.gate = threading.Event()
        self.started_gate = threading.Event()

    def start(self) -> None:
        self.started += 1

    def run(
        self,
        instruction: str,
        *,
        session_id: str | None = None,
        before_deliver=None,
    ) -> RunResult:
        if before_deliver is not None:
            before_deliver()
        self.prompts.append((instruction, session_id or ""))
        self.started_gate.set()
        self.gate.wait(timeout=5)
        notifications = [
            Notification(method="session.status", payload={"status": "idle"})
        ]
        return _FakeResult(
            final_response="done",
            finish_reason="completed",
            session_id=session_id or "",
            events=[],
            notifications=notifications,
        )

    def cancel_session(self, session_id: str) -> None:
        self.cancelled.append(session_id)
        if self.cancel_failure is not None:
            raise self.cancel_failure
        self.gate.set()


def _service(harness: _FakeHarness) -> HarnessService:
    service = HarnessService(DeepSeekHarnessConfig())
    # The fake owns no subprocess, so it is installed directly.
    service._harness = harness
    return service


def _wait_for(predicate, description: str, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.005)
    raise AssertionError(f"timed out waiting for {description}")


def test_start_run_reuses_an_explicit_session_across_steps() -> None:
    harness = _FakeHarness()
    service = _service(harness)

    first = service.start_run({"instruction": "step one", "session_id": "case-42"})
    _wait_for(lambda: harness.started == 1, "the first step to start")
    second = service.start_run({"instruction": "step two", "session_id": "case-42"})
    _wait_for(lambda: len(harness.prompts) == 2, "both steps to reach the harness")

    assert first != second
    assert [session for _instruction, session in harness.prompts] == [
        "case-42",
        "case-42",
    ]


def test_start_run_defaults_to_one_fresh_session_per_run() -> None:
    harness = _FakeHarness()
    service = _service(harness)

    first = service.start_run({"instruction": "one"})
    second = service.start_run({"instruction": "two"})
    _wait_for(lambda: len(harness.prompts) == 2, "both runs to reach the harness")

    sessions = {session for _instruction, session in harness.prompts}
    assert len(sessions) == 2
    assert all(session for session in sessions)
    assert first != second


@pytest.mark.parametrize("value", ["", 7, ["a"]])
def test_start_run_rejects_a_malformed_session_id(value: object) -> None:
    service = _service(_FakeHarness())
    with pytest.raises(ValueError, match="session_id"):
        service.start_run({"instruction": "work", "session_id": value})


def test_cancel_stops_only_the_named_run_session() -> None:
    harness = _FakeHarness()
    service = _service(harness)
    first = service.start_run({"instruction": "first", "session_id": "session-one"})
    second = service.start_run({"instruction": "second", "session_id": "session-two"})
    _wait_for(lambda: len(harness.prompts) == 2, "both runs to start")

    assert service.cancel(first) is True
    assert harness.cancelled == ["session-one"]
    assert service.run_state(first) == {"run_id": first, "status": "cancelled"}

    # The other run keeps its own work and reaches its result.
    _wait_for(
        lambda: service.run_state(second)["status"] == "completed",
        "the untouched run to finish",
    )
    assert service.run_state(second)["final_response"] == "done"


def test_cancel_before_the_run_starts_prevents_it_from_starting() -> None:
    """A cancel while the shared harness is still starting must send no prompt."""

    class _SlowStartHarness(_FakeHarness):
        def __init__(self) -> None:
            super().__init__()
            self.starting = threading.Event()
            self.release_start = threading.Event()

        def start(self) -> None:
            self.starting.set()
            self.release_start.wait(timeout=5)
            super().start()

    harness = _SlowStartHarness()
    service = HarnessService(DeepSeekHarnessConfig())
    service._harness = harness
    run_id = service.start_run({"instruction": "late", "session_id": "pending"})
    _wait_for(lambda: harness.starting.is_set(), "the shared start to begin")

    # The worker is blocked inside start(); the cancel lands before any prompt.
    service.cancel(run_id)
    harness.release_start.set()

    _wait_for(
        lambda: service.run_state(run_id).get("status") == "cancelled",
        "the run to report its cancellation",
    )
    time.sleep(0.05)
    assert harness.prompts == []


def test_run_state_reports_cancelling_until_the_harness_confirms() -> None:
    """A settled worker must not be published as cancelled before confirmation."""
    turn_running = threading.Event()
    settle_turn = threading.Event()
    cancel_reached = threading.Event()
    confirm_cancel = threading.Event()

    class _ConfirmGatedHarness(_FakeHarness):
        def run(self, instruction: str, *, session_id=None, before_deliver=None):
            if before_deliver is not None:
                before_deliver()
            self.prompts.append((instruction, session_id or ""))
            turn_running.set()
            settle_turn.wait(timeout=5)
            return _FakeResult("aborted", "aborted", session_id or "", [], [])

        def cancel_session(self, session_id: str) -> None:
            self.cancelled.append(session_id)
            cancel_reached.set()
            confirm_cancel.wait(timeout=5)

    harness = _ConfirmGatedHarness()
    service = _service(harness)
    run_id = service.start_run({"instruction": "work", "session_id": "slow"})
    _wait_for(turn_running.is_set, "the turn to start")

    outcome: dict[str, object] = {}

    def run_cancel() -> None:
        outcome["result"] = service.cancel(run_id)

    cancel = threading.Thread(target=run_cancel, daemon=True)
    cancel.start()
    _wait_for(cancel_reached.is_set, "the cancel to reach the harness")
    # Cancel is in flight: not yet confirmed.
    assert service.run_state(run_id) == {"run_id": run_id, "status": "cancelling"}

    # The turn now settles while the harness still has not confirmed the stop.
    settle_turn.set()
    # The worker's run() returns; its own thread may still be unwinding, so the
    # available evidence is that the turn is no longer blocked.
    time.sleep(0.15)
    assert service.run_state(run_id) == {"run_id": run_id, "status": "cancelling"}
    assert "result" not in outcome

    confirm_cancel.set()
    cancel.join(timeout=5)
    assert outcome["result"] is True
    assert service.run_state(run_id) == {"run_id": run_id, "status": "cancelled"}


def test_cancel_waits_for_an_in_progress_shared_start() -> None:
    """A harness assigned but still starting must not be cancelled mid-handshake."""
    starting = threading.Event()
    finish_start = threading.Event()
    calls: list[str] = []

    class _StartingHarness(_FakeHarness):
        def start(self) -> None:
            starting.set()
            finish_start.wait(timeout=5)
            calls.append("start")
            super().start()

        def cancel_session(self, session_id: str) -> None:
            # Reaching this only after start completed is the contract.
            calls.append("cancel")
            super().cancel_session(session_id)

    harness = _StartingHarness()
    service = HarnessService(DeepSeekHarnessConfig())
    # The shared harness exists but its start() is what the worker is inside.
    service._harness = harness
    run_id = service.start_run({"instruction": "work", "session_id": "starting"})
    _wait_for(starting.is_set, "the shared start to begin")
    assert calls == []

    result: dict[str, object] = {}

    def run_cancel() -> None:
        result["value"] = service.cancel(run_id)

    cancel = threading.Thread(target=run_cancel, daemon=True)
    cancel.start()
    time.sleep(0.1)
    # Blocked behind the start lock; it must not call cancel_session yet.
    assert cancel.is_alive()
    assert calls == []

    finish_start.set()
    cancel.join(timeout=5)
    assert result["value"] is True
    # The start finished before the cancellation was issued.
    assert calls == ["start", "cancel"]
    assert service.run_state(run_id)["status"] == "cancelled"
    assert harness.prompts == []


def test_a_cancel_landing_before_delivery_sends_no_prompt() -> None:
    """The decision is re-read at the delivery point, not only at thread start."""

    class _GatedHarness(_FakeHarness):
        def __init__(self) -> None:
            super().__init__()
            self.delivering = threading.Event()
            self.release = threading.Event()

        def run(self, instruction: str, *, session_id=None, before_deliver=None):
            self.delivering.set()
            self.release.wait(timeout=5)
            if before_deliver is not None:
                before_deliver()
            self.prompts.append((instruction, session_id or ""))
            self.gate.set()
            return _FakeResult(
                final_response="done",
                finish_reason="completed",
                session_id=session_id or "",
                events=[],
                notifications=[],
            )

    harness = _GatedHarness()
    service = _service(harness)
    run_id = service.start_run({"instruction": "race", "session_id": "raced"})
    _wait_for(lambda: harness.delivering.is_set(), "the run to reach delivery")

    harness.release.set()
    service.cancel(run_id)

    assert harness.prompts == []
    assert service.run_state(run_id) == {"run_id": run_id, "status": "cancelled"}


def test_a_cancellation_failure_is_reported_and_never_claimed_as_success() -> None:
    harness = _FakeHarness()
    harness.cancel_failure = RuntimeError("agent did not stop")
    service = _service(harness)
    run_id = service.start_run({"instruction": "stuck", "session_id": "stuck"})
    _wait_for(lambda: len(harness.prompts) == 1, "the run to start")

    with pytest.raises(RuntimeError, match="agent did not stop"):
        service.cancel(run_id)

    state = service.run_state(run_id)
    assert state["status"] == "failed"
    assert "cancellation failed" in state["error"]


def test_a_finished_run_keeps_its_outcome_when_cancel_arrives_afterwards() -> None:
    harness = _FakeHarness()
    service = _service(harness)
    run_id = service.start_run({"instruction": "quick", "session_id": "quick"})
    _wait_for(lambda: len(harness.prompts) == 1, "the run to start")
    harness.gate.set()
    _wait_for(
        lambda: service.run_state(run_id)["status"] == "completed",
        "the run to complete",
    )

    assert service.cancel(run_id) is True
    assert service.run_state(run_id)["status"] == "completed"
    assert harness.cancelled == []


def test_http_service_has_a_finite_control_request_budget(monkeypatch):
    from deepseek_harness.service import config_from_environment

    for key in ("LLM_PROVIDER", "LLM_MODEL", "LLM_BASE_URL", "LLM_API_KEY"):
        monkeypatch.setenv(key, "unit-test")
    monkeypatch.delenv("DSH_REQUEST_TIMEOUT_SECONDS", raising=False)
    config = config_from_environment()
    assert config.request_timeout_seconds == 30.0


def test_http_cancel_keeps_an_already_completed_outcome():
    import json
    import urllib.request
    from http.server import ThreadingHTTPServer
    from deepseek_harness.service import _handler

    harness = _FakeHarness()
    harness.gate.set()
    service = _service(harness)
    run_id = service.start_run({"instruction": "done"})
    _wait_for(lambda: service.run_state(run_id)["status"] == "completed", "completion")
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(service))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/v1/runs/{run_id}/cancel",
            data=b"",
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            assert json.load(response)["status"] == "completed"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
