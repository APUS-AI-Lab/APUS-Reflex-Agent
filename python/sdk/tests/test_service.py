"""HTTP service behavior: per-run sessions, real cancellation, and honest status."""

from __future__ import annotations

import threading
import time
from typing import Any
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
        # The notifications this fake reports while the run executes. A test
        # that needs several events replaces them; the default is one event and
        # one status, which is what a one-step turn produces.
        self.notifications: list[Notification] | None = None
        # An exception the run raises instead of returning, which is how a
        # cancelled run surfaces: the harness aborts the turn.
        self.fail_with: BaseException | None = None

    def start(self) -> None:
        self.started += 1

    def run(
        self,
        instruction: str,
        *,
        session_id: str | None = None,
        before_deliver=None,
        on_notification=None,
        cwd=None,
        agent_preset=None,
    ) -> RunResult:
        self.requested_cwd = cwd
        self.requested_preset = agent_preset
        if before_deliver is not None:
            before_deliver()
        self.prompts.append((instruction, session_id or ""))
        self.started_gate.set()
        self.gate.wait(timeout=5)
        if self.fail_with is not None:
            raise self.fail_with
        notifications = self.notifications or [
            Notification(
                method="session.event",
                payload={
                    "sessionId": session_id or "",
                    "event": {
                        "type": "turn/start",
                        "seq": 1,
                        "time": 1,
                        "data": {"turn": 1},
                    },
                },
            ),
            Notification(method="session.status", payload={"status": "idle"}),
        ]
        if on_notification is not None:
            for notification in notifications:
                on_notification(notification)
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
    # The fake owns no subprocess, so it is installed as the only route's
    # instance. Every run in these tests names no route, so they all reach it.
    return HarnessService(
        DeepSeekHarnessConfig(), harness_factory=lambda _config: harness
    )


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
    service = HarnessService(
        DeepSeekHarnessConfig(), harness_factory=lambda _config: harness
    )
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
    # The harness exists but its start() is what the worker is inside; the
    # factory returns it once, then the service holds it as this route's one.
    service = HarnessService(
        DeepSeekHarnessConfig(), harness_factory=lambda _config: harness
    )
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
    service._api_token = "test-token"
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
            headers={"Authorization": "Bearer test-token"},
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            assert json.load(response)["status"] == "completed"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class _RecordingHarness(_FakeHarness):
    """One harness instance per model route, so the route a run used is visible."""

    def __init__(self, config) -> None:
        super().__init__()
        self.config = config

    def run(self, instruction, *, session_id=None, before_deliver=None):
        self.gate.set()
        return super().run(
            instruction, session_id=session_id, before_deliver=before_deliver
        )


@dataclass
class _Routes:
    """Stands in for the harness factory: one instance keyed by model route."""

    created: list = None

    def __post_init__(self) -> None:
        self.created = []

    def __call__(self, config) -> _RecordingHarness:
        harness = _RecordingHarness(config)
        self.created.append(harness)
        return harness


def test_two_runs_can_name_different_models_within_one_service() -> None:
    routes = _Routes()
    service = HarnessService(
        DeepSeekHarnessConfig(model="default-model"), harness_factory=routes
    )
    for harness in routes.created:
        harness.gate.set()

    first = service.start_run({"instruction": "one", "llm": {"model": "model-a"}})
    _wait_for(lambda: service.run_state(first)["status"] == "completed", "first run")
    second = service.start_run({"instruction": "two", "llm": {"model": "model-b"}})
    _wait_for(lambda: service.run_state(second)["status"] == "completed", "second run")

    models = sorted(h.config.model for h in routes.created if h.prompts)
    assert models == ["model-a", "model-b"], models


def test_a_run_without_a_route_reuses_the_deployment_model() -> None:
    routes = _Routes()
    service = HarnessService(
        DeepSeekHarnessConfig(model="default-model"), harness_factory=routes
    )
    for harness in routes.created:
        harness.gate.set()

    run_id = service.start_run({"instruction": "plain"})
    _wait_for(lambda: service.run_state(run_id)["status"] == "completed", "run")

    assert len(routes.created) == 1
    assert routes.created[0].config.model == "default-model"


