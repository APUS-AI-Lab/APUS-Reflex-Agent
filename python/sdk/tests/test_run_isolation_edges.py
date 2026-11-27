"""Run isolation at the edges of the inbox receipt window.

The receipt confirms which run owns the queued prompt. Notifications that
arrive before it can only belong to this run when they are the Session's own
initialization events: a run's status, subagents, and replies all appear after
its splice, so anything else seen beforehand is the previous run's tail.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness, SdkProtocolError


_PRELUDE = """import json
import sys


def send(message):
    print(json.dumps(message), flush=True)


def event(session_id, kind, seq, data):
    send({"jsonrpc": "2.0", "method": "session.event",
          "params": {"sessionId": session_id,
                     "event": {"type": kind, "seq": seq, "time": 1, "data": data}}})


def spliced(session_id, seq, message_id):
    event(session_id, "agent/inbox/spliced", seq,
          {"target": "next-turn", "start": 0, "inserted": [{"id": message_id}]})


def assistant(session_id, seq, text):
    event(session_id, "assistant/message", seq,
          {"message": {"role": "assistant",
                       "content": [{"type": "text", "text": text}]}})


def turn_end(session_id, seq, turn, reason=None):
    event(session_id, "turn/end", seq,
          {"turn": turn, "reason": {"kind": "completed"} if reason is None else reason})


def idle(session_id):
    send({"jsonrpc": "2.0", "method": "session.status",
          "params": {"sessionId": session_id, "status": "idle"}})


turn = 0
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": msg["id"],
              "result": {"serverInfo": {"name": "fake-runtime"}}})
    elif method == "session/prompt":
        turn += 1
        sid = (msg.get("params") or {})["sessionId"]
        message_id = f"message-{turn}"
        if turn == 2:
            idle(sid)
            send({"jsonrpc": "2.0", "method": "subagent.started",
                  "params": {"parentSessionId": sid, "childSessionId": "late-child"}})
        spliced(sid, 3 * turn - 2, message_id)
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": message_id}})
        assistant(sid, 3 * turn - 1, f"answer {turn}")
        turn_end(sid, 3 * turn, turn)
        idle(sid)
    elif method == "shutdown":
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {}})
        break
"""


_RUN_ONE = """import json
import sys


def send(message):
    print(json.dumps(message), flush=True)


def event(session_id, kind, seq, data):
    send({"jsonrpc": "2.0", "method": "session.event",
          "params": {"sessionId": session_id,
                     "event": {"type": kind, "seq": seq, "time": 1, "data": data}}})


def spliced(session_id, seq, message_id):
    event(session_id, "agent/inbox/spliced", seq,
          {"target": "next-turn", "start": 0, "inserted": [{"id": message_id}]})


def assistant(session_id, seq, text):
    event(session_id, "assistant/message", seq,
          {"message": {"role": "assistant",
                       "content": [{"type": "text", "text": text}]}})


def turn_end(session_id, seq, turn, reason=None):
    event(session_id, "turn/end", seq,
          {"turn": turn, "reason": {"kind": "completed"} if reason is None else reason})


def idle(session_id):
    send({"jsonrpc": "2.0", "method": "session.status",
          "params": {"sessionId": session_id, "status": "idle"}})


turn = 0
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": msg["id"],
              "result": {"serverInfo": {"name": "fake-runtime"}}})
    elif method == "session/prompt":
        turn += 1
        sid = (msg.get("params") or {})["sessionId"]
        message_id = f"message-{turn}"
        if turn == 1:
            spliced(sid, 1, message_id)
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": message_id}})
            assistant(sid, 2, "first answer")
            turn_end(sid, 3, 1)
            idle(sid)
        else:
            assistant(sid, 4, "LATE-TAIL")
            spliced(sid, 5, message_id)
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": message_id}})
            event(sid, "turn/start", 6, {"turn": 2})
            assistant(sid, 7, "second answer")
            turn_end(sid, 8, 2)
            idle(sid)
    elif method == "shutdown":
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {}})
        break
"""


_RAISING_RUN = """import json
import sys


def send(message):
    print(json.dumps(message), flush=True)


