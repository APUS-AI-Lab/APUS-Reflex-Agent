"""Verify task binding and exact source recovery through two Python SDK processes."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import secrets

import pytest

from deepseek_harness import DeepSeekHarness

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / "apps" / "cli" / "lib" / "bin.js"


@pytest.mark.skipif(not CLI.exists(), reason="requires the built dsh profile runtime")
def test_continuum_task_snapshot(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    patch = tmp_path / "observer.patch.yml"
    patch.write_text(
        json.dumps(
            [
                {"id": "llm-deepseek", "disabled": True},
                {
                    "id": "session-persistence-jsonl",
                    "config": {
                        "root": str(tmp_path / "sessions"),
                        "compression": "none",
                    },
                },
                {
                    "insert": [
                        {
                            "id": "continuum-task-observer",
                            "name": str(
                                ROOT
                                / "apps/cli/tests/profiles/headless/tests/fixtures"
                                / "continuum-task-observer.mjs"
                            ),
                        }
                    ]
                },
            ]
        )
    )
    seed = (
        f"  Early requirement: {secrets.token_hex(16)}\n"
        + 'Preserve exact 漢字, quotes " and whitespace.\n' * 240
        + f"Tail requirement: {secrets.token_hex(16)} 🌈\n"
    )
    assert len(seed.encode()) > 8192

    def launch(phase: str, prompt: str):
        with DeepSeekHarness(
            dsh_bin=str(CLI),
            dsh_home=str(tmp_path / "home"),
            cwd=str(workspace),
            profile="sdk",
            patches=(
                str(ROOT / "apps/cli/config/examples/continuum-task.patch.yml"),
                str(patch),
            ),
            provider="continuum-task-test",
            model="continuum-task-test",
            request_timeout_seconds=60,
            env={
                "DSH_TELEMETRY_DISABLED": "1",
                "DSH_TOOLS_MODE": "native",
                "APUS_TASK_ROOT": str(tmp_path / "memory"),
                "APUS_TASK_DOMAIN": "python-domain",
                "APUS_TASK_PRINCIPAL": "python-principal",
                "APUS_TASK_ID": "python-task",
                "CONTINUUM_TASK_PHASE": phase,
                "CONTINUUM_TASK_REQUEST_LOG": str(tmp_path / f"{phase}.requests"),
            },
        ) as harness:
            return harness.run(prompt)

    first = launch("seed", seed)
    second = launch(
        "continue", "Continue the attached task and write its saved inputs."
    )
    assert first.session_id != second.session_id
    artifact = json.loads((workspace / "continued-task.json").read_text())
    source = next(
        event
        for event in first.events
        if event["type"] == "user/message" and event["data"]["source"]["kind"] == "user"
    )
    assert artifact == {
        "revision": 2,
        "inputs": [
            {
                "text": seed,
                "source": {
                    "sessionId": first.session_id,
                    "eventSeq": source["seq"],
                    "blockIndex": 0,
                    "digest": hashlib.sha256(seed.encode()).hexdigest(),
                },
            }
        ],
    }
    bindings = [
        event["data"]
        for event in second.events
        if event["type"] == "continuum/task-binding"
    ]
    calls = [
        event["data"]["name"] for event in second.events if event["type"] == "tool/call"
    ]
    assert calls.count("read_continuum_task") > 1
    assert len(bindings) == 1
    actual = {
        "seed_response": first.final_response,
        "continued_response": second.final_response,
        "task_id": bindings[0]["taskId"],
        "domain_id": bindings[0]["domainId"],
        "principal_id": bindings[0]["principalId"],
        "workspace_matches": bindings[0]["workspace"] == str(workspace.resolve()),
        "last_tool": calls[-1],
        "revision": artifact["revision"],
    }
    expected = Path(__file__).with_name("expected") / "continuum-task.json"
    assert actual == json.loads(expected.read_text())