def test_a_malformed_route_is_refused_before_any_run_starts() -> None:
    routes = _Routes()
    service = HarnessService(
        DeepSeekHarnessConfig(model="default-model"), harness_factory=routes
    )
    with pytest.raises(ValueError):
        service.start_run({"instruction": "x", "llm": {"model": ""}})
    with pytest.raises(ValueError):
        service.start_run({"instruction": "x", "llm": {"base_url": "not-a-url"}})
    assert routes.created == []


def test_closing_the_service_stops_every_route_it_started() -> None:
    """One service holds a harness per route; each owns its own runtime."""
    closed: list[str] = []

    class _Closable(_FakeHarness):
        def __init__(self, config) -> None:
            super().__init__()
            self.config = config
            self.gate.set()

        def close(self) -> None:
            closed.append(self.config.model)

    def factory(config):
        return _Closable(config)

    service = HarnessService(
        DeepSeekHarnessConfig(model="base"), harness_factory=factory
    )
    for model in ("model-a", "model-b"):
        run_id = service.start_run({"instruction": "x", "llm": {"model": model}})
        _wait_for(lambda: service.run_state(run_id)["status"] == "completed", "run")

    service.close()

    assert sorted(closed) == ["model-a", "model-b"]


def test_closing_twice_is_harmless() -> None:
    class _Closable(_FakeHarness):
        def __init__(self, config) -> None:
            super().__init__()
            self.gate.set()

        def close(self) -> None:
            return None

    service = HarnessService(
        DeepSeekHarnessConfig(), harness_factory=lambda c: _Closable(c)
    )
    run_id = service.start_run({"instruction": "x"})
    _wait_for(lambda: service.run_state(run_id)["status"] == "completed", "run")
    service.close()
    service.close()


def test_a_finished_run_reports_its_outcome_to_the_caller_named_endpoint() -> None:
    """The evaluator is told the result; it does not poll for it.

    A task can run for hours, so the HTTP request that submitted it returns as
    soon as the run is accepted. The outcome then reaches the caller through the
    callback it named, which is the only way it learns the run finished.
    """
    harness = _FakeHarness()
    service = _service(harness)
    delivered: list[dict[str, Any]] = []

    class _Sink:
        def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
            delivered.append({"url": url, **payload})

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _config: harness,
        result_callback=_Sink(),
    )
    service.start_run(
        {
            "instruction": "do it",
            "request_id": "req-1",
            "callback_url": "http://benchmark.invalid/v1/jobs/job-1/backend-result",
        }
    )
    # The fake harness holds the turn open until released, as a real one does.
    _wait_for(lambda: harness.started_gate.is_set(), "the run to reach the harness")
    harness.gate.set()
    _wait_for(lambda: delivered, "the finished run to report back")

    assert delivered[0]["url"].endswith("/backend-result")
    assert delivered[0]["request_id"] == "req-1"
    assert delivered[0]["status"] == "succeeded"


def test_result_callback_does_not_repeat_the_full_event_history() -> None:
    """Event callbacks already carry each native event; the result stays small."""
    harness = _FakeHarness()
    delivered: list[dict[str, Any]] = []

    class _Sink:
        def post(self, url, payload, timeout):
            delivered.append(payload)

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _: harness,
        result_callback=_Sink(),
    )
    try:
        run_id = service.start_run(
            {
                "instruction": "do it",
                "session_id": "case-small-result",
                "callback_url": "http://benchmark.invalid/jobs/one/backend-result",
            }
        )
        harness.gate.set()
        _wait_for(lambda: delivered, "the result callback")

        result = delivered[0]["result"]
        assert result["final_response"] == "done"
        assert result["finish_reason"] == "completed"
        assert result["session_id"] == "case-small-result"
        assert "events" not in result
        assert "notifications" not in result
        state = service.run_state(run_id)
        assert state["events"] == []
        assert state["notifications"][0]["method"] == "session.event"
    finally:
        harness.gate.set()
        service.close()


