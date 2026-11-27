"""HTTP surface for driving this harness from another process.

An evaluator runs outside this container and needs to hand work in and read
results back over the network. The harness already speaks JSON-RPC to its own
child process, but that transport is stdio and assumes a local parent; this
module wraps the same SDK in a small HTTP server so the harness can be a
long-lived service that other containers address by URL.

Only the standard library is used: the SDK's dependency list is pydantic and
the runtime binary, and a web framework for four routes would be a new
platform choice this package does not otherwise make.

@module deepseek_harness.service
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field, replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import SplitResult, urlsplit

from .api import DeepSeekHarness, DeepSeekHarnessConfig


@dataclass
class _Run:
    """One task the evaluator handed in, and what it has produced so far."""

    run_id: str
    task_id: str
    instruction: str
    session_id: str
    # The harness instance this run was bound to. Cancellation must reach the
    # same instance, which is not necessarily the deployment's own route.
    route: tuple[str, ...] = ()
    # Where this run reports its outcome, and the identity the caller knows it
    # by. Empty means the caller did not ask to be told.
    callback_url: str = ""
    request_id: str = ""
    # The evaluation this run's case belongs to. Its events and its verdict are
    # reported under it, which is what lets a verdict find the trace the case
    # wrote; a per-job id would separate the two.
    evaluation_id: str = ""
    event_url: str = ""
    case_id: str = ""
    run_user: str = ""
    request_digest: str = ""
    cwd: str = ""
    agent_preset: str = ""
    session_parents: dict[str, str] = field(default_factory=dict)
    model: str = ""
    benchmark: str = ""
    dataset_version: str = ""
    dataset_sha256: str = ""
    question_type: str = "unknown"
    # Where the run is in its own lifecycle, and when it last moved. A caller
    # that only sees `running` cannot tell a slow model call from a run that
    # stopped progressing, and neither can the service's own health check.
    stage: str = "accepted"
    accepted_at: float = field(default_factory=time.monotonic)
    started_at: float | None = None
    last_progress_at: float = field(default_factory=time.monotonic)
    last_progress_stage: str = "accepted"
    # The last source event seq this run saw, so progress can be reported
    # without carrying the events themselves.
    last_event_seq: int | None = None
    worker_done: threading.Event = field(default_factory=threading.Event)
    worker: threading.Thread | None = None
    terminal_status: str | None = None
    # How many events this run has reported, which is the source sequence the
    # evaluator de-dupes and orders by.
    reported: int = 0
    # One request-view decision per (source session, dispatch seq): the
    # runtime's view, or None when it could not be produced. Seqs are per
    # session, so the session is part of the key. A retry repeats the recorded
    # decision instead of asking again, so a delivered report never changes.
    request_views: dict[tuple[str, int], dict[str, Any] | None] = field(
        default_factory=dict
    )
    # The harness whose client answers request views for this run. Set when the
    # run starts; the sender thread uses it, never the notification callback.
    view_source: Any = None
    # Reports the evaluator did not accept, oldest first. They keep their
    # sequence numbers: the receiver writes a contiguous run only, so skipping
    # one would hold every event after it.
    undelivered: list[dict[str, Any]] = field(default_factory=list)
    delivery_condition: threading.Condition = field(default_factory=threading.Condition)
    event_sender: threading.Thread | None = None
    result_sender: threading.Thread | None = None
    reports_closed: bool = False
    event_delivery: str = "idle"
    result_delivery: str = "idle"
    result_report: dict[str, Any] | None = None
    delivery_error: str | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    # ``none`` → ``cancelling`` → ``cancelled`` | ``cancel-failed``. Only a
    # confirmed stop may be published as ``cancelled``.
    cancel_state: str = "none"
    cancellation_done: threading.Event = field(default_factory=threading.Event)
    done: threading.Event = field(default_factory=threading.Event)

    @property
    def cancel_requested(self) -> bool:
        """Whether the run must withhold delivery and its own outcome."""
        return self.cancel_state != "none"


class _RunCancelled(Exception):
    """Internal signal: the run was cancelled before its prompt was delivered."""


@dataclass
class _RuntimeUsage:
    """What the service knows about one route's runtime process.

    The runtime outlives the runs it serves, so its lifetime has to be owned
    somewhere: this record is what lets the service answer "which process serves
    this route, since when, and is anything still using it" and lets it retire a
    route that no run needs any more.
    """

    route: tuple[str, ...]
    harness: Any
    started_at: float
    last_used_at: float


class _RequestConflict(ValueError):
    """A caller reused one accepted request identity for different work."""


# The per-run route fields, and the environment names the harness profile reads
# them from. Both are needed: ``initialize`` names the provider and model, while
# the profile's route (its gateway base URL and key) is read from the runtime
# subprocess environment. Setting only one would advertise a model the profile
# never reaches.
_ROUTE_FIELDS = ("model", "base_url", "api_key")
_ROUTE_ENV = {
    "model": "LLM_MODEL",
    "base_url": "LLM_BASE_URL",
    "api_key": "LLM_API_KEY",
}


def _route_env(route: dict[str, str]) -> dict[str, str]:
    return {
        _ROUTE_ENV[name]: value for name, value in route.items() if name in _ROUTE_ENV
    }


def _route_key(config: DeepSeekHarnessConfig) -> tuple[str, ...]:
    """Which route a harness belongs to, as the values that fix it at start.

    The model and endpoint are what the runtime cannot change after it
    initializes; the key is part of the same identity so two evaluations using
    different credentials never share a runtime.
    """
    return (
        config.provider,
        config.model,
        config.base_url or "",
        config.api_key or "",
    )


def _callback_url_from_task(task: dict[str, Any]) -> str:
    """Where this run reports its outcome, validated before the run starts.

    A malformed URL must fail the submission: a run that only discovers its
    callback is unusable at the end has already spent the whole task budget.
    """
    raw = task.get("callback_url")
    if raw is None:
        return ""
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("task.callback_url must be a nonempty string")
    url = raw.strip()
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("task.callback_url must be an http(s) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(
            "task.callback_url must not carry credentials, a query or a fragment"
        )
    return url


def _event_url_from_task(task: dict[str, Any]) -> str:
    """Where this run reports its events, validated before it starts."""
    raw = task.get("event_url")
    if raw is None:
        return ""
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("task.event_url must be a nonempty string")
    url = raw.strip()
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("task.event_url must be an http(s) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(
            "task.event_url must not carry credentials, a query or a fragment"
        )
    return url


def _route_from_task(task: dict[str, Any]) -> dict[str, str]:
    """The model route one run asked for, rejecting values a run cannot carry.

    Validation happens here, before the run is registered: a malformed route
    must not produce a run that fails only after it starts.
    """
    llm = task.get("llm")
    if llm is None:
        return {}
    if not isinstance(llm, dict):
        raise ValueError("task.llm must be an object")
    route: dict[str, str] = {}
    for route_field in _ROUTE_FIELDS:
        value = llm.get(route_field)
        if value is None:
            continue
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"task.llm.{route_field} must be a nonempty string")
        route[route_field] = value.strip()
    base_url = route.get("base_url")
    if base_url is not None and not (
        base_url.startswith("http://") or base_url.startswith("https://")
    ):
        raise ValueError("task.llm.base_url must be an http(s) URL")
    return route


def _dispatch_reference(body: dict[str, Any]) -> int | None:
    """Return the dispatch seq a report is about, or None for other events.

    Only the two dispatch events may carry a view. A settled record names the
    dispatch it closed in its own data, so its view is that dispatch's, not a
    view of the settled record's own sequence.
    """
    event = body.get("event")
    if not isinstance(event, dict):
        return None
    event_type = event.get("type")
    if event_type not in ("llm/dispatch", "llm/dispatch-settled"):
        return None
    if event_type == "llm/dispatch":
        value = event.get("seq")
    else:
        data = event.get("data")
        value = data.get("dispatchSeq") if isinstance(data, dict) else None
    return value if type(value) is int else None


def _finish_error(reason: str | None, events: Any) -> str:
    """Name why a normal harness return is not a completed case.

    The runtime ends a failed turn with ``error`` and still reports idle, so
    the SDK returns a result instead of raising. The turn-end event carries the
    structured failure; keep its code, status, and message so the published
    error names the same cause the trace does.
    """
    for event in reversed(events or []):
        if not isinstance(event, dict) or event.get("type") != "turn/end":
            continue
        data = event.get("data")
        detail = data.get("reason") if isinstance(data, dict) else None
        error = detail.get("error") if isinstance(detail, dict) else None
        if not isinstance(error, dict):
            break
        facts = " ".join(
            str(error[key])
            for key in ("code", "status", "message")
            if error.get(key) not in (None, "")
        )
        return f"turn ended with {reason!r}" + (f": {facts}" if facts else "")
    return f"turn ended with {reason!r}"


def _max_tokens_as_success() -> bool:
    """Read the deployment's mapping for a token-capped turn.

    ``deploy/evaluation.patch.yml`` passes ``DSH_MAX_TOKENS_AS_SUCCESS`` to the
    runtime and treats an unset value as ``true``; the service shares that
    environment, so the root outcome follows the same switch.
    """
    raw = os.environ.get("DSH_MAX_TOKENS_AS_SUCCESS")
    if raw is None or not raw.strip():
        return True
    try:
        value = json.loads(raw)
    except ValueError as error:
        raise ValueError("DSH_MAX_TOKENS_AS_SUCCESS must be a JSON boolean") from error
    if not isinstance(value, bool):
        raise ValueError("DSH_MAX_TOKENS_AS_SUCCESS must be a JSON boolean")
    return value


def _status_for_finish(
    reason: str | None,
    events: Any,
    max_tokens_as_success: bool,
) -> tuple[str, str | None]:
    """Map a finished turn's own reason to the run's published outcome.

    ``completed`` is success; ``max-tokens`` follows the deployment switch.
    Every other kind — ``error``, ``aborted``, ``blocked``, ``interrupted``,
    ``forked``, or no turn end at all — is a failed case, never a score of
    zero. Cancellation still owns ``cancelled`` in ``_finish_run``.
    """
    if reason == "completed":
        return "succeeded", None
    if reason == "max-tokens" and max_tokens_as_success:
        return "succeeded", None
    return "failed", _finish_error(reason, events)


def _rewrite_pending_outcome(run: _Run, status: str) -> None:
    """Correct queued drafts to the outcome a recovered run really produced.

    A result report or final event the evaluator never received is still a
    draft, so it must carry the recovered status. Anything already delivered
    is history: its bytes stay exactly as the evaluator received them.
    """
    if isinstance(run.result_report, dict) and run.result_delivery != "delivered":
        run.result_report["status"] = status
        run.result_report["error"] = run.error
    for queued in run.undelivered:
        event = queued.get("event")
        if queued.get("final") is not True or not isinstance(event, dict):
            continue
        data = event.get("data")
        if isinstance(data, dict):
            data["status"] = status
            data["error"] = run.error


def _refuse_when_cancelled(run: _Run) -> Callable[[], None]:
    """Build the delivery-point check for one run's prompt."""

    def check() -> None:
        if run.cancel_requested:
            raise _RunCancelled

    return check


