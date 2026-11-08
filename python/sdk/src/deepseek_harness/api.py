from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .client import HarnessClient, HarnessConfig
from .errors import SdkProtocolError
from .models import JsonObject, Notification


@dataclass(slots=True)
class DeepSeekHarnessConfig:
    """Configuration for launching the local APUS Reflex Harness SDK runtime.

    The runtime inherits the caller's environment by default, so existing
    DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL settings keep working. Use ``env`` to
    intentionally override or inject variables for a subprocess.
    """

    provider: str = "deepseek-official"
    model: str = "deepseek-v4-flash"
    reasoning_effort: str | None = None
    max_tokens: int | None = None
    cwd: str | None = None
    runtime_cwd: str | None = None
    dsh_bin: str | None = None
    profile: str = "sdk"
    patches: tuple[str, ...] = ()
    dsh_home: str | None = None
    env: dict[str, str] = field(default_factory=dict)
    initialize_timeout_seconds: float = 30.0
    request_timeout_seconds: float | None = None
    shutdown_timeout_seconds: float | None = 1.0
    base_url: str | None = None
    api_key: str | None = None


@dataclass(slots=True)
class RunResult:
    session_id: str
    final_response: str
    finish_reason: str | None
    events: list[JsonObject]
    notifications: list[Notification]


class DeepSeekHarness:
    """Reusable synchronous SDK for running APUS Reflex Harness agent turns.

    The runtime subprocess starts lazily and remains owned by this instance
    across calls to :meth:`run`. Use the instance as a context manager, or call
    :meth:`close` explicitly when finished, so the subprocess is always reaped.
    """

    def __init__(
        self,
        config: DeepSeekHarnessConfig | None = None,
        *,
        _launch_args: tuple[str, ...] | None = None,
        **kwargs: object,
    ) -> None:
        if config is not None and kwargs:
            raise TypeError(
                "pass either DeepSeekHarnessConfig or keyword options, not both"
            )
        self.config = config or DeepSeekHarnessConfig(**kwargs)
        cwd = str(Path(self.config.cwd or Path.cwd()).resolve())
        runtime_cwd = (
            str(Path(self.config.runtime_cwd).resolve())
            if self.config.runtime_cwd is not None
            else cwd
        )
        self._cwd = cwd
        env = dict(self.config.env)
        if self.config.base_url is not None:
            env["DEEPSEEK_BASE_URL"] = self.config.base_url
        if self.config.api_key is not None:
            env["DEEPSEEK_API_KEY"] = self.config.api_key

        self._client = HarnessClient(
            HarnessConfig(
                dsh_bin=self.config.dsh_bin,
                profile=self.config.profile,
                patches=self.config.patches,
                dsh_home=self.config.dsh_home,
                cwd=runtime_cwd,
                env=env,
                initialize_timeout_seconds=self.config.initialize_timeout_seconds,
                request_timeout_seconds=self.config.request_timeout_seconds,
                shutdown_timeout_seconds=self.config.shutdown_timeout_seconds,
            ),
            _launch_args=_launch_args,
        )
        self._initialized = False
        self._sessions: dict[str, Session] = {}
        self._session_lock = threading.Lock()

    def __enter__(self) -> "DeepSeekHarness":
        self.start()
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    @property
    def client(self) -> HarnessClient:
        return self._client

    def start(self) -> None:
        if self._initialized:
            return
        self._client.start()
        self._client.initialize(
            cwd=self._cwd,
            provider=self.config.provider,
            model=self.config.model,
            reasoning_effort=self.config.reasoning_effort,
            max_tokens=self.config.max_tokens,
        )
        self._initialized = True

    def close(self) -> None:
        self._client.close()
        self._initialized = False
        self._sessions.clear()

    def start_session(
        self, session_id: str | None = None, *, cwd: str | None = None,
        agent_preset: str | None = None,
    ) -> "Session":
        if cwd is not None and (
            not isinstance(cwd, str) or not cwd or not Path(cwd).is_absolute()
        ):
            raise ValueError("session cwd must be an absolute path")
        if agent_preset is not None and (
            not isinstance(agent_preset, str) or not agent_preset.strip()
        ):
            raise ValueError("session agent_preset must be a nonempty string")
        self.start()
        identity = session_id or f"session-{uuid.uuid4().hex}"
        with self._session_lock:
            existing = self._sessions.get(identity)
            if existing is not None:
                if cwd is not None and cwd != existing.cwd:
                    raise ValueError(f"session {identity!r} already uses cwd {existing.cwd!r}")
                if agent_preset is not None and agent_preset != existing.agent_preset:
                    raise ValueError(f"session {identity!r} already uses preset {existing.agent_preset!r}")
                return existing
            session = Session(self, identity, cwd=cwd or self._cwd, agent_preset=agent_preset)
            self._sessions[identity] = session
            return session

    @property
    def capabilities(self) -> list[str]:
        """Return the capability tokens the runtime advertised during the handshake."""
        return self._client.capabilities

    def dispatches(self, session_id: str) -> JsonObject:
        """List one session's recorded model dispatches.

        The runtime owns the dispatch records; this SDK transports them
        verbatim.

        Raises:
            ValueError: ``session_id`` is empty.
            JsonRpcError: The runtime refused the request.
            SdkProtocolError: The runtime answered without a dispatch list.
        """
        self.start()
        return self._client.session_dispatches(session_id)

    def request_view(self, session_id: str, dispatch_seq: int) -> JsonObject:
        """Fetch one recorded dispatch's rebuilt model input.

        The runtime reconstructs the view through its native Session
        primitives; the Python SDK relays it unchanged and builds no second
        message projection.

        Raises:
            ValueError: ``session_id`` is empty or ``dispatch_seq`` is invalid.
            JsonRpcError: The runtime refused the request.
            SdkProtocolError: The runtime answered without a request view.
        """
        self.start()
        return self._client.session_request_view(session_id, dispatch_seq)

    def cancel_session(self, session_id: str) -> None:
        """Cancel one session's work and wait until the runtime confirms it stopped.

        The shared runtime and every other session stay alive. Only a confirmed
        settlement returns; a runtime failure or refusal is raised.
        """
        self.start()
        self._client.session_cancel(session_id)

    def run(
        self,
        input: str | list[JsonObject],
        *,
        session_id: str | None = None,
        cwd: str | None = None,
        agent_preset: str | None = None,
        on_notification: Callable[[Notification], None] | None = None,
        before_deliver: Callable[[], None] | None = None,
    ) -> RunResult:
        return self.start_session(session_id, cwd=cwd, agent_preset=agent_preset).run(
            input, on_notification=on_notification, before_deliver=before_deliver
        )