def test_pending_legacy_result_is_compacted_on_recovery_without_rerunning(
    tmp_path, monkeypatch
) -> None:
    import json

    monkeypatch.setenv("DSH_DELIVERY_MAX_ATTEMPTS", "1")
    monkeypatch.setenv("DSH_DELIVERY_RECOVERY_ATTEMPTS", "0")
    harness = _FakeHarness()
    harness.gate.set()

    class _Unavailable:
        def post(self, url, payload, timeout):
            raise OSError("unavailable")

    config = DeepSeekHarnessConfig(dsh_home=str(tmp_path))
    service = HarnessService(
        config, harness_factory=lambda _: harness, result_callback=_Unavailable()
    )
    try:
        run_id = service.start_run(
            {
                "instruction": "once",
                "request_id": "legacy-result",
                "callback_url": "http://benchmark.invalid/jobs/one/backend-result",
            }
        )
        _wait_for(
            lambda: service.run_state(run_id)["delivery_state"]["result"] == "failed",
            "failed result",
        )
    finally:
        service.close()
    path = tmp_path / "evaluation-runs" / run_id / "state.json"
    stored = json.loads(path.read_text())
    stored["result_report"]["result"] = {
        **stored["result"],
        "usage": {"input_tokens": 12, "output_tokens": 3},
    }
    original = stored["result"]
    path.write_text(json.dumps(stored))
    delivered = []

    class _Sink:
        def post(self, url, payload, timeout):
            delivered.append(payload)

    def refuse_execution(_):
        raise AssertionError("recovery must not execute the task")

    recovered = HarnessService(
        config, harness_factory=refuse_execution, result_callback=_Sink()
    )
    try:
        _wait_for(lambda: delivered, "recovered result")
        result = delivered[0]["result"]
        assert "events" not in result
        assert "notifications" not in result
        assert result["usage"] == {"input_tokens": 12, "output_tokens": 3}
        state = recovered.run_state(run_id)
        assert state["events"] == original["events"]
        assert state["notifications"] == original["notifications"]
        assert len(harness.prompts) == 1
    finally:
        recovered.close()


def test_each_finished_event_is_reported_while_the_run_is_going() -> None:
    """Events reach the evaluator as they happen, not only when the run ends.

    A trace written once at the end shows nothing while a long task runs, and
    nothing at all if it is cancelled first. The events are the run's own
    notifications — the same ones a locally driven run records.
    """
    harness = _FakeHarness()
    events: list[dict[str, Any]] = []

    class _Events:
        def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
            events.append({"url": url, **payload})

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _config: harness,
        event_callback=_Events(),
    )
    service.start_run(
        {
            "instruction": "do it",
            "case_id": "case-7",
            "event_url": "http://autoeval.invalid/v1/events",
            "run_user": "eval-user-9",
        }
    )
    _wait_for(lambda: harness.started_gate.is_set(), "the run to reach the harness")
    harness.gate.set()
    _wait_for(lambda: events, "at least one event to be reported")

    first = events[0]
    assert first["url"].endswith("/v1/events")
    assert first["case_id"] == "case-7"
    assert first["source_session_id"]
    assert isinstance(first["seq"], int)
    assert first["event"]["type"]


def test_events_are_reported_under_the_evaluation_that_sent_the_case() -> None:
    """The verdict arrives under the same id, so the events must use it too.

    A per-run id would put this case's events and its score in two different
    evaluations, and nothing downstream could join them.
    """
    harness = _FakeHarness()
    events: list[dict[str, Any]] = []

    class _Events:
        def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
            events.append({"url": url, **payload})

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _config: harness,
        event_callback=_Events(),
    )
    service.start_run(
        {
            "instruction": "do it",
            "case_id": "case-7",
            "request_id": "job-1",
            "evaluation_id": "eval-run-9",
            "event_url": "http://autoeval.invalid/v1/events",
            "run_user": "eval-user-9",
        }
    )
    _wait_for(lambda: harness.started_gate.is_set(), "the run to reach the harness")
    harness.gate.set()
    _wait_for(lambda: events, "at least one event to be reported")

    assert events[0]["evaluation_id"] == "eval-run-9"


