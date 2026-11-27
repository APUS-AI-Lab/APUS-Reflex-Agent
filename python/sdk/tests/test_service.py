"""HTTP service behavior: per-run sessions, real cancellation, and honest status."""

from __future__ import annotations

import sys
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
        # The SDK client the service reaches for request views.
        self.client: Any = None
        # The terminal reason of a normal harness return: a completed turn,
        # an output-token ceiling, or an error are different business states.
        self.finish_reason: str | None = "completed"
        # The root-session events the run returns; a failed turn keeps them.
        self.events: list[dict[str, Any]] = []

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
            finish_reason=self.finish_reason,
            session_id=session_id or "",
            events=list(self.events),
            notifications=notifications,
        )

    def request_view(self, session_id: str, dispatch_seq: int) -> dict[str, Any]:
        # Mirrors DeepSeekHarness.request_view: one relay to the SDK client.
        return self.client.session_request_view(session_id, dispatch_seq)

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
        _wait_for(
            lambda: recovered.run_state(run_id)["delivery_state"]["pending_events"]
            == 0,
            "the recovered outbox to drain",
        )
        assert recovered.run_state(run_id)["status"] == "completed"
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


class _ViewClient:
    """Stands in for the SDK client's request-view call, on whatever thread asks."""

    def __init__(self, view: dict[str, Any], *, fail_times: int = 0) -> None:
        self.view = view
        self.fail_times = fail_times
        self.calls: list[tuple[str, int]] = []
        self.threads: list[str] = []

    def session_request_view(
        self, session_id: str, dispatch_seq: int
    ) -> dict[str, Any]:
        self.calls.append((session_id, dispatch_seq))
        self.threads.append(threading.current_thread().name)
        if self.fail_times > 0:
            self.fail_times -= 1
            raise RuntimeError("view unavailable")
        return {**self.view, "sessionId": session_id, "dispatchSeq": dispatch_seq}


_NATIVE_VIEW: dict[str, Any] = {
    "sessionId": "root-native",
    "dispatchSeq": 9,
    "prefixEnd": 8,
    "turn": 1,
    "step": 1,
    "header": {"config": {"provider": "p", "model": "m"}},
    "messages": [
        {
            "role": "user",
            "id": "u1",
            "source": {"kind": "user"},
            "content": [{"type": "text", "text": "hello view"}],
        }
    ],
    "toolHistory": {"tools": [], "updates": []},
    "projectionTypes": [],
}


def _dispatch_notifications() -> list[Notification]:
    return [
        Notification(
            method="session.event",
            payload={
                "sessionId": "root-native",
                "event": {
                    "type": "llm/dispatch",
                    "seq": 9,
                    "time": 1,
                    "data": {
                        "sessionId": "root-native",
                        "prefixEnd": 8,
                        "turn": 1,
                        "step": 1,
                    },
                },
            },
        ),
        Notification(
            method="session.event",
            payload={
                "sessionId": "root-native",
                "event": {
                    "type": "assistant/message",
                    "seq": 10,
                    "time": 2,
                    "data": {"turn": 1, "step": 1},
                },
            },
        ),
        Notification(
            method="session.event",
            payload={
                "sessionId": "root-native",
                "event": {
                    "type": "llm/dispatch-settled",
                    "seq": 11,
                    "time": 3,
                    "data": {
                        "sessionId": "root-native",
                        "dispatchSeq": 9,
                        "settlementSeq": 10,
                    },
                },
            },
        ),
        Notification(
            method="session.event",
            payload={
                "sessionId": "root-native",
                "event": {
                    "type": "step/start",
                    "seq": 12,
                    "time": 4,
                    "data": {"turn": 1, "step": 1},
                },
            },
        ),
    ]


def _collecting_service(
    harness: _FakeHarness, events: list[dict[str, Any]]
) -> HarnessService:
    class _Events:
        def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
            events.append(payload)

    return HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _config: harness,
        event_callback=_Events(),
    )


def test_dispatch_events_carry_the_native_view_fetched_on_the_sender_thread() -> None:
    """The sidecar view is the runtime's own object, for dispatch events only.

    A view fetched from the notification receiver would deadlock the runtime
    that is still delivering; the sender thread is the one place the request
    may run. The settled record names its dispatch, so its view is that
    dispatch's, not a view of the settlement record's own seq.
    """
    harness = _FakeHarness()
    harness.client = _ViewClient(_NATIVE_VIEW)
    harness.notifications = _dispatch_notifications()
    harness.gate.set()
    events: list[dict[str, Any]] = []
    service = _collecting_service(harness, events)
    try:
        service.start_run(
            {
                "instruction": "do it",
                "session_id": "root-native",
                "event_url": "http://events.invalid/v1/events",
            }
        )
        _wait_for(lambda: len(events) >= 4, "the four source events")
        by_type = {e["event"]["type"]: e for e in events if not e.get("final")}
        dispatch = by_type["llm/dispatch"]
        settled = by_type["llm/dispatch-settled"]
        assert dispatch["event"]["seq"] == 9
        assert dispatch["event"] == _dispatch_notifications()[0].payload["event"]
        assert (
            dispatch["request_view"]["messages"][0]["content"][0]["text"]
            == "hello view"
        )
        assert dispatch["request_view"]["prefixEnd"] == 8
        assert settled["request_view"]["dispatchSeq"] == 9
        assert settled["request_view"] == dispatch["request_view"]
        assert "request_view" not in by_type["step/start"]
        # One view per dispatch: the settled record reuses it instead of asking again.
        assert harness.client.calls == [("root-native", 9)]
        assert all(name.startswith("events-") for name in harness.client.threads)
    finally:
        service.close()