class HarnessService:
    """Drives the harness over HTTP for an external evaluator.

    One harness instance is kept alive per model route: starting it is the
    expensive part, and a per-request process would pay that cost every time.
    Runs are isolated by session id and by their own working directory.

    A run may name the route it wants (``model``, ``base_url``, ``api_key``),
    so one long-lived service serves several models without a restart. A run
    that names none uses the deployment's own route and shares that harness.
    """

    def __init__(
        self,
        config: DeepSeekHarnessConfig,
        *,
        harness_factory: Callable[[DeepSeekHarnessConfig], Any] | None = None,
        result_callback: Any = None,
        event_callback: Any = None,
        api_token: str | None = None,
    ) -> None:
        self._config = config
        self._api_token = (
            api_token
            if api_token is not None
            else os.environ.get("DSH_SERVICE_TOKEN", "").strip()
        )
        # Where each finished event is reported. Separate from the result
        # callback on purpose: a trace service that is down must not cost the
        # caller the outcome the run actually produced.
        self._event_callback = event_callback
        # Where a finished run reports its outcome. The caller that submitted a
        # task is not holding the connection open — a task can run for hours —
        # so this callback is the only way it learns the run ended.
        self._result_callback = result_callback
        # One harness per route, keyed by what actually selects the model. Two
        # runs naming the same route share it; a different route gets its own,
        # because the model is fixed when the runtime is initialized.
        self._harnesses: dict[tuple[str, ...], _RuntimeUsage] = {}
        # A route's runtime is a whole Node process. Without a ceiling, every
        # model, endpoint or credential a caller names would leave one behind
        # for the life of the service; the oldest idle route is retired first.
        self._max_runtimes = int(os.environ.get("DSH_MAX_RUNTIMES", "4"))
        if self._max_runtimes < 1:
            raise ValueError("DSH_MAX_RUNTIMES must be at least 1")
        # How long an idle route's runtime may stay up before it is retired.
        # Zero disables idle retirement: the deployment may prefer to pay the
        # start cost again later rather than hold a process it is not using.
        self._idle_runtime_seconds = float(os.environ.get("DSH_IDLE_RUNTIME_SEC", "0"))
        if (
            not math.isfinite(self._idle_runtime_seconds)
            or self._idle_runtime_seconds < 0
        ):
            raise ValueError("DSH_IDLE_RUNTIME_SEC must be finite and nonnegative")
        # How long a run may stay in acceptance or start-up before it is
        # reported stuck, and the same for a run that is executing but has gone
        # quiet. Zero disables the check for that stage.
        self._run_stuck_after_seconds = float(
            os.environ.get("DSH_RUN_STUCK_SEC", "600")
        )
        self._run_executing_stuck_after_seconds = float(
            os.environ.get("DSH_RUN_EXECUTING_STUCK_SEC", "3600")
        )
        for name, value in (
            ("DSH_RUN_STUCK_SEC", self._run_stuck_after_seconds),
            ("DSH_RUN_EXECUTING_STUCK_SEC", self._run_executing_stuck_after_seconds),
        ):
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be finite and nonnegative")
        self._factory = harness_factory or DeepSeekHarness
        self._runs: dict[str, _Run] = {}
        self._requests: dict[str, str] = {}
        self._lock = threading.Lock()
        # Guards harness construction and its one-time start per route. Kept
        # apart from ``_lock``, which guards the run registry: holding the
        # registry lock across a spawn would block every status poll.
        self._start_lock = threading.Lock()
        self._shutdown = threading.Event()
        self._delivery_attempts = int(os.environ.get("DSH_DELIVERY_MAX_ATTEMPTS", "3"))
        self._delivery_recovery_attempts = int(
            os.environ.get("DSH_DELIVERY_RECOVERY_ATTEMPTS", "3")
        )
        self._retry_delay = float(os.environ.get("DSH_DELIVERY_RETRY_DELAY_SEC", "0.1"))
        self._event_timeout = float(os.environ.get("DSH_EVENT_TIMEOUT_SEC", "5"))
        self._result_timeout = float(os.environ.get("DSH_CALLBACK_TIMEOUT_SEC", "10"))
        # 取消确认要等 worker 真正停下，而 SDK 的取消请求受调用方自己的请求预算
        # 约束；沿用投递超时会在慢确认时提前报“未停止”。DSH_CANCEL_WAIT_SEC 为
        # 显式上限，未设置时把投递超时与请求预算相加作为下限。
        self._cancel_wait = float(os.environ.get("DSH_CANCEL_WAIT_SEC", "0"))
        # The runtime's own mapping for a token-capped turn; read once here so
        # a malformed value fails at start rather than at the first outcome.
        self._max_tokens_as_success = _max_tokens_as_success()
        if (
            self._delivery_attempts < 1
            or self._delivery_recovery_attempts < 0
            or not math.isfinite(self._retry_delay)
            or self._retry_delay < 0
        ):
            raise ValueError("delivery retry settings must be finite and nonnegative")
        if any(
            not math.isfinite(value) or value <= 0
            for value in (self._event_timeout, self._result_timeout)
        ):
            raise ValueError("delivery timeouts must be finite positive seconds")
        self._delivery_failure_delay = max(
            self._retry_delay * (2**self._delivery_attempts), 0.01
        )
        home = config.dsh_home or os.environ.get("DSH_HOME", "").strip()
        self._run_store = Path(home) / "evaluation-runs" if home else None
        if self._run_store is not None:
            self._run_store.mkdir(mode=0o700, parents=True, exist_ok=True)
            self._recover_reports()

    def _persist_run(self, run: _Run) -> None:
        if self._run_store is None:
            return
        with run.delivery_condition:
            directory = self._run_store / run.run_id
            directory.mkdir(mode=0o700, exist_ok=True)
            data = {
                "protocol_version": "2.0",
                "run_id": run.run_id,
                "task_id": run.task_id,
                "session_id": run.session_id,
                "instruction": run.instruction,
                "callback_url": run.callback_url,
                "event_url": run.event_url,
                "request_id": run.request_id,
                "request_digest": run.request_digest,
                "evaluation_id": run.evaluation_id,
                "case_id": run.case_id,
                "run_user": run.run_user,
                "cwd": run.cwd,
                "agent_preset": run.agent_preset,
                "model": run.model,
                "benchmark": run.benchmark,
                "question_type": run.question_type,
                "dataset_version": run.dataset_version,
                "dataset_sha256": run.dataset_sha256,
                "reported": run.reported,
                "undelivered": run.undelivered,
                "reports_closed": run.reports_closed,
                "event_delivery": run.event_delivery,
                "result_delivery": run.result_delivery,
                "result_report": run.result_report,
                "result": run.result,
                "error": run.error,
                # Each dispatch's decided view, including an explicit null:
                # a restart must repeat the decision instead of asking again.
                "request_views": [
                    {
                        "source_session_id": session_id,
                        "dispatch_seq": dispatch,
                        "view": view,
                    }
                    for (session_id, dispatch), view in sorted(
                        run.request_views.items()
                    )
                ],
                "cancel_state": run.cancel_state,
                "terminal_status": run.terminal_status,
                "done": run.done.is_set(),
            }
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=directory, delete=False
            ) as stream:
                pending = Path(stream.name)
                try:
                    json.dump(data, stream, ensure_ascii=False, allow_nan=False)
                    stream.flush()
                    os.fsync(stream.fileno())
                except BaseException:
                    pending.unlink(missing_ok=True)
                    raise
            try:
                pending.replace(directory / "state.json")
            finally:
                pending.unlink(missing_ok=True)

    def _recover_reports(self) -> None:
        assert self._run_store is not None
        for path in self._run_store.glob("*/state.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("protocol_version") != "2.0":
                continue
            run = _Run(
                run_id=path.parent.name,
                task_id=data["task_id"],
                instruction=data["instruction"],
                session_id=data["session_id"],
                request_id=data["request_id"],
                callback_url=data["callback_url"],
                event_url=data["event_url"],
                request_digest=data.get("request_digest", ""),
                evaluation_id=data["evaluation_id"],
                case_id=data["case_id"],
                run_user=data["run_user"],
                cwd=data.get("cwd", ""),
                agent_preset=data.get("agent_preset", ""),
                model=data.get("model", ""),
                benchmark=data.get("benchmark", ""),
                dataset_version=data.get("dataset_version", ""),
                dataset_sha256=data.get("dataset_sha256", ""),
                question_type=data.get("question_type", "unknown"),
                reported=data["reported"],
                undelivered=data["undelivered"],
                reports_closed=data["reports_closed"],
                event_delivery=data["event_delivery"],
                result_delivery=data["result_delivery"],
                result_report=data["result_report"],
                result=data["result"],
                error=data["error"],
                cancel_state=data["cancel_state"],
                terminal_status=data.get("terminal_status"),
            )
            for decision in data.get("request_views") or []:
                # Older states have no record; the outbox body still carries
                # whatever its first attempt sent, which the sender reuses.
                if not isinstance(decision, dict):
                    continue
                session_id = decision.get("source_session_id")
                dispatch = decision.get("dispatch_seq")
                if isinstance(session_id, str) and type(dispatch) is int:
                    view = decision.get("view")
                    run.request_views[(session_id, dispatch)] = (
                        view if isinstance(view, dict) else None
                    )
            if isinstance(run.result_report, dict):
                # A report persisted before callbacks stopped repeating the
                # event history is still oversized; compact the outbound copy.
                run.result_report["result"] = self._callback_result(
                    run.result_report.get("result")
                )
            if not data["done"]:
                run.error = (
                    "execution state unknown after service restart; task was not rerun"
                )
                run.terminal_status = "failed"
            elif (
                run.terminal_status is not None
                and run.cancel_state not in ("cancelling", "cancelled")
                and isinstance(run.result, dict)
            ):
                # A state written before the outcome followed the turn's own
                # reason may claim the wrong status, and an earlier build may
                # have corrected the run without its queued drafts. Re-read the
                # persisted result; the evidence stays exactly as recorded.
                settled, reason_error = _status_for_finish(
                    run.result.get("finish_reason"),
                    run.result.get("events"),
                    self._max_tokens_as_success,
                )
                if settled != "succeeded":
                    run.terminal_status = settled
                    run.error = run.error or reason_error
                    _rewrite_pending_outcome(run, settled)
            run.done.set()
            run.worker_done.set()
            self._runs[run.run_id] = run
            if run.request_id:
                self._requests[run.request_id] = run.run_id
            if run.undelivered and self._event_callback is not None:
                run.event_sender = threading.Thread(
                    target=self._send_events,
                    args=(run,),
                    name=f"events-{run.run_id}",
                    daemon=True,
                )
                run.event_sender.start()
            if (
                run.result_report is not None
                and run.result_delivery != "delivered"
                and self._result_callback is not None
            ):
                run.result_sender = threading.Thread(
                    target=self._send_result,
                    args=(run,),
                    name=f"result-{run.run_id}",
                    daemon=True,
                )
                run.result_sender.start()
            if run.terminal_status is not None:
                self._report_run_end(run, run.terminal_status)
                self._report_result(run, run.terminal_status)
            self._persist_run(run)

    def _ensure_started(self, route: dict[str, str]) -> Any:
        """Start this route's harness once, even when several runs ask together.

        Each run executes on its own worker thread, so two runs arriving
        together reach this method together. ``start()`` checks whether a
        runtime already exists and then spawns one, with no lock between the
        check and the spawn: concurrent callers each pass the check and each
        launch a runtime. The process that loses the assignment keeps running
        as an orphan, and the reader thread ends up watching a pipe whose
        writer is gone — the run then never receives its events.

        The lock makes the whole start one step. It is held across the spawn
        on purpose: the expensive part happens once, and a caller that arrives
        later simply waits for that one start instead of beginning its own.
        """
        config = self._config_for(route)
        key = _route_key(config)
        now = time.monotonic()
        with self._start_lock:
            usage = self._harnesses.get(key)
            if usage is None:
                self._retire_route_for_capacity_locked(now)
                usage = _RuntimeUsage(
                    route=key,
                    harness=self._factory(config),
                    started_at=now,
                    last_used_at=now,
                )
                self._harnesses[key] = usage
            usage.last_used_at = now
            usage.harness.start()
            return usage.harness

    def _retire_route_for_capacity_locked(self, now: float) -> None:
        """Free a runtime slot before a new route starts.

        Retiring a runtime that a run is still using would end that run, so the
        oldest idle route goes first. When every route is busy the new route is
        still created — refusing work because a sibling route is busy would turn
        a resource ceiling into an outage — but the count above the ceiling is
        recorded so it is visible in ``runtime_states()``.
        """
        if len(self._harnesses) < self._max_runtimes:
            return
        idle = [
            (usage.last_used_at, key)
            for key, usage in self._harnesses.items()
            if not self._route_is_busy(key)
        ]
        if not idle:
            return
        _last_used, key = min(idle)
        usage = self._harnesses.pop(key)
        self._close_runtime(usage)

    def _route_is_busy(self, key: tuple[str, ...]) -> bool:
        """Whether any run this service accepted is still assigned to the route."""
        with self._lock:
            return any(
                not run.done.is_set() and run.route == key
                for run in self._runs.values()
            )

    def _close_runtime(self, usage: _RuntimeUsage) -> None:
        """Stop one route's runtime, naming the process if closing fails.

        Only the handle this service saved is touched: a broad process match
        could stop another route's runtime or an unrelated process.
        """
        close = getattr(usage.harness, "close", None)
        if close is None:
            return
        try:
            close()
        except Exception as error:  # noqa: BLE001 - one route must not block the rest
            print(
                f"dsh-service: closing runtime for route {usage.route[:2]} failed: {error}",
                flush=True,
            )

    def retire_idle_runtimes(self, now: float | None = None) -> list[tuple[str, ...]]:
        """Retire routes whose runtime has served nothing for the idle window.

        A runtime waiting for its next run is idle, not stuck: this decides only
        whether the process is worth keeping, and it never touches a route an
        accepted run is still assigned to.
        """
        if self._idle_runtime_seconds <= 0:
            return []
        moment = time.monotonic() if now is None else now
        retired: list[tuple[str, ...]] = []
        with self._start_lock:
            for key, usage in list(self._harnesses.items()):
                if moment - usage.last_used_at < self._idle_runtime_seconds:
                    continue
                if self._route_is_busy(key):
                    continue
                self._harnesses.pop(key)
                self._close_runtime(usage)
                retired.append(key)
        return retired

    def runtime_states(self) -> list[dict[str, Any]]:
        """Report each route's runtime process and whether it is in use.

        Matches the shape a health check needs: an idle runtime is a normal
        process, a route with no live pid is one that failed to stay up, and a
        count above the ceiling says the deployment is holding more runtimes
        than ``DSH_MAX_RUNTIMES`` allows.
        """
        with self._start_lock:
            usages = list(self._harnesses.values())
        states: list[dict[str, Any]] = []
        for usage in usages:
            pid = getattr(usage.harness, "pid", None)
            states.append(
                {
                    "route": {"provider": usage.route[0], "model": usage.route[1]},
                    "pid": pid,
                    "alive": isinstance(pid, int),
                    "busy": self._route_is_busy(usage.route),
                    "uptime_seconds": round(time.monotonic() - usage.started_at, 3),
                    "idle_seconds": round(time.monotonic() - usage.last_used_at, 3),
                }
            )
        return states

    def _config_for(self, route: dict[str, str]) -> DeepSeekHarnessConfig:
        """The deployment's configuration with the run's own route applied."""
        if not route:
            return self._config
        return replace(
            self._config,
            **{
                "model": route.get("model", self._config.model),
                "base_url": route.get("base_url", self._config.base_url),
                "api_key": route.get("api_key", self._config.api_key),
                "env": {**self._config.env, **_route_env(route)},
            },
        )

    def close(self) -> None:
        """Stop every harness this service started.

        One service can now hold a harness per model route, each owning its own
        runtime subprocess. Leaving them to process exit leaks a runtime per
        route for as long as the service lives, so shutdown closes them all.
        """
        with self._start_lock:
            usages, self._harnesses = list(self._harnesses.values()), {}
        for usage in usages:
            self._close_runtime(usage)
        with self._lock:
            runs = list(self._runs.values())
        for run in runs:
            if run.worker is not None and run.worker is not threading.current_thread():
                run.worker.join(timeout=self._result_timeout + 1)
        self._shutdown.set()
        for run in runs:
            with run.delivery_condition:
                run.delivery_condition.notify_all()
        for run in runs:
            for sender in (run.event_sender, run.result_sender):
                if sender is not None and sender is not threading.current_thread():
                    sender.join(
                        timeout=max(self._event_timeout, self._result_timeout) + 1
                    )

    def start_run(self, task: dict[str, Any]) -> str:
        """Accept an immutable request identity and execute it once in its own Session."""
        instruction = task.get("instruction")
        if not isinstance(instruction, str) or not instruction:
            raise ValueError("task.instruction must be a nonempty string")
        requested_session = task.get("session_id")
        if requested_session is not None and (
            not isinstance(requested_session, str) or not requested_session
        ):
            raise ValueError("task.session_id must be a nonempty string")
        request_id = task.get("request_id", "")
        if not isinstance(request_id, str) or (
            request_id and (not request_id.strip() or len(request_id) > 256)
        ):
            raise ValueError(
                "task.request_id must be a nonempty string of at most 256 characters"
            )
        cwd = task.get("cwd", "")
        if not isinstance(cwd, str) or (cwd and not cwd.startswith("/")):
            raise ValueError("task.cwd must be an absolute task path")
        agent_preset = task.get("agent_preset", "")
        if not isinstance(agent_preset, str):
            raise ValueError("task.agent_preset must be a string")
        metadata = task.get("metadata") or {}
        if not isinstance(metadata, dict):
            raise ValueError("task.metadata must be an object")
        digest = hashlib.sha256(
            json.dumps(task, sort_keys=True, allow_nan=False).encode()
        ).hexdigest()
        route = _route_from_task(task)
        callback_url = _callback_url_from_task(task)
        event_url = _event_url_from_task(task)
        for callback, url in (
            (self._result_callback, callback_url),
            (self._event_callback, event_url),
        ):
            if url and isinstance(callback, _HttpSink):
                callback.validate_target(url)
        run_id = uuid.uuid4().hex
        run = _Run(
            run_id=run_id,
            task_id=str(task.get("task_id") or ""),
            instruction=instruction,
            session_id=requested_session or f"session-{run_id}",
            route=_route_key(self._config_for(route)),
            callback_url=callback_url,
            request_id=request_id,
            request_digest=digest,
            cwd=cwd,
            agent_preset=agent_preset,
            evaluation_id=str(task.get("evaluation_id") or ""),
            event_url=event_url,
            case_id=str(task.get("case_id") or task.get("task_id") or ""),
            run_user=str(task.get("run_user") or ""),
            model=self._config_for(route).model,
            benchmark=str(task.get("benchmark") or ""),
            dataset_version=str(task.get("dataset_version") or ""),
            dataset_sha256=str(task.get("dataset_sha256") or ""),
            question_type=str(metadata.get("category") or "unknown"),
        )
        with self._lock:
            previous = self._requests.get(request_id) if request_id else None
            if previous is not None:
                if self._runs[previous].request_digest != digest:
                    raise _RequestConflict(
                        "request_id was already accepted with different task content"
                    )
                return previous
            self._persist_run(run)
            self._runs[run_id] = run
            if request_id:
                self._requests[request_id] = run_id

        def execute() -> None:
            status = "cancelled"
            completed = None
            error_message = None
            try:
                if run.cancel_requested:
                    return
                self._record_progress(run, "starting")
                harness = self._ensure_started(route)
                if run.cancel_requested:
                    return
                run.view_source = harness
                deliver = {
                    "session_id": run.session_id,
                    "before_deliver": _refuse_when_cancelled(run),
                }
                if run.cwd:
                    deliver["cwd"] = run.cwd
                if run.agent_preset:
                    deliver["agent_preset"] = run.agent_preset
                if self._event_callback is not None and run.event_url:
                    deliver["on_notification"] = (
                        lambda notification: self._report_event(run, notification)
                    )
                self._record_progress(run, "executing")
                result = harness.run(instruction, **deliver)
                completed = {
                    "final_response": result.final_response,
                    "finish_reason": result.finish_reason,
                    "session_id": result.session_id,
                    "events": result.events,
                    "notifications": [
                        {"method": n.method, "payload": n.payload}
                        for n in result.notifications
                    ],
                }
                status = "succeeded"
            except _RunCancelled:
                status = "cancelled"
            except Exception as error:
                status = "failed"
                error_message = f"{type(error).__name__}: {error}"
            finally:
                if completed is not None and status == "succeeded":
                    status, error_message = _status_for_finish(
                        result.finish_reason,
                        result.events,
                        self._max_tokens_as_success,
                    )
                run.worker_done.set()
                self._finish_run(run, status, completed, error_message)

        run.worker = threading.Thread(target=execute, name=f"run-{run_id}", daemon=True)
        run.worker.start()
        return run_id

    def _finish_run(
        self,
        run: _Run,
        status: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        with self._lock:
            if run.done.is_set() or run.cancel_state == "cancelling":
                return
            if run.cancel_state == "cancelled":
                status = "cancelled"
            elif run.cancel_state == "cancel-failed":
                status = "failed"
            # A finished turn's result is kept whatever its outcome: a failed
            # turn still carries the events and notifications that explain it,
            # and the callback must not be left with only an error string.
            if status in ("succeeded", "failed") and result is not None:
                run.result = result
            if status == "cancelled":
                run.cancel_state = "cancelled"
            run.error = run.error or (error if status == "failed" else None)
            run.terminal_status = status
            run.done.set()
            self._save_delivery(run)
        self._report_run_end(run, status)
        self._report_result(run, status)

    def _save_delivery(self, run: _Run) -> None:
        try:
            self._persist_run(run)
        except OSError as error:
            run.delivery_error = f"report storage failed: {type(error).__name__}"

    def _record_progress(
        self, run: _Run, stage: str, *, seq: int | None = None
    ) -> None:
        """Note that a run moved, and where it now is.

        This is the only evidence that distinguishes a run making slow progress
        from one that stopped: callers see `running` in both cases, and an idle
        runtime is not evidence either way.
        """
        with self._lock:
            if run.done.is_set():
                return
            run.stage = stage
            run.last_progress_stage = stage
            run.last_progress_at = time.monotonic()
            if seq is not None:
                run.last_event_seq = seq
            elif run.last_event_seq is None:
                run.last_event_seq = None

    def run_progress(
        self, run_id: str, *, now: float | None = None
    ) -> dict[str, Any] | None:
        """Report how far one run has got and whether it stopped moving.

        ``stuck_after_seconds`` is the deployment's ceiling on stillness for the
        stage the run is in; ``stuck`` is only ever true for a run that has not
        finished. An idle runtime never appears here, because this asks about a
        run, not about a process.
        """
        moment = time.monotonic() if now is None else now
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                return None
            finished = run.done.is_set()
            stage = run.stage
            report = {
                "run_id": run.run_id,
                "stage": stage,
                "accepted_seconds": round(moment - run.accepted_at, 3),
                "last_progress_seconds": round(moment - run.last_progress_at, 3),
                "last_progress_stage": run.last_progress_stage,
                "last_event_seq": run.last_event_seq,
                "finished": finished,
            }
        limit = self._stuck_after_seconds(stage)
        if finished:
            report["stuck_after_seconds"] = None
            report["stuck"] = False
        else:
            report["stuck_after_seconds"] = limit
            report["stuck"] = (
                limit is not None and report["last_progress_seconds"] >= limit
            )
        return report

    def _stuck_after_seconds(self, stage: str) -> float | None:
        """How long a run may stay in ``stage`` before it is reported stuck.

        A run waiting for its runtime to start gets the start budget; one that is
        executing gets the agent's own deadline. Both come from the deployment,
        so a slow model call is not mistaken for a frozen service.
        """
        if stage == "accepted":
            return self._run_stuck_after_seconds
        if stage == "starting":
            return self._run_stuck_after_seconds
        if stage == "executing":
            return self._run_executing_stuck_after_seconds
        return None

    def _report_event(self, run: _Run, notification: Any) -> None:
        """Queue the unchanged source event; network I/O belongs to its sender."""
        if self._event_callback is None or not run.event_url:
            return
        payload = (
            notification.payload
            if isinstance(getattr(notification, "payload", None), dict)
            else {}
        )
        if getattr(notification, "method", "") == "subagent.started":
            parent = payload.get("parentSessionId")
            child = payload.get("childSessionId")
            if (
                isinstance(parent, str)
                and parent
                and isinstance(child, str)
                and child
                and parent != child
            ):
                run.session_parents[child] = parent
        event = payload.get("event")
        if not isinstance(event, dict):
            return
        seq = event.get("seq")
        if type(seq) is not int:
            run.delivery_error = "source event has no integer sequence"
            return
        self._record_progress(run, "executing", seq=seq)
        body = {
            "protocol_version": "2.0",
            "evaluation_id": run.evaluation_id or run.request_id or run.run_id,
            "case_id": run.case_id,
            "model": run.model,
            "harness": "APUS",
            "benchmark": run.benchmark,
            "dataset_version": run.dataset_version,
            "dataset_sha256": run.dataset_sha256,
            "question_type": run.question_type,
            "source_session_id": str(payload.get("sessionId") or run.session_id),
            "root_session_id": run.session_id,
            "seq": seq,
            "first_seq": 1,
            "final": False,
            "question": run.instruction,
            "run_user": run.run_user,
            "event": event,
        }
        parent = payload.get("parentSessionId") or run.session_parents.get(
            body["source_session_id"]
        )
        if parent:
            body["parent_session_id"] = parent
        self._deliver(run, body)

    def _deliver(self, run: _Run, body: dict[str, Any]) -> None:
        with run.delivery_condition:
            run.reported += 1
            body["delivery_seq"] = run.reported
            run.undelivered.append(body)
            run.reports_closed = run.reports_closed or bool(body["final"])
            if run.event_delivery != "failed":
                run.event_delivery = "pending"
            self._save_delivery(run)
            if run.event_sender is None:
                run.event_sender = threading.Thread(
                    target=self._send_events,
                    args=(run,),
                    name=f"events-{run.run_id}",
                    daemon=True,
                )
                run.event_sender.start()
            run.delivery_condition.notify_all()

    def _send_events(self, run: _Run) -> None:
        recovery_attempts = 0
        try:
            while not self._shutdown.is_set():
                with run.delivery_condition:
                    run.delivery_condition.wait_for(
                        lambda: bool(run.undelivered)
                        or run.reports_closed
                        or self._shutdown.is_set()
                    )
                    if self._shutdown.is_set():
                        return
                    if not run.undelivered:
                        run.event_delivery = "delivered"
                        return
                    report = run.undelivered[0]
                self._attach_request_view(run, report)
                sent = self._send_report(
                    self._event_callback,
                    run.event_url,
                    report,
                    self._event_timeout,
                    run,
                )
                with run.delivery_condition:
                    if sent:
                        run.undelivered.pop(0)
                        run.event_delivery = (
                            "pending" if run.undelivered else "delivered"
                        )
                        recovery_attempts = 0
                        self._save_delivery(run)
                        continue
                    run.event_delivery = "failed"
                    self._save_delivery(run)
                    if recovery_attempts >= self._delivery_recovery_attempts:
                        return
                    recovery_attempts += 1
                    run.delivery_condition.wait(timeout=self._delivery_failure_delay)
        finally:
            with run.delivery_condition:
                if run.event_sender is threading.current_thread():
                    run.event_sender = None

    def _attach_request_view(self, run: _Run, body: dict[str, Any]) -> None:
        """Put the runtime's own request view on a dispatch report, or name the gap.

        Runs on the event sender thread, the only place an RPC to the runtime
        may run. The decision is recorded per dispatch and reused by later
        sends of the same report: a retry must repeat what the first attempt
        carried instead of turning a missing view into a different body.
        """
        dispatch = _dispatch_reference(body)
        if dispatch is None:
            return
        key = (body["source_session_id"], dispatch)
        # 第一段在锁内只读决策并写回已持久化的 body 视图；RPC 必须放到锁外，
        # 否则持久化线程的 sorted(request_views.items()) 会与写方并发。
        with run.delivery_condition:
            recorded = key in run.request_views
            view = run.request_views[key] if recorded else None
            if not recorded:
                persisted = body.get("request_view")
                if isinstance(persisted, dict):
                    # A report recovered from the outbox already carries the view
                    # its first attempt had; repeat it rather than fetch again.
                    run.request_views[key] = persisted
                    return
        rpc_error: str | None = None
        if not recorded:
            source = run.view_source
            try:
                view = (
                    source.request_view(key[0], dispatch)
                    if source is not None
                    else None
                )
            except Exception as error:  # noqa: BLE001 - the source event survives without a view
                rpc_error = (
                    f"request_view unavailable for dispatch {dispatch} of "
                    f"{key[0]}: {type(error).__name__}: {error}"
                )
        # 第二段重新持锁落盘；迭代方看到的是完整决策，不会在迭代中途变长。
        with run.delivery_condition:
            if not recorded:
                if key in run.request_views:
                    view = run.request_views[key]
                else:
                    run.request_views[key] = view
                if rpc_error is not None:
                    run.delivery_error = rpc_error
            if view is not None:
                body["request_view"] = view
            elif run.delivery_error is None:
                run.delivery_error = (
                    f"request_view unavailable for dispatch {dispatch} of {key[0]}"
                )
            self._save_delivery(run)

    def _send_report(
        self,
        callback: Any,
        url: str,
        body: dict[str, Any],
        timeout: float,
        run: _Run,
    ) -> bool:
        for attempt in range(self._delivery_attempts):
            if self._shutdown.is_set():
                return False
            try:
                callback.post(url, body, timeout=timeout)
                return True
            except Exception as error:  # noqa: BLE001 - delivery never re-executes the run
                run.delivery_error = type(error).__name__
                if attempt + 1 < self._delivery_attempts:
                    self._shutdown.wait(self._retry_delay * (2**attempt))
        return False

    def _report_run_end(self, run: _Run, status: str) -> None:
        """Queue one final service report after the run's original source events."""
        callback = self._event_callback
        if callback is None or not run.event_url:
            return
        with run.delivery_condition:
            if run.reports_closed:
                return
        result = run.result or {}
        body = {
            "protocol_version": "2.0",
            "evaluation_id": run.evaluation_id or run.request_id or run.run_id,
            "case_id": run.case_id,
            "model": run.model,
            "harness": "APUS",
            "benchmark": run.benchmark,
            "dataset_version": run.dataset_version,
            "dataset_sha256": run.dataset_sha256,
            "question_type": run.question_type,
            "source_session_id": f"{run.session_id}:service",
            "root_session_id": run.session_id,
            "seq": 1,
            "first_seq": 1,
            "final": True,
            "question": run.instruction,
            "run_user": run.run_user,
            "event": {
                "type": "run/end",
                "seq": 1,
                "time": int(time.time() * 1000),
                "data": {
                    "status": status,
                    "finish_reason": result.get("finish_reason"),
                    "final_response": result.get("final_response"),
                    "error": run.error,
                },
            },
        }
        self._deliver(run, body)

    @staticmethod
    def _callback_result(result: dict[str, Any] | None) -> dict[str, Any] | None:
        """Keep history on the event channel and in run queries, not in result callbacks."""
        if result is None:
            return None
        return {
            key: value
            for key, value in result.items()
            if key not in {"events", "notifications"}
        }

    def _report_result(self, run: _Run, status: str) -> None:
        """Queue the immutable business outcome independently of trace delivery."""
        callback = self._result_callback
        url = run.callback_url
        if callback is None or not url:
            return
        payload = {
            "protocol_version": "2.0",
            "run_id": run.run_id,
            "request_id": run.request_id,
            "evaluation_id": run.evaluation_id,
            "case_id": run.case_id,
            "model": run.model,
            "status": status,
            "session_id": run.session_id,
            "task_id": run.task_id,
            "result": self._callback_result(run.result),
            "error": run.error,
        }
        with run.delivery_condition:
            if run.result_report is not None:
                return
            run.result_report = payload
            run.result_delivery = "pending"
            self._save_delivery(run)
            run.result_sender = threading.Thread(
                target=self._send_result,
                args=(run,),
                name=f"result-{run.run_id}",
                daemon=True,
            )
            run.result_sender.start()

    def _send_result(self, run: _Run) -> None:
        assert run.result_report is not None
        recovery_attempts = 0
        try:
            while not self._shutdown.is_set():
                sent = self._send_report(
                    self._result_callback,
                    run.callback_url,
                    run.result_report,
                    self._result_timeout,
                    run,
                )
                with run.delivery_condition:
                    run.result_delivery = "delivered" if sent else "failed"
                    self._save_delivery(run)
                    if sent:
                        return
                    if recovery_attempts >= self._delivery_recovery_attempts:
                        return
                    recovery_attempts += 1
                    run.delivery_condition.wait(timeout=self._delivery_failure_delay)
        finally:
            with run.delivery_condition:
                if run.result_sender is threading.current_thread():
                    run.result_sender = None

    def readiness(self) -> tuple[bool, dict[str, Any]]:
        """Report whether this service could complete a run, not only answer HTTP.

        Each condition is something that has actually stopped runs in this
        deployment: no credential means every request is refused, no run store
        means outcomes are not durable, and a route whose process died means the
        next run on it fails at the first message. Stuck runs are reported but do
        not make the service unready — other routes can still serve work.
        """
        problems: list[str] = []
        if not self._api_token:
            problems.append("service authentication is not configured")
        if self._run_store is None:
            problems.append("no run store: outcomes would not survive a restart")
        if self._shutdown.is_set():
            problems.append("service is shutting down")
        runtimes = self.runtime_states()
        dead = [state for state in runtimes if not state["alive"] and state["busy"]]
        if dead:
            problems.append(
                f"{len(dead)} route(s) have a run assigned but no live runtime process"
            )
        stuck: list[str] = []
        with self._lock:
            unfinished = [
                run.run_id for run in self._runs.values() if not run.done.is_set()
            ]
        for run_id in unfinished:
            progress = self.run_progress(run_id)
            if progress is not None and progress.get("stuck"):
                stuck.append(run_id)
        report = {
            "status": "ready" if not problems else "not-ready",
            "protocol_version": "2.0",
            "problems": problems,
            "runtimes": runtimes,
            "runs": {"unfinished": len(unfinished), "stuck": stuck},
        }
        return not problems, report

    def run_state(self, run_id: str) -> dict[str, Any] | None:
        with self._lock:
            run = self._runs.get(run_id)
        if run is None:
            return None
        # Reported before the done flag on purpose: a cancellation still waiting
        # for the harness to settle must not read as cancelled.
        if run.cancel_state == "cancelling":
            state = {"run_id": run.run_id, "status": "cancelling"}
        elif run.cancel_state == "cancel-failed" and not run.done.is_set():
            state = {
                "run_id": run.run_id,
                "status": "failed",
                "error": run.error,
                "execution_state": "running",
                "cancellation_state": "failed",
            }
        elif not run.done.is_set():
            state = {"run_id": run.run_id, "status": "running"}
        elif run.cancel_state == "cancelled":
            state = {"run_id": run.run_id, "status": "cancelled"}
        elif run.error is not None:
            state = {
                "run_id": run.run_id,
                "status": "failed",
                "error": run.error,
                **(run.result or {}),
            }
        else:
            state = {"run_id": run.run_id, "status": "completed", **(run.result or {})}
        if run.event_url or run.callback_url:
            with run.delivery_condition:
                state["delivery_state"] = {
                    "events": run.event_delivery,
                    "result": run.result_delivery,
                    "pending_events": len(run.undelivered),
                    "error": run.delivery_error,
                }
        # `running` alone cannot distinguish a slow model call from a run that
        # stopped moving; the progress record is what answers that question.
        progress = self.run_progress(run_id)
        if progress is not None:
            state["progress"] = progress
        return state

    def cancel(self, run_id: str) -> bool:
        """Cancel one run's session and wait until the harness confirms it stopped.

        Only that run's session is stopped: the shared harness and every other
        run's session keep running. The run is published as ``cancelled`` only
        after the harness confirmed the session settled. A run that already
        finished keeps its recorded outcome. When the harness refuses or fails
        the cancellation, the run is published as ``failed`` with that error
        and the failure is raised, so no caller reads a false success.

        Raises:
            RuntimeError: The harness could not confirm the cancellation.
        """
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                return False
            if run.done.is_set():
                return True
            owner = run.cancel_state != "cancelling"
            if owner:
                run.cancel_state = "cancelling"
                run.cancellation_done.clear()
        wait = self._cancel_wait or (
            self._result_timeout + (self._config.request_timeout_seconds or 30)
        )
        if not owner:
            if not run.cancellation_done.wait(timeout=wait):
                raise RuntimeError("cancellation is still awaiting confirmation")
            if run.cancel_state == "cancel-failed":
                raise RuntimeError(run.error or "cancellation failed")
            return True
        try:
            with self._start_lock:
                usage = self._harnesses.get(run.route)
            if usage is not None:
                usage.harness.cancel_session(run.session_id)
            if not run.worker_done.wait(timeout=wait):
                raise RuntimeError("the run worker has not stopped after cancellation")
        except Exception as error:
            with self._lock:
                run.cancel_state = "cancel-failed"
                run.error = f"cancellation failed: {type(error).__name__}: {error}"
                self._save_delivery(run)
            if run.worker_done.is_set():
                self._finish_run(run, "failed")
            raise RuntimeError(run.error) from error
        else:
            with self._lock:
                run.cancel_state = "cancelled"
            self._finish_run(run, "cancelled")
            return True
        finally:
            run.cancellation_done.set()


def config_from_environment() -> DeepSeekHarnessConfig:
    """Read the harness configuration this deployment launched with.

    The values are required: a service that starts without a model route would
    accept work and fail every task, which is harder to diagnose than refusing
    to start.
    """

    def required(name: str) -> str:
        value = os.environ.get(name, "").strip()
        if not value:
            raise RuntimeError(f"dsh service requires {name} in the environment")
        return value

    def optional(name: str) -> str | None:
        value = os.environ.get(name, "").strip()
        return value or None

    raw_patches = os.environ.get("DSH_PATCHES", "")
    patches = tuple(p.strip() for p in raw_patches.split(":") if p.strip())
    request_budget = float(os.environ.get("DSH_REQUEST_TIMEOUT_SECONDS", "30"))
    if not math.isfinite(request_budget) or request_budget <= 0:
        raise ValueError("DSH_REQUEST_TIMEOUT_SECONDS must be finite and positive")
    return DeepSeekHarnessConfig(
        provider=required("LLM_PROVIDER"),
        model=required("LLM_MODEL"),
        dsh_bin=optional("DSH_BIN"),
        profile=optional("DSH_PROFILE") or "sdk",
        patches=patches,
        dsh_home=optional("DSH_HOME"),
        base_url=required("LLM_BASE_URL"),
        api_key=required("LLM_API_KEY"),
        initialize_timeout_seconds=float(
            os.environ.get("DSH_INITIALIZE_TIMEOUT", "300")
        ),
        request_timeout_seconds=request_budget,
    )


def _handler(service: HarnessService) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self) -> None:
            super().setup()
            self.connection.settimeout(30)

        def _authorized(self) -> bool:
            token = service._api_token
            if not token:
                self.close_connection = True
                self._reply(
                    503,
                    {"error": {"message": "service authentication is not configured"}},
                )
                return False
            if not hmac.compare_digest(
                self.headers.get("Authorization", ""), f"Bearer {token}"
            ):
                self.close_connection = True
                self._reply(
                    401, {"error": {"message": "Bearer authentication required"}}
                )
                return False
            return True

        def log_message(self, format: str, *args: Any) -> None:
            print(f"dsh-service: {format % args}", flush=True)

        def _reply(self, status: int, body: dict[str, Any]) -> None:
            payload = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _body(self) -> dict[str, Any]:
            if self.headers.get("Transfer-Encoding"):
                raise ValueError("Transfer-Encoding is not supported")
            length = int(self.headers.get("content-length") or 0)
            if not 0 < length <= 1_048_576:
                raise ValueError("request body must contain 1 to 1048576 bytes")
            parsed = json.loads(self.rfile.read(length))
            if not isinstance(parsed, dict):
                raise ValueError("request body must be a JSON object")
            return parsed

        def do_GET(self) -> None:  # noqa: N802 - name fixed by BaseHTTPRequestHandler
            if self.path == "/healthz":
                # Liveness only: this process is answering. It says nothing about
                # whether a run could complete, which is what /readyz reports.
                self._reply(200, {"status": "ok", "protocol_version": "2.0"})
                return
            if self.path == "/readyz":
                ready, report = service.readiness()
                self._reply(200 if ready else 503, report)
                return
            if not self._authorized():
                return
            if self.path.startswith("/v1/runs/"):
                run_id = self.path.rsplit("/", 1)[-1]
                state = service.run_state(run_id)
                if state is None:
                    self._reply(404, {"error": {"message": "run not found"}})
                    return
                self._reply(200, state)
                return
            self._reply(404, {"error": {"message": f"no route for {self.path}"}})

        def do_POST(self) -> None:  # noqa: N802 - name fixed by BaseHTTPRequestHandler
            if not self._authorized():
                return
            try:
                if self.path == "/v1/runs":
                    body = self._body()
                    if body.get("protocol_version") != "2.0":
                        raise ValueError("protocol_version must be 2.0")
                    task = body.get("task")
                    if not isinstance(task, dict):
                        raise ValueError("missing task object")
                    if (
                        not isinstance(task.get("request_id"), str)
                        or not task["request_id"].strip()
                    ):
                        raise ValueError("task.request_id is required")
                    run_id = service.start_run(task)
                    self._reply(
                        202,
                        {
                            "protocol_version": "2.0",
                            "status": "accepted",
                            "run_id": run_id,
                            "request_id": task["request_id"],
                        },
                    )
                    return
                if self.path.startswith("/v1/runs/") and self.path.endswith("/cancel"):
                    run_id = self.path.split("/")[3]
                    if not service.cancel(run_id):
                        self._reply(404, {"error": {"message": "run not found"}})
                        return
                    state = service.run_state(run_id)
                    self._reply(200, {"run_id": run_id, "status": state["status"]})
                    return
                self._reply(404, {"error": {"message": f"no route for {self.path}"}})
            except _RequestConflict as error:
                self.close_connection = True
                self._reply(409, {"error": {"message": str(error)}})
            except (ValueError, UnicodeDecodeError) as error:
                self.close_connection = True
                self._reply(400, {"error": {"message": str(error)}})
            except RuntimeError as error:
                # A cancellation the harness could not confirm is a failed
                # request, never a success response.
                self._reply(500, {"error": {"message": str(error)}})

    return Handler


class _HttpSink:
    """Send authenticated reports only to deployment-approved targets."""

    def __init__(self, kind: str = "event") -> None:
        if kind not in {"event", "result"}:
            raise ValueError("report kind must be event or result")
        self.kind = kind
        raw = os.environ.get(
            "DSH_EVENT_CALLBACK_URLS"
            if kind == "event"
            else "DSH_RESULT_CALLBACK_BASES",
            "",
        )
        if kind == "result" and not raw:
            raw = os.environ.get("PIPELINE_EXEC_ENDPOINT", "")
        self._allowed = tuple(
            item.strip().rstrip("/") for item in raw.split(",") if item.strip()
        )
        self._token = os.environ.get(
            "AUTOEVAL_CALLBACK_TOKEN" if kind == "event" else "PIPELINE_API_TOKEN",
            "",
        ).strip()

    @staticmethod
    def _url(url: str) -> Any:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("callback target must be an http(s) URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError(
                "callback target must not carry credentials, a query or a fragment"
            )
        _ = parsed.port
        return parsed

    def validate_target(self, url: str) -> None:
        target = self._url(url)

        def origin(part: SplitResult) -> tuple[str, str | None, int]:
            port = part.port or (443 if part.scheme == "https" else 80)
            return (part.scheme, part.hostname, port)

        for allowed in self._allowed:
            base = self._url(allowed)
            if origin(target) != origin(base):
                continue
            if self.kind == "event" and target.path.rstrip("/") == base.path.rstrip(
                "/"
            ):
                return
            relative = target.path.removeprefix(base.path.rstrip("/"))
            if self.kind == "result" and (
                target.path.startswith(base.path.rstrip("/") + "/")
                and relative.startswith("/jobs/")
                and relative.endswith("/backend-result")
                and len(relative.split("/")) == 4
                and relative.split("/")[2] not in {"", ".", ".."}
            ):
                return
        raise ValueError(
            f"{self.kind} callback target is not approved by the deployment"
        )

    def post(self, url: str, payload: dict[str, Any], timeout: float) -> None:
        import urllib.error
        import urllib.request

        self.validate_target(url)

        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(
                self, request, response, code, message, headers, new_url
            ):
                return None

        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        request = urllib.request.Request(url, data=body, method="POST", headers=headers)
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), _NoRedirect()
        )
        try:
            with opener.open(request, timeout=timeout) as response:
                if len(response.read(65_537)) > 65_536:
                    raise RuntimeError(
                        "callback response exceeds the acknowledgment limit"
                    )
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"callback answered HTTP {error.code}") from error


def http_sink(kind: str = "event") -> _HttpSink:
    """Create a report sender from the deployment's target and credential settings."""
    return _HttpSink(kind)


def serve(host: str, port: int) -> None:
    """Run the harness service until the process is stopped."""
    if not os.environ.get("DSH_SERVICE_TOKEN", "").strip():
        raise RuntimeError("dsh service requires DSH_SERVICE_TOKEN in the environment")
    service = HarnessService(
        config_from_environment(),
        result_callback=http_sink("result"),
        event_callback=http_sink("event"),
    )
    server = ThreadingHTTPServer((host, port), _handler(service))
    print(f"dsh-service: listening on {host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        service.close()


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    serve(args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