def test_a_failed_event_report_does_not_leave_a_gap_the_trace_can_never_fill() -> None:
    """The receiver writes in order and stops at the first missing sequence.

    A report dropped after its sequence was consumed left a hole that no later
    event could fill: everything that followed stayed held, and the case ended
    with no trace at all. A report that cannot be delivered keeps its place in
    the sequence, so what does get through is still contiguous.
    """
    harness = _FakeHarness()
    delivered: list[int] = []
    calls: list[int] = []

    class _FlakyEvents:
        def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
            calls.append(payload["seq"])
            if len(calls) == 2:
                raise OSError("temporarily unreachable")
            delivered.append(payload["seq"])

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _config: harness,
        event_callback=_FlakyEvents(),
    )
    harness.notifications = [
        Notification(
            method="session.event",
            payload={
                "sessionId": "s",
                "event": {
                    "type": "turn/start",
                    "seq": n,
                    "time": n,
                    "data": {},
                },
            },
        )
        for n in (1, 2, 3)
    ]
    service.start_run(
        {
            "instruction": "do it",
            "case_id": "case-8",
            "evaluation_id": "eval-run-8",
            "event_url": "http://autoeval.invalid/v1/events",
        }
    )
    _wait_for(lambda: harness.started_gate.is_set(), "the run to reach the harness")
    harness.gate.set()
    _wait_for(lambda: len(delivered) >= 2, "the surviving events to be delivered")

    # Sequence 2 was asked for again after failing, so the receiver never sees
    # 1 then 3 with 2 missing. The closing report follows at the next number.
    assert calls[:4] == [1, 2, 2, 3]
    assert delivered[:3] == [1, 2, 3]


def test_the_run_closes_its_trace_once_it_has_ended() -> None:
    """No report ever said the case was over.

    The receiver keeps a case's trace open until a report marks it final, and
    an open trace is never exported: a run whose events all arrived still left
    nothing behind.
    """
    harness = _FakeHarness()
    events: list[dict[str, Any]] = []

    class _Events:
        def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
            events.append({"url": url, **payload})

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _config: harness,
        event_callback=_Events(),
    )
    service.start_run(
        {
            "instruction": "do it",
            "case_id": "case-closing",
            "evaluation_id": "eval-closing",
            "event_url": "http://autoeval.invalid/v1/events",
        }
    )
    _wait_for(lambda: harness.started_gate.is_set(), "the run to reach the harness")
    harness.gate.set()
    _wait_for(lambda: any(e["final"] for e in events), "the closing report to arrive")

    final = [e for e in events if e["final"]]
    assert len(final) == 1, "exactly one report may close the case"
    assert final[0]["evaluation_id"] == "eval-closing"
    assert final[0]["case_id"] == "case-closing"
    # The closing report is the last one, and it carries the run's own ending
    # facts so the trace's root has an outcome rather than an empty close.
    assert final[0] is events[-1]
    assert final[0]["event"]["type"] == "run/end"
    assert final[0]["event"]["data"]["final_response"] == "done"
    assert final[0]["seq"] == max(e["seq"] for e in events)


def test_a_cancelled_run_still_closes_its_trace() -> None:
    """A cancelled case left its trace open, so nothing was ever exported.

    Cases are cancelled in normal operation — a task that overruns its limit
    is stopped — and the receiver keeps a trace open until a report says the
    case is over. The closing report must arrive on this path too.
    """
    from deepseek_harness.service import _RunCancelled

    harness = _FakeHarness()
    harness.fail_with = _RunCancelled()
    events: list[dict[str, Any]] = []

    class _Events:
        def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
            events.append({"url": url, **payload})

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _config: harness,
        event_callback=_Events(),
    )
    service.start_run(
        {
            "instruction": "do it",
            "case_id": "case-cancelled",
            "evaluation_id": "eval-cancelled",
            "event_url": "http://autoeval.invalid/v1/events",
        }
    )
    _wait_for(lambda: harness.started_gate.is_set(), "the run to reach the harness")
    harness.gate.set()
    _wait_for(lambda: events and any(e["final"] for e in events), "the closing report")

    final = [e for e in events if e["final"]][0]
    assert final["case_id"] == "case-cancelled"
    assert final["event"]["type"] == "run/end"
    assert final["event"]["data"]["status"] == "cancelled"