def test_a_dispatch_event_without_a_view_is_reported_unchanged_with_the_gap_named() -> (
    None
):
    harness = _FakeHarness()
    harness.client = _ViewClient(_NATIVE_VIEW, fail_times=99)
    harness.notifications = _dispatch_notifications()[:1]
    harness.gate.set()
    events: list[dict[str, Any]] = []
    service = _collecting_service(harness, events)
    try:
        run_id = service.start_run(
            {
                "instruction": "do it",
                "session_id": "root-native",
                "event_url": "http://events.invalid/v1/events",
            }
        )
        _wait_for(
            lambda: any(e["event"]["type"] == "llm/dispatch" for e in events),
            "the source event",
        )
        report = next(e for e in events if e["event"]["type"] == "llm/dispatch")
        assert "request_view" not in report
        assert report["event"] == _dispatch_notifications()[0].payload["event"]
        assert "request_view" in service.run_state(run_id)["delivery_state"]["error"]
        service.close()
        assert harness.client.calls == [("root-native", 9)]
    finally:
        service.close()


def test_a_redelivered_dispatch_report_repeats_the_same_content(monkeypatch) -> None:
    """A retry must not turn a view-less first send into a different second one."""
    monkeypatch.setenv("DSH_DELIVERY_MAX_ATTEMPTS", "1")
    monkeypatch.setenv("DSH_DELIVERY_RETRY_DELAY_SEC", "0.001")
    harness = _FakeHarness()
    harness.client = _ViewClient(_NATIVE_VIEW, fail_times=1)
    harness.notifications = _dispatch_notifications()[:1]
    harness.gate.set()
    posted: list[dict[str, Any]] = []

    class _Flaky:
        def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
            posted.append(payload)
            if len(posted) == 1:
                raise OSError("lost event request")

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _config: harness,
        event_callback=_Flaky(),
    )
    try:
        service.start_run(
            {
                "instruction": "do it",
                "session_id": "root-native",
                "event_url": "http://events.invalid/v1/events",
            }
        )
        _wait_for(lambda: len(posted) >= 2, "the retried report")
        assert posted[0] == posted[1]
        assert "request_view" not in posted[0]
        # One decision per dispatch, reused by the retry instead of asking again.
        assert harness.client.calls == [("root-native", 9)]
    finally:
        service.close()


def test_the_report_carries_the_runtime_view_unchanged() -> None:
    """The sidecar is the runtime's own object: no field added, none dropped.

    A view fetched while its dispatch ran has no settlement yet. That gap is
    the runtime's answer, so this service must neither invent a settlement nor
    flatten the object to the fields it happens to use.
    """
    runtime_view = {
        **_NATIVE_VIEW,
        "turn": 3,
        "step": 2,
        "header": {
            "config": {"provider": "p", "model": "m"},
            "tools": [{"name": "read"}],
        },
        "tools": [{"name": "read"}],
        "projectionTypes": ["image/offload"],
    }
    harness = _FakeHarness()
    harness.client = _ViewClient(runtime_view)
    harness.notifications = _dispatch_notifications()
    harness.gate.set()
    events: list[dict[str, Any]] = []
    service = _collecting_service(harness, events)
    try:
        service.start_run(
            {
                "instruction": "do it",
                "session_id": "root-native",
                "event_url": "http://events.invalid/v1/events",
            }
        )
        _wait_for(lambda: len(events) >= 4, "the four source events")
        dispatch = next(e for e in events if e["event"]["type"] == "llm/dispatch")
        assert dispatch["request_view"] == runtime_view
        assert "settlementSeq" not in dispatch["request_view"]
    finally:
        service.close()


def test_a_recovered_report_repeats_the_view_it_was_queued_with(
    tmp_path, monkeypatch
) -> None:
    """An outbox entry keeps what its first attempt carried, not a refetch.

    The runtime may answer a later fetch differently (a settlement may have
    since been recorded); a report that was already persisted must still go
    out with the content its sequence already stands for.
    """
    monkeypatch.setenv("DSH_DELIVERY_MAX_ATTEMPTS", "1")
    monkeypatch.setenv("DSH_DELIVERY_RETRY_DELAY_SEC", "0.001")
    queued_view = {**_NATIVE_VIEW, "settlementSeq": 10}
    harness = _FakeHarness()
    harness.client = _ViewClient(queued_view)
    harness.notifications = _dispatch_notifications()[:1]
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
            "instruction": "do not refetch",
            "session_id": "root-native",
            "event_url": "http://a.invalid/v1/events",
        }
    )
    _wait_for(
        lambda: service.run_state(run_id)["status"] == "completed", "the original run"
    )
    _wait_for(
        lambda: service.run_state(run_id)["delivery_state"]["events"] == "failed",
        "the failed delivery",
    )
    service.close()
    harness.client = _ViewClient({**_NATIVE_VIEW, "settlementSeq": 999})

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
            lambda: any(e["event"]["type"] == "llm/dispatch" for e in delivered),
            "the recovered dispatch report",
        )
        report = next(e for e in delivered if e["event"]["type"] == "llm/dispatch")
        assert report["request_view"] == queued_view
        # Repeating a view is not a gap: no missing-view error may be recorded.
        state = recovered.run_state(run_id)
        assert "request_view" not in (state["delivery_state"].get("error") or "")
    finally:
        recovered.close()


def test_a_none_view_decision_survives_restart_and_is_not_refetched(
    tmp_path, monkeypatch
) -> None:
    """A recorded gap is a decision, not a cache miss to answer again later.

    The first attempt could not produce a view, so the report carries none and
    the state records that explicitly. A restarted service that has a runtime
    again must repeat that decision for the same dispatch instead of sending a
    different body the second time.
    """
    import json

    monkeypatch.setenv("DSH_DELIVERY_MAX_ATTEMPTS", "1")
    monkeypatch.setenv("DSH_DELIVERY_RECOVERY_ATTEMPTS", "0")
    monkeypatch.setenv("DSH_DELIVERY_RETRY_DELAY_SEC", "0.001")
    harness = _FakeHarness()
    harness.client = _ViewClient(_NATIVE_VIEW, fail_times=99)
    harness.notifications = _dispatch_notifications()[:1]
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
            "instruction": "keep the missing decision",
            "session_id": "root-native",
            "event_url": "http://a.invalid/v1/events",
        }
    )
    _wait_for(
        lambda: service.run_state(run_id)["status"] == "completed", "the original run"
    )
    _wait_for(
        lambda: service.run_state(run_id)["delivery_state"]["events"] == "failed",
        "the failed delivery",
    )
    assert harness.client.calls == [("root-native", 9)]
    service.close()

    record = json.loads(
        (tmp_path / "evaluation-runs" / run_id / "state.json").read_text()
    )
    assert record["request_views"] == [
        {"source_session_id": "root-native", "dispatch_seq": 9, "view": None},
    ]

    refetch = _ViewClient(_NATIVE_VIEW)
    later = _FakeHarness()
    later.client = refetch
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
        run = recovered._runs[run_id]
        assert run.request_views == {("root-native", 9): None}
        _wait_for(
            lambda: any(e["event"]["type"] == "llm/dispatch" for e in delivered),
            "the recovered dispatch report",
        )
        report = next(e for e in delivered if e["event"]["type"] == "llm/dispatch")
        assert "request_view" not in report
        # A runtime being available again does not reopen a recorded decision.
        run.view_source = later
        recovered._attach_request_view(run, report)
        assert refetch.calls == []
        assert "request_view" not in report
    finally:
        recovered.close()


