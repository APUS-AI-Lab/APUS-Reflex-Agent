"""Notifications that reach the SDK before the run's inbox receipt.

The SDK subscribes before it sends the prompt. The runtime creates the Session,
appends its initialization events, and only then splices the prompt into the
inbox, so the notifications describing how the run started arrive before the
receipt that identifies the run. They must be kept and attributed to this run,
while a previous run's tail stays out of it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from deepseek_harness import DeepSeekHarness


def _runtime(tmp_path: Path, prompt_body: str) -> Path:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "session/prompt":
        params = msg.get("params") or {}
        session_id = params["sessionId"]
"""
        + prompt_body
        + """    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
"""
    )
    return script


def _event(event: dict[str, object]) -> str:
    return (
        '        print(json.dumps({"jsonrpc": "2.0", "method": "session.event", '
        '"params": {"sessionId": session_id, "event": %s}}), flush=True)\n'
        % json.dumps(event)
    )


def _result(message_id: str) -> str:
    return (
        '        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], '
        '"result": {"messageId": "%s"}}), flush=True)\n' % message_id
    )


def _idle() -> str:
    return (
        '        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", '
        '"params": {"sessionId": session_id, "status": "idle"}}), flush=True)\n'
    )


def _spliced(seq: int, message_id: str = "message-1") -> str:
    return _event(
        {
            "type": "agent/inbox/spliced",
            "seq": seq,
            "time": 1,
            "data": {
                "target": "next-turn",
                "start": 0,
                "inserted": [{"id": message_id}],
            },
        }
    )


def test_initialization_notifications_before_the_receipt_are_kept(
    tmp_path: Path,
) -> None:
    """The run keeps the events that precede its own inbox splice."""
    script = _runtime(
        tmp_path,
        _event({"type": "session/end-seed", "seq": 0, "time": 1, "data": {}})
        + _event(
            {
                "type": "developer/message",
                "seq": 1,
                "time": 1,
                "data": {"text": "be brief"},
            }
        )
        + _event({"type": "user/message", "seq": 2, "time": 1, "data": {"text": "hi"}})
        + _spliced(3)
        + _result("message-1")
        + _event({"type": "turn/start", "seq": 4, "time": 1, "data": {"turn": 1}})
        + _event(
            {
                "type": "assistant/message",
                "seq": 5,
                "time": 1,
                "data": {
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "hello"}],
                    }
                },
            }
        )
        + _event(
            {
                "type": "turn/end",
                "seq": 6,
                "time": 1,
                "data": {"turn": 1, "reason": {"kind": "completed"}},
            }
        )
        + _idle(),
    )

    reported: list[int] = []
    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)), cwd=str(tmp_path)
    ) as harness:
        result = harness.run(
            "hi",
            session_id="main",
            on_notification=lambda notification: reported.append(
                notification.payload["event"]["seq"]
            )
            if notification.method == "session.event"
            else None,
        )

    assert result.final_response == "hello"
    assert [event.get("seq") for event in result.events] == [0, 1, 2, 3, 4, 5, 6]
    assert [event["type"] for event in result.events[:3]] == [
        "session/end-seed",
        "developer/message",
        "user/message",
    ]
    assert reported == [0, 1, 2, 3, 4, 5, 6]


def test_a_replayed_notification_after_the_receipt_is_not_collected_twice(
    tmp_path: Path,
) -> None:
    """An identical source notification replayed after the receipt adds no event."""
    script = _runtime(
        tmp_path,
        _event(
            {
                "type": "developer/message",
                "seq": 1,
                "time": 1,
                "data": {"text": "be brief"},
            }
        )
        + _spliced(2)
        + _result("message-1")
        + _event(
            {
                "type": "developer/message",
                "seq": 1,
                "time": 1,
                "data": {"text": "be brief"},
            }
        )
        + _event({"type": "turn/start", "seq": 3, "time": 1, "data": {"turn": 1}})
        + _event(
            {
                "type": "turn/end",
                "seq": 4,
                "time": 1,
                "data": {"turn": 1, "reason": {"kind": "completed"}},
            }
        )
        + _idle(),
    )

    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)), cwd=str(tmp_path)
    ) as harness:
        result = harness.run("hi", session_id="main")

    assert [event.get("seq") for event in result.events] == [1, 2, 3, 4]
    assert [event["type"] for event in result.events] == [
        "developer/message",
        "agent/inbox/spliced",
        "turn/start",
        "turn/end",
    ]
    assert [notification.method for notification in result.notifications] == [
        "session.event",
        "session.event",
        "session.event",
        "session.event",
        "session.status",
    ]


def test_a_previous_runs_tail_does_not_enter_the_next_run(
    tmp_path: Path,
) -> None:
    """A later turn on one Session excludes what the previous run already saw.

    The second prompt reuses the Session, so the tail of the first turn can
    still be in flight when the second run subscribes. Those notifications
    belong to the previous run: collecting them would duplicate what that run
    returned and re-report its source sequences.
    """
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """import json
import sys

turn = 0

def events_before(turn):
    if turn == 1:
        return [{"type": "agent/inbox/spliced", "seq": 1, "time": 1, "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "message-1"}]}}]
    return [
        {"type": "assistant/message", "seq": 2, "time": 1, "data": {"message": {"role": "assistant", "content": [{"type": "text", "text": "first answer"}]}}},
        {"type": "turn/end", "seq": 3, "time": 1, "data": {"turn": 1, "reason": {"kind": "completed"}}},
        {"type": "agent/inbox/spliced", "seq": 4, "time": 1, "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "message-2"}]}},
    ]

def events_after(turn):
    if turn == 1:
        return [
            {"type": "assistant/message", "seq": 2, "time": 1, "data": {"message": {"role": "assistant", "content": [{"type": "text", "text": "first answer"}]}}},
            {"type": "turn/end", "seq": 3, "time": 1, "data": {"turn": 1, "reason": {"kind": "completed"}}},
        ]
    return [
        {"type": "turn/start", "seq": 5, "time": 1, "data": {"turn": 2}},
        {"type": "assistant/message", "seq": 6, "time": 1, "data": {"message": {"role": "assistant", "content": [{"type": "text", "text": "second answer"}]}}},
        {"type": "turn/end", "seq": 7, "time": 1, "data": {"turn": 2, "reason": {"kind": "completed"}}},
    ]

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "session/prompt":
        turn += 1
        params = msg.get("params") or {}
        session_id = params["sessionId"]
        for event in events_before(turn):
            print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": session_id, "event": event}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": f"message-{turn}"}}), flush=True)
        for event in events_after(turn):
            print(json.dumps({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": session_id, "event": event}}), flush=True)
        print(json.dumps({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": session_id, "status": "idle"}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
"""
    )

    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)), cwd=str(tmp_path)
    ) as harness:
        first = harness.run("first", session_id="main")
        second = harness.run("second", session_id="main")

    assert first.final_response == "first answer"
    assert second.final_response == "second answer"
    assert [event.get("seq") for event in second.events] == [4, 5, 6, 7]
    assert [
        notification.payload.get("sessionId") for notification in second.notifications
    ] == ["main"] * 5