def test_event_delivery_does_not_block_the_sdk_or_business_result(monkeypatch) -> None:
    monkeypatch.setenv("DSH_DELIVERY_RETRY_DELAY_SEC", "0.001")
    harness = _FakeHarness()
    harness.gate.set()
    entered = threading.Event()
    release = threading.Event()
    completed: list[dict[str, Any]] = []

    class _Events:
        def post(self, url, payload, timeout):
            entered.set()
            release.wait(timeout=3)

    class _Results:
        def post(self, url, payload, timeout):
            completed.append(payload)

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _: harness,
        event_callback=_Events(),
        result_callback=_Results(),
    )
    try:
        run_id = service.start_run(
            {
                "instruction": "do it",
                "event_url": "http://autoeval.invalid/v1/events",
                "callback_url": "http://benchmark.invalid/jobs/one/backend-result",
            }
        )
        assert entered.wait(timeout=1)
        _wait_for(lambda: completed, "the independent business callback")
        assert service.run_state(run_id)["status"] == "completed"
    finally:
        release.set()
        service.close()


def test_event_source_sequence_is_distinct_from_delivery_sequence() -> None:
    harness = _FakeHarness()
    harness.notifications = [
        Notification(
            method="session.event",
            payload={
                "sessionId": source,
                "event": {"type": "turn/start", "seq": seq, "time": seq, "data": {}},
            },
        )
        for source, seq in (("root", 12), ("child", 1), ("root", 13))
    ]
    harness.gate.set()
    reports: list[dict[str, Any]] = []

    class _Events:
        def post(self, url, payload, timeout):
            reports.append(payload)

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _: harness,
        event_callback=_Events(),
    )
    try:
        service.start_run(
            {"instruction": "do it", "event_url": "http://a.invalid/v1/events"}
        )
        _wait_for(lambda: any(p["final"] for p in reports), "the final report")
        native = [p for p in reports if not p["final"]]
        assert [(p["source_session_id"], p["seq"]) for p in native] == [
            ("root", 12),
            ("child", 1),
            ("root", 13),
        ]
        assert [p["delivery_seq"] for p in reports] == [1, 2, 3, 4]
        assert [p["event"]["seq"] for p in native] == [12, 1, 13]
    finally:
        service.close()


def test_failed_final_report_is_retried_without_a_later_event(monkeypatch) -> None:
    monkeypatch.setenv("DSH_DELIVERY_RETRY_DELAY_SEC", "0.001")
    harness = _FakeHarness()
    harness.gate.set()
    attempts: list[dict[str, Any]] = []
    delivered: list[dict[str, Any]] = []

    class _Events:
        def post(self, url, payload, timeout):
            attempts.append(payload)
            if payload["final"] and sum(p["final"] for p in attempts) == 1:
                raise OSError("lost final request")
            delivered.append(payload)

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _: harness,
        event_callback=_Events(),
    )
    try:
        run_id = service.start_run(
            {"instruction": "do it", "event_url": "http://a.invalid/v1/events"}
        )
        _wait_for(lambda: any(p["final"] for p in delivered), "the retried final event")
        final_attempts = [p for p in attempts if p["final"]]
        assert len(final_attempts) == 2
        assert final_attempts[0] == final_attempts[1]
        assert len(harness.prompts) == 1
        assert service.run_state(run_id)["delivery_state"]["events"] == "delivered"
    finally:
        service.close()


def test_delivery_recovers_after_the_initial_attempt_budget_is_exhausted(
    monkeypatch,
) -> None:
    monkeypatch.setenv("DSH_DELIVERY_MAX_ATTEMPTS", "1")
    monkeypatch.setenv("DSH_DELIVERY_RETRY_DELAY_SEC", "0.001")
    harness = _FakeHarness()
    harness.gate.set()

    class _FlakySink:
        def __init__(self) -> None:
            self.attempts: list[dict[str, Any]] = []
            self.delivered: list[dict[str, Any]] = []

        def post(self, url, payload, timeout):
            self.attempts.append(payload)
            if len(self.attempts) <= 2:
                raise OSError("temporarily unavailable")
            self.delivered.append(payload)

    events = _FlakySink()
    results = _FlakySink()
    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _: harness,
        event_callback=events,
        result_callback=results,
    )
    try:
        run_id = service.start_run(
            {
                "instruction": "do it",
                "event_url": "http://a.invalid/v1/events",
                "callback_url": "http://benchmark.invalid/jobs/one/backend-result",
            }
        )
        _wait_for(
            lambda: any(p["final"] for p in events.delivered),
            "final delivery after backoff",
            timeout=3,
        )
        _wait_for(
            lambda: bool(results.delivered), "result delivery after backoff", timeout=3
        )
        state = service.run_state(run_id)
        assert state["delivery_state"]["events"] == "delivered"
        assert state["delivery_state"]["result"] == "delivered"
        assert state["delivery_state"]["pending_events"] == 0
        assert [p["delivery_seq"] for p in events.delivered] == [1, 2]
        assert all(p == results.attempts[0] for p in results.attempts)
        assert len(harness.prompts) == 1
    finally:
        service.close()