class Session:
    def __init__(
        self, harness: DeepSeekHarness, session_id: str, *, cwd: str | None = None,
        agent_preset: str | None = None,
    ) -> None:
        self.harness = harness
        self.id = session_id
        self._cwd = cwd or harness._cwd
        self._agent_preset = agent_preset
        # Highest native sequence this Session has returned, per source
        # session. A source session absent here has not been read before, so
        # its initialization events can still arrive ahead of this run's inbox
        # receipt; once it has a prefix, everything it sends is a later run's.
        self._last_seqs: dict[str, int] = {}

    @property
    def cwd(self) -> str:
        return self._cwd

    @property
    def agent_preset(self) -> str | None:
        return self._agent_preset

    def run(
        self,
        input: str | list[JsonObject],
        *,
        on_notification: Callable[[Notification], None] | None = None,
        before_deliver: Callable[[], None] | None = None,
    ) -> RunResult:
        content_blocks = normalize_input(input)
        notifications: list[Notification] = []
        events: list[JsonObject] = []
        # Notifications this Session returned before this run, per source
        # session. See ``_last_seqs``: a source session not listed here is
        # still unread, so its initialization events belong to this run.
        returned = dict(self._last_seqs)
        seen: set[tuple[str, int]] = set()
        pending: list[Notification] = []
        observed: dict[str, int] = {}

        def collect(notification: Notification) -> None:
            event = (
                notification.payload.get("event")
                if notification.method == "session.event"
                else None
            )
            if isinstance(event, dict):
                source_id = notification.payload.get("sessionId")
                seq = event.get("seq")
                if isinstance(source_id, str) and isinstance(seq, int):
                    if seq <= returned.get(source_id, -1) or (source_id, seq) in seen:
                        return
                    seen.add((source_id, seq))
                    observed[source_id] = max(observed.get(source_id, -1), seq)
            notifications.append(notification)
            if on_notification is not None:
                on_notification(notification)
            if (
                isinstance(event, dict)
                and notification.payload.get("sessionId") == self.id
            ):
                events.append(event)

        def claim_before_receipt(buffered: list[Notification]) -> list[Notification]:
            """Return the buffered notifications this run owns, in arrival order.

            A source session this Session has not returned events for yet is
            starting here, so its initialization events belong to this run.
            Every other notification seen before the receipt belongs to an
            earlier run: this run's own replies, status, and subagents are all
            appended after its splice.
            """
            claimed: list[Notification] = []
            for notification in buffered:
                if notification.method != "session.event":
                    continue
                source_id = notification.payload.get("sessionId")
                event = notification.payload.get("event")
                seq = event.get("seq") if isinstance(event, dict) else None
                if (
                    isinstance(source_id, str)
                    and isinstance(seq, int)
                    and source_id not in returned
                ):
                    claimed.append(notification)
            return claimed

        with self.harness.client.subscribe_session_notifications(
            self.id
        ) as subscription:
            message_id = self.harness.client.session_prompt(
                self.id,
                content_blocks,
                cwd=self.cwd,
                agent_preset=self.agent_preset,
                notification_subscription=subscription,
                before_deliver=before_deliver,
            )

            received = False
            while True:
                notification = subscription.next()
                if not received:
                    if not _is_inbox_receipt(notification, self.id, message_id):
                        pending.append(notification)
                        continue
                    received = True
                    for buffered in claim_before_receipt(pending):
                        collect(buffered)
                    pending.clear()
                collect(notification)
                if (
                    notification.method == "session.status"
                    and notification.payload.get("sessionId") == self.id
                    and notification.payload.get("status") == "idle"
                ):
                    break

        result = RunResult(
            session_id=self.id,
            final_response=final_response(events),
            finish_reason=finish_reason(events),
            events=events,
            notifications=notifications,
        )
        for source_id, seq in observed.items():
            self._last_seqs[source_id] = max(self._last_seqs.get(source_id, -1), seq)
        return result