def test_an_error_turn_is_published_as_failed_with_its_evidence_kept() -> None:
    """A harness that returns normally is not a completed case when the turn failed.

    The runtime ends a turn with ``error`` and still reports idle, so the SDK
    returns a result instead of raising. The service must publish that as a
    failed run, name the reason, and keep the events and notifications the
    result already carried: the trace and the diagnostic are the evidence, not
    something the status change may discard.
    """
    failure_event = {
        "type": "turn/end",
        "seq": 3,
        "time": 3,
        "data": {
            "turn": 1,
            "reason": {"kind": "error", "error": {"code": "AUTH", "status": 401}},
        },
    }
    harness = _FakeHarness()
    harness.finish_reason = "error"
    harness.events = [
        {"type": "turn/start", "seq": 1, "time": 1, "data": {"turn": 1}},
        failure_event,
    ]
    harness.gate.set()
    reports: list[dict[str, Any]] = []

    class _Sink:
        def post(self, url, payload, timeout):
            reports.append(payload)

    service = HarnessService(
        DeepSeekHarnessConfig(),
        harness_factory=lambda _: harness,
        event_callback=_Sink(),
        result_callback=_Sink(),
    )
    try:
        run_id = service.start_run(
            {
                "instruction": "fail with a reason",
                "session_id": "error-turn",
                "event_url": "http://a.invalid/v1/events",
                "callback_url": "http://benchmark.invalid/jobs/one/backend-result",
            }
        )
        _wait_for(
            lambda: service.run_state(run_id)["status"] != "running",
            "the run to settle",
        )
        state = service.run_state(run_id)
        assert state["status"] == "failed"
        assert "error" in state["error"]
        assert "AUTH" in state["error"] and "401" in state["error"]
        assert state["finish_reason"] == "error"
        assert state["events"] == harness.events
        assert state["notifications"]

        _wait_for(lambda: any(p.get("final") for p in reports), "the final report")
        _wait_for(lambda: any("status" in p for p in reports), "the result report")
        final = next(p for p in reports if p.get("final"))
        outcome = next(p for p in reports if "status" in p)
        assert final["event"]["data"]["status"] == "failed"
        assert final["event"]["data"]["finish_reason"] == "error"
        assert outcome["status"] == "failed"
        assert outcome["result"]["finish_reason"] == "error"
        assert outcome["result"]["final_response"] == "done"
    finally:
        service.close()