def test_delivery_recovery_is_bounded_and_preserves_the_outbox(monkeypatch) -> None:
    monkeypatch.setenv("DSH_DELIVERY_MAX_ATTEMPTS", "1")
    monkeypatch.setenv("DSH_DELIVERY_RECOVERY_ATTEMPTS", "1")
    monkeypatch.setenv("DSH_DELIVERY_RETRY_DELAY_SEC", "0.001")
    harness = _FakeHarness()
    harness.gate.set()

    class _Unavailable:
        def __init__(self) -> None:
            self.attempts: list[dict[str, Any]] = []

        def post(self, url, payload, timeout):
            self.attempts.append(payload)
            raise OSError("still unavailable")

    events = _Unavailable()
    results = _Unavailable()
    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _: harness,
        event_callback=events,
        result_callback=results,
    )
    try:
        run_id = service.start_run(
            {
                "instruction": "do it",
                "event_url": "http://a.invalid/v1/events",
                "callback_url": "http://benchmark.invalid/jobs/one/backend-result",
            }
        )
        run = service._runs[run_id]
        _wait_for(
            lambda: run.event_sender is None,
            "bounded event recovery to stop",
            timeout=3,
        )
        _wait_for(
            lambda: run.result_sender is None,
            "bounded result recovery to stop",
            timeout=3,
        )
        assert len(events.attempts) == 2
        assert len(results.attempts) == 2
        state = service.run_state(run_id)
        assert state["delivery_state"]["events"] == "failed"
        assert state["delivery_state"]["result"] == "failed"
        assert state["delivery_state"]["pending_events"] == 2
        assert len(harness.prompts) == 1
    finally:
        service.close()


def test_outbox_survives_service_restart_without_rerunning_the_task(
    tmp_path, monkeypatch
) -> None:
    import json

    monkeypatch.setenv("DSH_DELIVERY_MAX_ATTEMPTS", "1")
    harness = _FakeHarness()
    harness.gate.set()

    class _Unavailable:
        def post(self, url, payload, timeout):
            raise OSError("not available")

    config = DeepSeekHarnessConfig(dsh_home=str(tmp_path))
    service = HarnessService(
        config, harness_factory=lambda _: harness, event_callback=_Unavailable()
    )
    run_id = service.start_run(
        {
            "instruction": "do not repeat",
            "request_id": "restart-1",
            "event_url": "http://a.invalid/v1/events",
            "llm": {"api_key": "secret-test-value"},
        }
    )
    _wait_for(
        lambda: service.run_state(run_id).get("delivery_state", {}).get("events")
        == "failed",
        "failed delivery",
    )
    _wait_for(
        lambda: service.run_state(run_id)["status"] == "completed", "the original run"
    )
    service.close()
    record = tmp_path / "evaluation-runs" / run_id / "state.json"
    assert record.exists()
    assert "secret-test-value" not in record.read_text()
    assert record.stat().st_mode & 0o777 == 0o600
    assert (record.parent.stat().st_mode & 0o777) == 0o700
    assert json.loads(record.read_text())["undelivered"]

    delivered: list[dict[str, Any]] = []

    class _Events:
        def post(self, url, payload, timeout):
            delivered.append(payload)

    def refuse_execution(_):
        raise AssertionError("recovery must not start a harness")

    recovered = HarnessService(
        config, harness_factory=refuse_execution, event_callback=_Events()
    )
    try:
        _wait_for(
            lambda: any(p["final"] for p in delivered), "recovered final delivery"
        )
        assert recovered.run_state(run_id)["status"] == "completed"
        assert recovered.run_state(run_id)["delivery_state"]["pending_events"] == 0
        assert len(harness.prompts) == 1
    finally:
        recovered.close()