def _is_inbox_receipt(
    notification: Notification, session_id: str, message_id: str
) -> bool:
    if (
        notification.method != "session.event"
        or notification.payload.get("sessionId") != session_id
    ):
        return False
    event = notification.payload.get("event")
    if not isinstance(event, dict) or event.get("type") != "agent/inbox/spliced":
        return False
    data = event.get("data")
    inserted = data.get("inserted") if isinstance(data, dict) else None
    return isinstance(inserted, list) and any(
        isinstance(message, dict) and message.get("id") == message_id
        for message in inserted
    )


def normalize_input(input: str | list[JsonObject]) -> list[JsonObject]:
    if isinstance(input, str):
        return [{"type": "text", "text": input}]
    return input


def final_response(events: list[JsonObject]) -> str:
    for event in reversed(events):
        if event.get("type") != "assistant/message":
            continue
        data = event.get("data")
        if not isinstance(data, dict):
            continue
        message = data.get("message")
        content_owner = message if isinstance(message, dict) else data
        content = content_owner.get("content")
        if not isinstance(content, list):
            continue
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
        return "".join(parts)
    return ""


def finish_reason(events: list[JsonObject]) -> str | None:
    """Return the last turn-ending kind.

    The input must contain root-session events from one owned run interval.

    Raises:
        SdkProtocolError: The last ``turn/end`` has no string reason kind.
    """
    for event in reversed(events):
        if event.get("type") != "turn/end":
            continue
        data = event.get("data")
        reason = data.get("reason") if isinstance(data, dict) else None
        kind = reason.get("kind") if isinstance(reason, dict) else None
        if not isinstance(kind, str):
            raise SdkProtocolError("turn/end event requires a string data.reason.kind")
        return kind
    return None
