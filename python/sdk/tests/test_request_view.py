"""C09A: the Python SDK transports dispatch facts and request views verbatim.

The runtime owns request reconstruction. These tests pin that the Python
client sends the documented params, validates the answer's envelope, surfaces a
typed refusal, and never computes a second message projection of its own.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness, HarnessClient, HarnessConfig
from deepseek_harness.errors import JsonRpcError

REQUEST_VIEW_CAPABILITY = "request-view/dispatch-v1"

VIEW = {
    "sessionId": "s",
    "dispatchSeq": 4,
    "prefixEnd": 9,
    "turn": 1,
    "step": 1,
    "header": {"config": {"provider": "p", "model": "m"}},
    "messages": [
        {
            "role": "user",
            "id": "u1",
            "source": {"kind": "user"},
            "content": [{"type": "text", "text": "hello"}],
        }
    ],
    "toolHistory": {"tools": [], "updates": []},
    "projectionTypes": ["image/offload"],
}


def _runtime_script(tmp_path: Path, *, capabilities: bool, dispatches: dict | None = None,
                    views: dict | None = None) -> Path:
    """Write a scripted runtime that answers the request-view methods."""
    script = tmp_path / "fake_runtime.py"
    init_result: dict = {"serverInfo": {"name": "fake-runtime"}}
    if capabilities:
        init_result["capabilities"] = [REQUEST_VIEW_CAPABILITY]
    script.write_text(
        f"""#!{sys.executable}
import json
import os
import sys

INIT = {init_result!r}
DISPATCHES = {(dispatches or {})!r}
VIEWS = {(views or {})!r}

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    rid = msg.get("id")
    if method == "initialize":
        print(json.dumps({{"jsonrpc": "2.0", "id": rid, "result": INIT}}), flush=True)
    elif method == "session/dispatches":
        params = msg.get("params") or {{}}
        print(json.dumps({{"jsonrpc": "2.0", "id": rid, "result": {{
            "sessionId": params.get("sessionId", ""),
            "dispatches": DISPATCHES.get(params.get("sessionId", ""), []),
        }}}}), flush=True)
    elif method == "session/request-view":
        params = msg.get("params") or {{}}
        key = str(params.get("sessionId", "")) + ":" + str(params.get("dispatchSeq", ""))
        view = VIEWS.get(key)
        if view is None:
            print(json.dumps({{"jsonrpc": "2.0", "id": rid, "error": {{
                "code": -32603,
                "message": "dispatch not found",
                "data": {{"code": "DISPATCH_NOT_FOUND"}},
            }}}}), flush=True)
        else:
            print(json.dumps({{"jsonrpc": "2.0", "id": rid, "result": view}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({{"jsonrpc": "2.0", "id": rid, "result": {{}}}}), flush=True)
        break
""",
        encoding="utf-8",
    )
    script.chmod(0o755)
    return script


def _client(tmp_path: Path, script: Path, *, home: Path) -> HarnessClient:
    return HarnessClient(
        HarnessConfig(
            dsh_bin=str(script),
            dsh_home=str(home),
            env={},
        )
    )


def test_client_reports_advertised_capabilities(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    with _client(tmp_path, _runtime_script(tmp_path, capabilities=True), home=home) as client:
        initialized = client.initialize(cwd=str(tmp_path), provider="p", model="m")
        assert initialized.capabilities == [REQUEST_VIEW_CAPABILITY]


def test_client_reports_no_capabilities_when_absent(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    with _client(tmp_path, _runtime_script(tmp_path, capabilities=False), home=home) as client:
        initialized = client.initialize(cwd=str(tmp_path), provider="p", model="m")
        assert initialized.capabilities == []


def test_client_transports_dispatch_facts_and_request_views(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    script = _runtime_script(
        tmp_path,
        capabilities=True,
        dispatches={"s": [{"dispatchSeq": 4, "prefixEnd": 9, "turn": 1, "step": 1, "settlementSeq": 12}]},
        views={"s:4": VIEW},
    )
    with _client(tmp_path, script, home=home) as client:
        client.initialize(cwd=str(tmp_path), provider="p", model="m")
        listed = client.session_dispatches("s")
        assert listed == {
            "sessionId": "s",
            "dispatches": [{"dispatchSeq": 4, "prefixEnd": 9, "turn": 1, "step": 1, "settlementSeq": 12}],
        }
        view = client.session_request_view("s", 4)
        assert view == VIEW
        # The client relays the runtime's projection list; it builds none itself.
        assert view["projectionTypes"] == ["image/offload"]


def test_client_surfaces_a_typed_refusal(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    with _client(tmp_path, _runtime_script(tmp_path, capabilities=True), home=home) as client:
        client.initialize(cwd=str(tmp_path), provider="p", model="m")
        with pytest.raises(JsonRpcError) as caught:
            client.session_request_view("s", 4)
        assert caught.value.data == {"code": "DISPATCH_NOT_FOUND"}


def test_client_rejects_malformed_params_before_sending(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    with _client(tmp_path, _runtime_script(tmp_path, capabilities=True), home=home) as client:
        client.initialize(cwd=str(tmp_path), provider="p", model="m")
        for dispatch_seq in (-1, 1.5):
            with pytest.raises(ValueError):
                client.session_request_view("s", dispatch_seq)
        with pytest.raises(ValueError):
            client.session_request_view("", 0)
        with pytest.raises(ValueError):
            client.session_dispatches("")


def test_high_level_harness_exposes_request_views(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    script = _runtime_script(
        tmp_path,
        capabilities=True,
        dispatches={"s": [{"dispatchSeq": 4, "prefixEnd": 9, "turn": 1, "step": 1}]},
        views={"s:4": VIEW},
    )
    harness = DeepSeekHarness(
        dsh_bin=str(script),
        dsh_home=str(home),
        cwd=str(tmp_path),
        env={},
    )
    try:
        assert harness.dispatches("s")["dispatches"][0]["dispatchSeq"] == 4
        assert harness.request_view("s", 4) == VIEW
    finally:
        harness.close()