def test_cancelled_reports_wait_for_confirmation_and_worker_exit() -> None:
    entered = threading.Event()
    release_worker = threading.Event()
    cancel_called = threading.Event()
    confirm = threading.Event()
    reports: list[dict[str, Any]] = []

    class _Harness(_FakeHarness):
        def run(
            self,
            instruction,
            *,
            session_id=None,
            before_deliver=None,
            on_notification=None,
        ):
            entered.set()
            release_worker.wait(timeout=3)
            return _FakeResult("late success", "completed", session_id or "", [], [])

        def cancel_session(self, session_id):
            cancel_called.set()
            confirm.wait(timeout=3)

    class _Sink:
        def post(self, url, payload, timeout):
            reports.append(payload)

    harness = _Harness()
    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _: harness,
        event_callback=_Sink(),
        result_callback=_Sink(),
    )
    run_id = service.start_run(
        {
            "instruction": "do it",
            "event_url": "http://a.invalid/v1/events",
            "callback_url": "http://b.invalid/jobs/one/backend-result",
        }
    )
    assert entered.wait(timeout=1)
    cancel = threading.Thread(target=lambda: service.cancel(run_id))
    cancel.start()
    try:
        assert cancel_called.wait(timeout=1)
        release_worker.set()
        _wait_for(lambda: service._runs[run_id].worker_done.is_set(), "worker exit")
        assert reports == []
        assert service.run_state(run_id)["status"] == "cancelling"
        confirm.set()
        cancel.join(timeout=2)
        _wait_for(lambda: len(reports) == 2, "both terminal reports")
        final = next(p for p in reports if p.get("final"))
        result = next(p for p in reports if "status" in p)
        assert final["event"]["data"]["status"] == "cancelled"
        assert result["status"] == "cancelled"
        assert result["result"] is None
    finally:
        confirm.set()
        release_worker.set()
        cancel.join(timeout=3)
        service.close()


def test_request_identity_is_idempotent_and_conflicting_content_is_refused() -> None:
    harness = _FakeHarness()
    service = _service(harness)
    try:
        task = {"instruction": "do it", "request_id": "same-request"}
        first = service.start_run(task)
        second = service.start_run(dict(task))
        assert first == second
        _wait_for(lambda: len(harness.prompts) == 1, "one execution")
        with pytest.raises(ValueError, match="different"):
            service.start_run({**task, "instruction": "different task"})
        assert len(harness.prompts) == 1
    finally:
        harness.gate.set()
        service.close()


def test_the_served_service_actually_delivers_its_reports() -> None:
    """A service given nowhere to report keeps everything to itself.

    The callbacks are what carry events to the evaluator and the outcome back
    to the benchmark. Leaving them unset meant a run finished with no trace
    and no verdict, while every request looked successful.
    """
    from deepseek_harness.service import HarnessService, http_sink

    sink = http_sink()
    assert hasattr(sink, "post")

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _config: _FakeHarness(),
        result_callback=sink,
        event_callback=sink,
    )
    try:
        assert service._event_callback is sink
        assert service._result_callback is sink
    finally:
        service.close()