def event(session_id, kind, seq, data):
    send({"jsonrpc": "2.0", "method": "session.event",
          "params": {"sessionId": session_id,
                     "event": {"type": kind, "seq": seq, "time": 1, "data": data}}})


def spliced(session_id, seq, message_id):
    event(session_id, "agent/inbox/spliced", seq,
          {"target": "next-turn", "start": 0, "inserted": [{"id": message_id}]})


def assistant(session_id, seq, text):
    event(session_id, "assistant/message", seq,
          {"message": {"role": "assistant",
                       "content": [{"type": "text", "text": text}]}})


def turn_end(session_id, seq, turn, reason=None):
    event(session_id, "turn/end", seq,
          {"turn": turn, "reason": {"kind": "completed"} if reason is None else reason})


def idle(session_id):
    send({"jsonrpc": "2.0", "method": "session.status",
          "params": {"sessionId": session_id, "status": "idle"}})


turn = 0
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": msg["id"],
              "result": {"serverInfo": {"name": "fake-runtime"}}})
    elif method == "session/prompt":
        turn += 1
        sid = (msg.get("params") or {})["sessionId"]
        message_id = f"message-{turn}"
        if turn == 1:
            spliced(sid, 1, message_id)
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": message_id}})
            assistant(sid, 2, "broken")
            turn_end(sid, 3, 1, {})
            idle(sid)
        else:
            assistant(sid, 3, "recovered")
            spliced(sid, 4, message_id)
            send({"jsonrpc": "2.0", "id": msg["id"], "result": {"messageId": message_id}})
            turn_end(sid, 5, 2)
            idle(sid)
    elif method == "shutdown":
        send({"jsonrpc": "2.0", "id": msg["id"], "result": {}})
        break
"""


def _runtime(tmp_path: Path, script: str) -> Path:
    path = tmp_path / "fake_runtime.py"
    path.write_text(script)
    return path


def test_previous_runs_status_and_subagent_notices_stay_out_of_the_next_run(
    tmp_path: Path,
) -> None:
    """Status and subagent notices buffered before the receipt are not this run's.

    These notifications carry no native sequence, so nothing in them can
    confirm which run they belong to. A run's own status and subagents appear
    after its inbox splice, so anything of the kind still in flight before the
    receipt is the previous run's tail.
    """
    script = _runtime(tmp_path, _PRELUDE)

    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)), cwd=str(tmp_path)
    ) as harness:
        harness.run("first", session_id="main")
        second = harness.run("second", session_id="main")

    assert [notification.method for notification in second.notifications] == [
        "session.event",
        "session.event",
        "session.event",
        "session.status",
    ]
    assert not any(
        notification.method == "subagent.started"
        for notification in second.notifications
    )


def test_a_previous_runs_late_event_above_the_returned_prefix_stays_out(
    tmp_path: Path,
) -> None:
    """An event appended after the previous run returned is still its tail.

    The runtime can append an event after a run reached idle, for example a
    title or a late turn ending. Its native sequence is above everything the
    previous run returned, but it was produced by that run, so the next run
    must not adopt it as its own.
    """
    script = _runtime(tmp_path, _RUN_ONE)

    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)), cwd=str(tmp_path)
    ) as harness:
        harness.run("first", session_id="main")
        second = harness.run("second", session_id="main")

    assert second.final_response == "second answer"
    assert [event.get("seq") for event in second.events] == [5, 6, 7, 8]


def test_a_run_that_raises_does_not_advance_the_returned_prefix(
    tmp_path: Path,
) -> None:
    """A run that raised returned nothing, so it must not mark its events as seen.

    The prefix records what callers already received. Recording events from a
    run that ended in an exception would drop those events from every later
    read, because the caller never saw them.
    """
    script = _runtime(tmp_path, _RAISING_RUN)

    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)), cwd=str(tmp_path)
    ) as harness:
        session = harness.start_session("main")
        with pytest.raises(SdkProtocolError):
            session.run("broken turn")
        second = session.run("recovered turn")

    assert [event.get("seq") for event in second.events] == [3, 4, 5]