def test_a_max_tokens_turn_follows_the_deployment_switch(monkeypatch) -> None:
    """The deployment's own mapping decides whether a capped turn counts.

    ``evaluation.patch.yml`` accepts ``max-tokens`` unless
    ``DSH_MAX_TOKENS_AS_SUCCESS`` is JSON ``false``; the service shares that
    environment with the runtime it starts. The finish reason stays visible in
    both outcomes, so a capped answer is never silently rewritten as complete.
    """

    def run_once(
        finish_reason: str, switch: str | None
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        if switch is None:
            monkeypatch.delenv("DSH_MAX_TOKENS_AS_SUCCESS", raising=False)
        else:
            monkeypatch.setenv("DSH_MAX_TOKENS_AS_SUCCESS", switch)
        harness = _FakeHarness()
        harness.finish_reason = finish_reason
        harness.gate.set()
        reports: list[dict[str, Any]] = []

        class _Sink:
            def post(self, url, payload, timeout):
                reports.append(payload)

        service = HarnessService(
            DeepSeekHarnessConfig(),
            harness_factory=lambda _: harness,
            result_callback=_Sink(),
        )
        try:
            run_id = service.start_run(
                {
                    "instruction": "hit the ceiling",
                    "session_id": "capped",
                    "callback_url": "http://benchmark.invalid/jobs/one/backend-result",
                }
            )
            _wait_for(
                lambda: service.run_state(run_id)["status"] != "running",
                "the run to settle",
            )
            return service.run_state(run_id), reports
        finally:
            service.close()

    state, _reports = run_once("max-tokens", None)
    assert state["status"] == "completed"
    assert state["finish_reason"] == "max-tokens"

    state, _reports = run_once("max-tokens", "false")
    assert state["status"] == "failed"
    assert "max-tokens" in state["error"]
    assert state["finish_reason"] == "max-tokens"


def test_a_return_without_a_turn_end_is_not_published_as_completed() -> None:
    """A run that produced no ended turn has no outcome to call a success.

    ``finish_reason`` is ``None`` when the run interval held no ``turn/end``.
    Publishing that as completed would claim a verdict the runtime never
    produced, so it is a failed run naming the missing reason.
    """
    harness = _FakeHarness()
    harness.finish_reason = None
    harness.gate.set()
    service = _service(harness)
    try:
        run_id = service.start_run(
            {"instruction": "no turn end", "session_id": "silent"}
        )
        _wait_for(
            lambda: service.run_state(run_id)["status"] != "running",
            "the run to settle",
        )
        state = service.run_state(run_id)
        assert state["status"] == "failed"
        assert "turn ended with None" in state["error"]
        assert state["finish_reason"] is None
    finally:
        service.close()


def test_a_legacy_succeeded_state_with_an_error_finish_is_corrected_on_recovery(
    tmp_path,
) -> None:
    """A state written before the outcome followed the finish reason is repaired.

    The recorded run 77c40199… said ``terminal_status=succeeded`` while its
    result carried ``finish_reason=error``. Recovery re-reads the persisted
    result, publishes the truthful status, and keeps every recorded event.
    """
    import json

    home = tmp_path / "home"
    directory = home / "evaluation-runs" / "legacy-error-run"
    directory.mkdir(parents=True)
    failure = {
        "type": "turn/end",
        "seq": 3,
        "time": 3,
        "data": {
            "turn": 1,
            "reason": {"kind": "error", "error": {"code": "AUTH", "status": 401}},
        },
    }
    (directory / "state.json").write_text(
        json.dumps(
            {
                "protocol_version": "2.0",
                "run_id": "legacy-error-run",
                "task_id": "case",
                "session_id": "legacy-session",
                "instruction": "old task",
                "callback_url": "http://b.invalid/jobs/one/backend-result",
                "event_url": "http://a.invalid/v1/events",
                "request_id": "",
                "request_digest": "",
                "evaluation_id": "eval",
                "case_id": "case",
                "run_user": "",
                "cwd": "",
                "agent_preset": "",
                "model": "m",
                "benchmark": "b",
                "question_type": "unknown",
                "dataset_version": "",
                "dataset_sha256": "",
                "reported": 2,
                "undelivered": [],
                "reports_closed": True,
                "event_delivery": "delivered",
                "result_delivery": "delivered",
                "result_report": None,
                "result": {
                    "final_response": "",
                    "finish_reason": "error",
                    "session_id": "legacy-session",
                    "events": [failure],
                    "notifications": [],
                },
                "error": None,
                "cancel_state": "none",
                "terminal_status": "succeeded",
                "done": True,
            }
        )
    )
    delivered: list[dict[str, Any]] = []

    class _Sink:
        def post(self, url, payload, timeout):
            delivered.append(payload)

    def refuse_execution(_):
        raise AssertionError("recovery must not start a harness")

    recovered = HarnessService(
        DeepSeekHarnessConfig(dsh_home=str(home)),
        harness_factory=refuse_execution,
        event_callback=_Sink(),
        result_callback=_Sink(),
    )
    try:
        state = recovered.run_state("legacy-error-run")
        assert state["status"] == "failed"
        assert "AUTH" in state["error"] and "401" in state["error"]
        assert state["finish_reason"] == "error"
        assert state["events"] == [failure]
        _wait_for(lambda: bool(delivered), "the corrected reports")
        outcome = next(p for p in delivered if "status" in p)
        assert outcome["status"] == "failed"
        assert outcome["result"]["finish_reason"] == "error"
    finally:
        recovered.close()


def test_a_pending_legacy_result_report_is_corrected_with_the_recovered_status(
    tmp_path,
) -> None:
    """A queued result the evaluator never received is still a draft.

    The recorded state claimed ``succeeded`` and held a result report with the
    same status, but its result carried ``finish_reason=error`` and the report
    was never delivered. Recovery must publish the truthful status on that
    report instead of sending a success the turn never produced.
    """
    import json

    home = tmp_path / "home"
    directory = home / "evaluation-runs" / "legacy-pending-result"
    directory.mkdir(parents=True)
    failure = {
        "type": "turn/end",
        "seq": 3,
        "time": 3,
        "data": {
            "turn": 1,
            "reason": {"kind": "error", "error": {"code": "AUTH", "status": 401}},
        },
    }
    stored_result = {
        "final_response": "",
        "finish_reason": "error",
        "session_id": "legacy-session",
        "events": [failure],
        "notifications": [],
    }
    (directory / "state.json").write_text(
        json.dumps(
            {
                "protocol_version": "2.0",
                "run_id": "legacy-pending-result",
                "task_id": "case",
                "session_id": "legacy-session",
                "instruction": "old task",
                "callback_url": "http://b.invalid/jobs/one/backend-result",
                "event_url": "http://a.invalid/v1/events",
                "request_id": "",
                "request_digest": "",
                "evaluation_id": "eval",
                "case_id": "case",
                "run_user": "",
                "cwd": "",
                "agent_preset": "",
                "model": "m",
                "benchmark": "b",
                "question_type": "unknown",
                "dataset_version": "",
                "dataset_sha256": "",
                "reported": 2,
                "undelivered": [],
                "reports_closed": True,
                "event_delivery": "delivered",
                "result_delivery": "failed",
                "result_report": {
                    "protocol_version": "2.0",
                    "run_id": "legacy-pending-result",
                    "request_id": "",
                    "evaluation_id": "eval",
                    "case_id": "case",
                    "model": "m",
                    "status": "succeeded",
                    "session_id": "legacy-session",
                    "task_id": "case",
                    "result": stored_result,
                    "error": None,
                },
                "result": stored_result,
                "error": None,
                "cancel_state": "none",
                "terminal_status": "succeeded",
                "done": True,
            }
        )
    )
    delivered: list[dict[str, Any]] = []

    class _Sink:
        def post(self, url, payload, timeout):
            delivered.append(payload)

    def refuse_execution(_):
        raise AssertionError("recovery must not start a harness")

    recovered = HarnessService(
        DeepSeekHarnessConfig(dsh_home=str(home)),
        harness_factory=refuse_execution,
        event_callback=_Sink(),
        result_callback=_Sink(),
    )
    try:
        assert recovered.run_state("legacy-pending-result")["status"] == "failed"
        _wait_for(lambda: bool(delivered), "the queued result report")
        outcome = next(p for p in delivered if "status" in p)
        assert outcome["status"] == "failed"
        assert "AUTH" in outcome["error"] and "401" in outcome["error"]
        assert outcome["result"]["finish_reason"] == "error"
        record = json.loads((directory / "state.json").read_text())
        assert record["terminal_status"] == "failed"
        assert record["result_report"]["status"] == "failed"
        assert record["result"]["events"] == [failure]
    finally:
        recovered.close()


def test_a_pending_legacy_final_event_is_corrected_with_the_recovered_status(
    tmp_path,
) -> None:
    """A queued final event is a draft too, and must not claim a success.

    The same recorded state queued its ``run/end`` report with
    ``status=succeeded`` before it was ever delivered. Recovery corrects the
    terminal status, so the queued final event must carry the same failure;
    an evaluator reading only the event channel would otherwise be told the
    turn succeeded.
    """
    import json

    home = tmp_path / "home"
    directory = home / "evaluation-runs" / "legacy-pending-final"
    directory.mkdir(parents=True)
    failure = {
        "type": "turn/end",
        "seq": 3,
        "time": 3,
        "data": {
            "turn": 1,
            "reason": {"kind": "error", "error": {"code": "AUTH", "status": 401}},
        },
    }
    stored_result = {
        "final_response": "",
        "finish_reason": "error",
        "session_id": "legacy-session",
        "events": [failure],
        "notifications": [],
    }
    queued_final = {
        "protocol_version": "2.0",
        "evaluation_id": "eval",
        "case_id": "case",
        "model": "m",
        "harness": "APUS",
        "benchmark": "b",
        "dataset_version": "",
        "dataset_sha256": "",
        "question_type": "unknown",
        "source_session_id": "legacy-session:service",
        "root_session_id": "legacy-session",
        "seq": 1,
        "first_seq": 1,
        "final": True,
        "question": "old task",
        "run_user": "",
        "delivery_seq": 3,
        "event": {
            "type": "run/end",
            "seq": 1,
            "time": 4,
            "data": {
                "status": "succeeded",
                "finish_reason": "error",
                "final_response": "",
                "error": None,
            },
        },
    }
    (directory / "state.json").write_text(
        json.dumps(
            {
                "protocol_version": "2.0",
                "run_id": "legacy-pending-final",
                "task_id": "case",
                "session_id": "legacy-session",
                "instruction": "old task",
                "callback_url": "",
                "event_url": "http://a.invalid/v1/events",
                "request_id": "",
                "request_digest": "",
                "evaluation_id": "eval",
                "case_id": "case",
                "run_user": "",
                "cwd": "",
                "agent_preset": "",
                "model": "m",
                "benchmark": "b",
                "question_type": "unknown",
                "dataset_version": "",
                "dataset_sha256": "",
                "reported": 3,
                "undelivered": [
                    {
                        "protocol_version": "2.0",
                        "evaluation_id": "eval",
                        "case_id": "case",
                        "model": "m",
                        "harness": "APUS",
                        "benchmark": "b",
                        "dataset_version": "",
                        "dataset_sha256": "",
                        "question_type": "unknown",
                        "source_session_id": "legacy-session",
                        "root_session_id": "legacy-session",
                        "seq": 1,
                        "first_seq": 1,
                        "final": False,
                        "question": "old task",
                        "run_user": "",
                        "delivery_seq": 2,
                        "event": {
                            "type": "turn/start",
                            "seq": 1,
                            "time": 2,
                            "data": {"turn": 1},
                        },
                    },
                    queued_final,
                ],
                "reports_closed": True,
                "event_delivery": "failed",
                "result_delivery": "delivered",
                "result_report": None,
                "result": stored_result,
                "error": None,
                "cancel_state": "none",
                "terminal_status": "succeeded",
                "done": True,
            }
        )
    )
    delivered: list[dict[str, Any]] = []

    class _Sink:
        def post(self, url, payload, timeout):
            delivered.append(payload)

    def refuse_execution(_):
        raise AssertionError("recovery must not start a harness")

    recovered = HarnessService(
        DeepSeekHarnessConfig(dsh_home=str(home)),
        harness_factory=refuse_execution,
        event_callback=_Sink(),
    )
    try:
        _wait_for(lambda: len(delivered) >= 2, "both queued events")
        # Only the terminal record carries an outcome; a source event keeps
        # its own body untouched.
        source = next(p for p in delivered if not p.get("final"))
        assert source["event"] == {
            "type": "turn/start",
            "seq": 1,
            "time": 2,
            "data": {"turn": 1},
        }
        assert source["delivery_seq"] == 2
        report = next(p for p in delivered if p.get("final"))
        assert report["event"]["data"]["status"] == "failed"
        assert "AUTH" in report["event"]["data"]["error"]
        assert report["delivery_seq"] == 3
        record = json.loads((directory / "state.json").read_text())
        assert record["terminal_status"] == "failed"
    finally:
        recovered.close()


def test_a_delivered_legacy_result_report_is_never_rewritten(tmp_path) -> None:
    """History stays history: a report the evaluator received is not resent or edited.

    Recovery still corrects the run's published status, because the run query
    is a live view. The result report that already reached the evaluator is
    the record of what it was told, so recovery leaves its bytes alone and
    does not open another result delivery.
    """
    import json

    home = tmp_path / "home"
    directory = home / "evaluation-runs" / "legacy-delivered-result"
    directory.mkdir(parents=True)
    delivered_report = {
        "protocol_version": "2.0",
        "run_id": "legacy-delivered-result",
        "request_id": "",
        "evaluation_id": "eval",
        "case_id": "case",
        "model": "m",
        "status": "succeeded",
        "session_id": "legacy-session",
        "task_id": "case",
        "result": {
            "final_response": "",
            "finish_reason": "error",
            "session_id": "legacy-session",
        },
        "error": None,
    }
    (directory / "state.json").write_text(
        json.dumps(
            {
                "protocol_version": "2.0",
                "run_id": "legacy-delivered-result",
                "task_id": "case",
                "session_id": "legacy-session",
                "instruction": "old task",
                "callback_url": "http://b.invalid/jobs/one/backend-result",
                "event_url": "http://a.invalid/v1/events",
                "request_id": "",
                "request_digest": "",
                "evaluation_id": "eval",
                "case_id": "case",
                "run_user": "",
                "cwd": "",
                "agent_preset": "",
                "model": "m",
                "benchmark": "b",
                "question_type": "unknown",
                "dataset_version": "",
                "dataset_sha256": "",
                "reported": 2,
                "undelivered": [],
                "reports_closed": True,
                "event_delivery": "delivered",
                "result_delivery": "delivered",
                "result_report": delivered_report,
                "result": {
                    "final_response": "",
                    "finish_reason": "error",
                    "session_id": "legacy-session",
                    "events": [],
                    "notifications": [],
                },
                "error": None,
                "cancel_state": "none",
                "terminal_status": "succeeded",
                "done": True,
            }
        )
    )
    calls: list[dict[str, Any]] = []

    class _Sink:
        def post(self, url, payload, timeout):
            calls.append(payload)

    def refuse_execution(_):
        raise AssertionError("recovery must not start a harness")

    recovered = HarnessService(
        DeepSeekHarnessConfig(dsh_home=str(home)),
        harness_factory=refuse_execution,
        result_callback=_Sink(),
    )
    try:
        state = recovered.run_state("legacy-delivered-result")
        assert state["status"] == "failed"
        assert state["error"]
        record = json.loads((directory / "state.json").read_text())
        assert record["terminal_status"] == "failed"
        assert record["result_delivery"] == "delivered"
        assert record["result_report"] == delivered_report
    finally:
        # Closing waits for any sender; nothing may have been posted at all.
        recovered.close()
    assert calls == []


def test_an_aborted_turn_is_a_failure_that_keeps_its_evidence() -> None:
    """A turn the runtime reports as ``aborted`` is not a completed case.

    Cancellation publishes ``cancelled``; an abort that reached the turn end
    without a cancel is a failed case. Its result stays available so the trace
    and diagnostic that explain it survive the status change.
    """
    harness = _FakeHarness()
    harness.finish_reason = "aborted"
    harness.events = [
        {
            "type": "turn/end",
            "seq": 2,
            "time": 2,
            "data": {"turn": 1, "reason": {"kind": "aborted"}},
        }
    ]
    harness.gate.set()
    service = _service(harness)
    try:
        run_id = service.start_run(
            {"instruction": "abort", "session_id": "aborted-turn"}
        )
        _wait_for(
            lambda: service.run_state(run_id)["status"] != "running",
            "the run to settle",
        )
        state = service.run_state(run_id)
        assert state["status"] == "failed"
        assert "aborted" in state["error"]
        assert state["finish_reason"] == "aborted"
        assert state["events"] == harness.events
    finally:
        service.close()


def test_store_failure_is_reported_as_a_gap_not_as_persistence(
    tmp_path, monkeypatch
) -> None:
    """A failed save must stay visible as missing evidence.

    The run keeps executing after a write failure, so its in-memory state is
    newer than anything on disk. The service must name the storage gap in the
    delivery state, and the file it left behind must still say the run was not
    done: restoring that file must not be read later as a finished run.
    """
    import json

    harness = _FakeHarness()
    harness.gate.set()
    accepted: list[dict[str, Any]] = []

    class _Sink:
        def post(self, url, payload, timeout):
            accepted.append(payload)

    service = HarnessService(
        DeepSeekHarnessConfig(dsh_home=str(tmp_path)),
        harness_factory=lambda _: harness,
        event_callback=_Sink(),
    )
    original = service._persist_run
    calls = {"count": 0}

    def fail_after_the_first_write(run):
        calls["count"] += 1
        if calls["count"] == 1:
            original(run)
            return
        raise OSError("disk full")

    monkeypatch.setattr(service, "_persist_run", fail_after_the_first_write)
    try:
        run_id = service.start_run(
            {
                "instruction": "run",
                "session_id": "store-failure",
                "event_url": "http://a.invalid/v1/events",
            }
        )
        _wait_for(
            lambda: service.run_state(run_id)["status"] == "completed",
            "the run to settle",
        )
        state = service.run_state(run_id)
        assert "report storage failed" in state["delivery_state"]["error"]
        assert "OSError" in state["delivery_state"]["error"]
        record = json.loads(
            (tmp_path / "evaluation-runs" / run_id / "state.json").read_text()
        )
        assert record["done"] is False
        assert record["terminal_status"] is None
    finally:
        service.close()


def test_a_state_already_corrected_to_failed_still_fixes_its_queued_drafts(
    tmp_path,
) -> None:
    """Recovery is repeatable: a second restart must finish the same repair.

    An earlier build corrected ``terminal_status`` to ``failed`` and persisted
    that, but left the queued result report and final event at ``succeeded``.
    Restarting with this build must correct those drafts too; otherwise the
    evaluator is told failure in the run query and success on its callbacks.
    """
    import json

    home = tmp_path / "home"
    directory = home / "evaluation-runs" / "legacy-twice"
    directory.mkdir(parents=True)
    failure = {
        "type": "turn/end",
        "seq": 3,
        "time": 3,
        "data": {
            "turn": 1,
            "reason": {"kind": "error", "error": {"code": "AUTH", "status": 401}},
        },
    }
    stored_result = {
        "final_response": "",
        "finish_reason": "error",
        "session_id": "legacy-session",
        "events": [failure],
        "notifications": [],
    }
    queued_final = {
        "protocol_version": "2.0",
        "evaluation_id": "eval",
        "case_id": "case",
        "model": "m",
        "harness": "APUS",
        "benchmark": "b",
        "dataset_version": "",
        "dataset_sha256": "",
        "question_type": "unknown",
        "source_session_id": "legacy-session:service",
        "root_session_id": "legacy-session",
        "seq": 1,
        "first_seq": 1,
        "final": True,
        "question": "old task",
        "run_user": "",
        "delivery_seq": 2,
        "event": {
            "type": "run/end",
            "seq": 1,
            "time": 4,
            "data": {
                "status": "succeeded",
                "finish_reason": "error",
                "final_response": "",
                "error": None,
            },
        },
    }
    (directory / "state.json").write_text(
        json.dumps(
            {
                "protocol_version": "2.0",
                "run_id": "legacy-twice",
                "task_id": "case",
                "session_id": "legacy-session",
                "instruction": "old task",
                "callback_url": "http://b.invalid/jobs/one/backend-result",
                "event_url": "http://a.invalid/v1/events",
                "request_id": "",
                "request_digest": "",
                "evaluation_id": "eval",
                "case_id": "case",
                "run_user": "",
                "cwd": "",
                "agent_preset": "",
                "model": "m",
                "benchmark": "b",
                "question_type": "unknown",
                "dataset_version": "",
                "dataset_sha256": "",
                "reported": 2,
                "undelivered": [queued_final],
                "reports_closed": True,
                "event_delivery": "failed",
                "result_delivery": "failed",
                "result_report": {
                    "protocol_version": "2.0",
                    "run_id": "legacy-twice",
                    "request_id": "",
                    "evaluation_id": "eval",
                    "case_id": "case",
                    "model": "m",
                    "status": "succeeded",
                    "session_id": "legacy-session",
                    "task_id": "case",
                    "result": dict(stored_result),
                    "error": None,
                },
                "result": stored_result,
                "error": "turn ended with 'error': AUTH 401",
                "cancel_state": "none",
                "terminal_status": "failed",
                "done": True,
            }
        )
    )
    delivered: list[dict[str, Any]] = []

    class _Sink:
        def post(self, url, payload, timeout):
            delivered.append(payload)

    def refuse_execution(_):
        raise AssertionError("recovery must not start a harness")

    recovered = HarnessService(
        DeepSeekHarnessConfig(dsh_home=str(home)),
        harness_factory=refuse_execution,
        event_callback=_Sink(),
        result_callback=_Sink(),
    )
    try:
        _wait_for(lambda: len(delivered) >= 2, "both queued drafts")
        outcome = next(p for p in delivered if "status" in p)
        final = next(p for p in delivered if p.get("final"))
        assert outcome["status"] == "failed"
        assert "AUTH" in outcome["error"]
        assert final["event"]["data"]["status"] == "failed"
        assert final["delivery_seq"] == 2
    finally:
        recovered.close()


def test_a_recovered_cancelled_run_is_not_rewritten_as_failed(tmp_path) -> None:
    """A confirmed cancellation keeps ``cancelled``; only turn outcomes are mapped."""
    import json

    home = tmp_path / "home"
    directory = home / "evaluation-runs" / "legacy-cancelled"
    directory.mkdir(parents=True)
    (directory / "state.json").write_text(
        json.dumps(
            {
                "protocol_version": "2.0",
                "run_id": "legacy-cancelled",
                "task_id": "case",
                "session_id": "legacy-session",
                "instruction": "old task",
                "callback_url": "",
                "event_url": "",
                "request_id": "",
                "request_digest": "",
                "evaluation_id": "eval",
                "case_id": "case",
                "run_user": "",
                "cwd": "",
                "agent_preset": "",
                "model": "m",
                "benchmark": "b",
                "question_type": "unknown",
                "dataset_version": "",
                "dataset_sha256": "",
                "reported": 1,
                "undelivered": [],
                "reports_closed": True,
                "event_delivery": "delivered",
                "result_delivery": "idle",
                "result_report": None,
                "result": {
                    "final_response": "",
                    "finish_reason": "aborted",
                    "session_id": "legacy-session",
                    "events": [],
                    "notifications": [],
                },
                "error": None,
                "cancel_state": "cancelled",
                "terminal_status": "cancelled",
                "done": True,
            }
        )
    )

    def refuse_execution(_):
        raise AssertionError("recovery must not start a harness")

    recovered = HarnessService(
        DeepSeekHarnessConfig(dsh_home=str(home)),
        harness_factory=refuse_execution,
    )
    try:
        assert recovered.run_state("legacy-cancelled")["status"] == "cancelled"
        record = json.loads((directory / "state.json").read_text())
        assert record["terminal_status"] == "cancelled"
    finally:
        recovered.close()


def test_a_recovered_in_flight_cancellation_is_not_turned_into_a_turn_failure(
    tmp_path,
) -> None:
    """A state caught mid-cancellation keeps its own status.

    The turn end says ``aborted``, which would map to a failed case, but the
    run is still cancelling: rewriting the status on disk while the run query
    says ``cancelling`` publishes two different answers for one run.
    """
    import json

    home = tmp_path / "home"
    directory = home / "evaluation-runs" / "stuck-cancelling"
    directory.mkdir(parents=True)
    (directory / "state.json").write_text(
        json.dumps(
            {
                "protocol_version": "2.0",
                "run_id": "stuck-cancelling",
                "task_id": "case",
                "session_id": "legacy-session",
                "instruction": "old task",
                "callback_url": "",
                "event_url": "",
                "request_id": "",
                "request_digest": "",
                "evaluation_id": "eval",
                "case_id": "case",
                "run_user": "",
                "cwd": "",
                "agent_preset": "",
                "model": "m",
                "benchmark": "b",
                "question_type": "unknown",
                "dataset_version": "",
                "dataset_sha256": "",
                "reported": 1,
                "undelivered": [],
                "reports_closed": True,
                "event_delivery": "delivered",
                "result_delivery": "idle",
                "result_report": None,
                "result": {
                    "final_response": "",
                    "finish_reason": "aborted",
                    "session_id": "legacy-session",
                    "events": [],
                    "notifications": [],
                },
                "error": None,
                "cancel_state": "cancelling",
                "terminal_status": "cancelled",
                "done": True,
            }
        )
    )

    def refuse_execution(_):
        raise AssertionError("recovery must not start a harness")

    recovered = HarnessService(
        DeepSeekHarnessConfig(dsh_home=str(home)),
        harness_factory=refuse_execution,
    )
    try:
        assert recovered.run_state("stuck-cancelling")["status"] == "cancelling"
        record = json.loads((directory / "state.json").read_text())
        # Whatever the query says must match what is written down.
        assert record["terminal_status"] == "cancelled"
    finally:
        recovered.close()


_RUNTIME_SCRIPT = """
import json, sys
VIEW = {
    "sessionId": "s", "dispatchSeq": 10, "prefixEnd": 9, "turn": 1, "step": 1,
    "header": {"config": {"provider": "p", "model": "m"}},
    "messages": [{"role": "user", "content": [{"type": "text", "text": "over the wire"}]}],
    "toolHistory": {"tools": [], "updates": []},
    "settlementSeq": 11, "projectionTypes": ["image/offload"],
}

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\\n")
    sys.stdout.flush()

for line in sys.stdin:
    msg = json.loads(line)
    method, rid = msg.get("method"), msg.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": rid, "result": {
            "serverInfo": {"name": "fake-runtime", "version": "0"},
            "capabilities": ["request-view/dispatch-v1"],
        }})
    elif method == "session/prompt":
        send({"jsonrpc": "2.0", "id": rid, "result": {"messageId": "m1"}})
        send({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "s", "event": {
            "type": "agent/inbox/spliced", "seq": 1, "time": 1,
            "data": {"inserted": [{"id": "m1"}]}}}})
        send({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "s", "event": {
            "type": "llm/dispatch", "seq": 10, "time": 2,
            "data": {"sessionId": "s", "prefixEnd": 9, "turn": 1, "step": 1}}}})
        send({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "s", "event": {
            "type": "assistant/message", "seq": 11, "time": 3,
            "data": {"turn": 1, "step": 1, "message": {
                "role": "assistant", "id": "a1", "source": {"kind": "model"},
                "content": [{"type": "text", "text": "ok"}]}}}}})
        send({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "s", "event": {
            "type": "llm/dispatch-settled", "seq": 12, "time": 4,
            "data": {"sessionId": "s", "dispatchSeq": 10, "settlementSeq": 11}}}})
        send({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": "s", "event": {
            "type": "turn/end", "seq": 13, "time": 5,
            "data": {"turn": 1, "reason": {"kind": "completed"}}}}})
        send({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": "s", "status": "idle"}})
    elif method == "session/request-view":
        params = msg.get("params") or {}
        send({"jsonrpc": "2.0", "id": rid, "result": {
            **VIEW, "sessionId": params.get("sessionId", "s"),
            "dispatchSeq": params.get("dispatchSeq", 10)}})
    elif method == "shutdown":
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
        break
"""


def test_the_view_arrives_over_the_runtime_wire_not_a_stand_in(tmp_path) -> None:
    """The sidecar is fetched through the SDK's own JSON-RPC client.

    A stubbed client would prove the sender-thread placement and nothing about
    the real seam: method name, params, envelope validation, and the refusal
    path all live in the client. This runtime answers over stdio instead.
    """
    home = tmp_path / "home"
    home.mkdir()
    script = tmp_path / "fake_runtime.py"
    script.write_text(f"#!{sys.executable}\n{_RUNTIME_SCRIPT}", encoding="utf-8")
    script.chmod(0o755)
    reports: list[dict[str, Any]] = []

    class _Events:
        def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
            reports.append(payload)

    config = DeepSeekHarnessConfig(
        dsh_bin=str(script),
        dsh_home=str(home),
        cwd=str(tmp_path),
        env={},
    )
    service = HarnessService(config, event_callback=_Events())
    try:
        service.start_run(
            {
                "instruction": "do it",
                "session_id": "s",
                "event_url": "http://events.invalid/v1/events",
            }
        )
        _wait_for(
            lambda: any(r["event"]["type"] == "llm/dispatch" for r in reports),
            "the dispatch report over the real wire",
        )
        _wait_for(
            lambda: any(r["event"]["type"] == "llm/dispatch-settled" for r in reports),
            "the settled report over the real wire",
        )
        dispatch = next(r for r in reports if r["event"]["type"] == "llm/dispatch")
        settled = next(
            r for r in reports if r["event"]["type"] == "llm/dispatch-settled"
        )
        assert (
            dispatch["request_view"]["messages"][0]["content"][0]["text"]
            == "over the wire"
        )
        assert dispatch["request_view"]["projectionTypes"] == ["image/offload"]
        assert settled["request_view"]["dispatchSeq"] == 10
    finally:
        service.close()


def test_two_sessions_with_the_same_dispatch_seq_keep_their_own_views() -> None:
    """Dispatch seqs are per session; a parent and a child both open at seq 10.

    A cache keyed by seq alone would hand the child the root's request view,
    which is a different model call. The view a report carries must belong to
    the session that report names.
    """
    root_view = {
        **_NATIVE_VIEW,
        "sessionId": "root-native",
        "dispatchSeq": 10,
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": "root call"}]}
        ],
    }
    child_view = {
        **_NATIVE_VIEW,
        "sessionId": "child-native",
        "dispatchSeq": 10,
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": "child call"}]}
        ],
    }

    class _TwoViewClient:
        calls: list[tuple[str, int]] = []

        def session_request_view(
            self, session_id: str, dispatch_seq: int
        ) -> dict[str, Any]:
            type(self).calls.append((session_id, dispatch_seq))
            return dict(root_view if session_id == "root-native" else child_view)

    harness = _FakeHarness()
    harness.client = _TwoViewClient()
    harness.notifications = [
        Notification(
            method="session.event",
            payload={
                "sessionId": "root-native",
                "event": {
                    "type": "llm/dispatch",
                    "seq": 10,
                    "time": 1,
                    "data": {
                        "sessionId": "root-native",
                        "prefixEnd": 9,
                        "turn": 1,
                        "step": 1,
                    },
                },
            },
        ),
        Notification(
            method="session.event",
            payload={
                "sessionId": "child-native",
                "event": {
                    "type": "llm/dispatch",
                    "seq": 10,
                    "time": 2,
                    "data": {
                        "sessionId": "child-native",
                        "prefixEnd": 9,
                        "turn": 1,
                        "step": 1,
                    },
                },
            },
        ),
    ]
    harness.gate.set()
    events: list[dict[str, Any]] = []
    service = _collecting_service(harness, events)
    try:
        service.start_run(
            {
                "instruction": "delegate",
                "session_id": "root-native",
                "event_url": "http://events.invalid/v1/events",
            }
        )
        _wait_for(lambda: len(events) >= 2, "both dispatch reports")
        by_session = {e["source_session_id"]: e for e in events if not e.get("final")}
        assert (
            by_session["root-native"]["request_view"]["messages"][0]["content"][0][
                "text"
            ]
            == "root call"
        )
        assert (
            by_session["child-native"]["request_view"]["messages"][0]["content"][0][
                "text"
            ]
            == "child call"
        )
        assert sorted(_TwoViewClient.calls) == [
            ("child-native", 10),
            ("root-native", 10),
        ]
    finally:
        service.close()