@pytest.fixture
def http_callbacks():
    import json
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    received: list[dict[str, Any]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append(
                {
                    "path": self.path,
                    "authorization": self.headers.get("Authorization"),
                    "body": body,
                }
            )
            self.send_response(302 if self.path == "/redirect" else 200)
            if self.path == "/redirect":
                self.send_header("Location", "/unapproved")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", received
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_real_http_v2_acceptance_authentication_and_independent_reports(
    http_callbacks, monkeypatch
):
    import json
    import urllib.error
    import urllib.request
    from http.server import ThreadingHTTPServer
    from deepseek_harness.service import _handler, http_sink

    endpoint, received = http_callbacks
    monkeypatch.setenv("DSH_EVENT_CALLBACK_URLS", endpoint + "/v1/events")
    monkeypatch.setenv("DSH_RESULT_CALLBACK_BASES", endpoint)
    monkeypatch.setenv("AUTOEVAL_CALLBACK_TOKEN", "event-token")
    monkeypatch.setenv("PIPELINE_API_TOKEN", "result-token")
    harness = _FakeHarness()
    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _: harness,
        event_callback=http_sink("event"),
        result_callback=http_sink("result"),
        api_token="service-token",
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(service))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def post(body, token="service-token"):
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/v1/runs",
            data=json.dumps(body).encode(),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    task = {
        "instruction": "one accepted execution",
        "request_id": "http-once",
        "evaluation_id": "e",
        "case_id": "c",
        "session_id": "native-session",
        "event_url": endpoint + "/v1/events",
        "callback_url": endpoint + "/jobs/one/backend-result",
    }
    try:
        assert post({"protocol_version": "2.0", "task": task}, token="wrong")[0] == 401
        assert post({"task": task})[0] == 400
        status, accepted = post({"protocol_version": "2.0", "task": task})
        assert status == 202
        assert accepted["protocol_version"] == "2.0"
        assert accepted["request_id"] == "http-once"
        assert not received
        status, duplicate = post({"protocol_version": "2.0", "task": task})
        assert status == 202
        assert duplicate["run_id"] == accepted["run_id"]
        assert (
            post(
                {
                    "protocol_version": "2.0",
                    "task": {**task, "instruction": "different"},
                }
            )[0]
            == 409
        )
        harness.gate.set()
        _wait_for(
            lambda: any(p["body"].get("final") for p in received), "real final callback"
        )
        _wait_for(
            lambda: any(p["path"].endswith("backend-result") for p in received),
            "real result callback",
        )
        assert len(harness.prompts) == 1
        events = [p for p in received if p["path"] == "/v1/events"]
        result = next(p for p in received if p["path"].endswith("backend-result"))
        assert all(p["authorization"] == "Bearer event-token" for p in events)
        assert result["authorization"] == "Bearer result-token"
        assert result["body"]["status"] == "succeeded"
        assert "event-token" not in json.dumps([p["body"] for p in received])
        assert "result-token" not in json.dumps([p["body"] for p in received])
    finally:
        harness.gate.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        service.close()


def test_callback_allowlist_and_redirect_denial(http_callbacks, monkeypatch):
    from deepseek_harness.service import http_sink

    endpoint, received = http_callbacks
    monkeypatch.setenv("DSH_EVENT_CALLBACK_URLS", endpoint + "/redirect")
    sink = http_sink("event")
    with pytest.raises(ValueError, match="approved"):
        sink.post(endpoint + "/unapproved", {}, timeout=1)
    assert not received
    with pytest.raises(RuntimeError, match="302"):
        sink.post(endpoint + "/redirect", {}, timeout=1)
    assert [p["path"] for p in received] == ["/redirect"]
    with pytest.raises(ValueError, match="credentials"):
        sink.validate_target(
            endpoint.replace("http://", "http://user:password@") + "/redirect"
        )


def test_a_task_selects_the_isolated_tools_and_keeps_its_working_directory() -> None:
    harness = _FakeHarness()
    harness.gate.set()
    service = _service(harness)
    try:
        run_id = service.start_run(
            {
                "instruction": "read the task",
                "request_id": "preset-run",
                "cwd": "/app",
                "agent_preset": "benchmark-task",
            }
        )
        _wait_for(
            lambda: service.run_state(run_id)["status"] == "completed",
            "the task to finish",
        )
        assert harness.requested_cwd == "/app"
        assert harness.requested_preset == "benchmark-task"
    finally:
        service.close()


def test_child_events_keep_the_parent_from_the_native_lifecycle_notice() -> None:
    events: list[dict[str, Any]] = []

    class EventReceiver:
        def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
            events.append(payload)

    harness = _FakeHarness()
    harness.notifications = [
        Notification(
            method="subagent.started",
            payload={
                "parentSessionId": "root-native",
                "childSessionId": "child-native",
            },
        ),
        Notification(
            method="session.event",
            payload={
                "sessionId": "child-native",
                "event": {"seq": 1, "type": "turn/start", "time": 10, "data": {}},
            },
        ),
    ]
    harness.gate.set()
    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _config: harness,
        event_callback=EventReceiver(),
    )
    try:
        service.start_run(
            {
                "instruction": "delegate work",
                "session_id": "root-native",
                "event_url": "http://events.invalid/v1/events",
            }
        )
        _wait_for(
            lambda: any(e["source_session_id"] == "child-native" for e in events),
            "the child report",
        )
        child = next(e for e in events if e["source_session_id"] == "child-native")
        assert child["parent_session_id"] == "root-native"
        assert child["root_session_id"] == "root-native"
    finally:
        service.close()
