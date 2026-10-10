"""Fixed paired real-provider acceptance; without --execute only prints the plan."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import time
from decimal import Decimal
from pathlib import Path

FINANCE = "请同一轮并行、每份单独读取01-old-trip.txt、02-invoice-a.txt、03-invoice-b.txt、04-payment-a.txt、05-invoice-c.txt、06-payment-b.txt。当前任务唯一的数据范围是第2–6份；第1份是已归档的旧旅行干扰信息，本次明确不需要，绝不能用于财务计算。只据第2–6份计算剩余应收，列出依据，精确到分，不修改任何文件。"
WARM = "继续刚才财务核对：只用现有材料，不调用工具，复核剩余应收合计并说明订单A余额。"
RESTORE = "现在换个话题：旧京都旅行住哪家旅馆、早餐是什么、几点在哪里集合？只用本会话保存的记忆，不重读文件、不联网。"
DATA = {
    "01-old-trip.txt": "已结束且与本次财务无关的京都旅行：旅馆樱花小舍 Sakura House，早餐抹茶松饼，09:20在京都站中央口集合。旧行程已结束，不计入应收或回款。\n",
    "02-invoice-a.txt": "订单A应收875.12元。\n",
    "03-invoice-b.txt": "订单B应收210.34元。\n",
    "04-payment-a.txt": "订单A已回款40.00元，须扣除。\n",
    "05-invoice-c.txt": "订单C应收112.10元，无回款。\n",
    "06-payment-b.txt": "订单B已回款20.15元，须扣除。\n",
}


def public_evidence(value):
    """Keep reasoning hashes, never raw reasoning in shareable evidence."""
    if isinstance(value, list):
        return [public_evidence(item) for item in value]
    if not isinstance(value, dict):
        return value
    if value.get("type") in {
        "reasoning",
        "thinking",
        "reasoning-delta",
        "thinking_delta",
    }:
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
        return {
            "type": value["type"],
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
        }
    return {
        key: (
            {"sha256": hashlib.sha256(str(item).encode()).hexdigest()}
            if key in {"reasoning", "reasoning_content", "thinking", "signature"}
            else public_evidence(item)
        )
        for key, item in value.items()
    }


def answer_checks(stage, output):
    total = (
        sum(
            (
                Decimal(DATA[name].split("应收")[1].split("元")[0])
                for name in ["02-invoice-a.txt", "03-invoice-b.txt", "05-invoice-c.txt"]
            ),
            Decimal(0),
        )
        - Decimal("40.00")
        - Decimal("20.15")
    )
    if stage == "restart-recovery":
        return {
            "hotel": "Sakura House" in output or "樱花小舍" in output,
            "breakfast": "抹茶松饼" in output,
            "time": "09:20" in output or "9:20" in output,
            "place": "京都站中央口" in output
            or ("京都站" in output and "中央口" in output),
        }
    # Accept ordinary thousands separators while keeping the exact cent value.
    normalized_output = output.replace(",", "").replace("，", "")
    checks = {"total": f"{total:.2f}" in normalized_output}
    if stage == "warm-continuation":
        checks["orderA"] = (
            f"{Decimal('875.12') - Decimal('40.00'):.2f}" in normalized_output
        )
    return checks


def log_prefixes(home):
    return {
        str(path.relative_to(home)): path.read_bytes() for path in home.rglob("*.jsonl")
    }


def prefix_checks(home, before):
    return [
        {
            "path": name,
            "bytes": len(content),
            "beforeSha256": hashlib.sha256(content).hexdigest(),
            "afterPrefixSha256": hashlib.sha256(
                (home / name).read_bytes()[: len(content)]
            ).hexdigest(),
            "unchanged": (home / name).read_bytes().startswith(content),
        }
        for name, content in before.items()
    ]


def session_observations(home):
    """Return only content-free Reflex events from the durable JSONL log."""
    observations = []
    for path in home.rglob("*.jsonl"):
        for line in path.read_text().splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") in {
                "reflex/context-projection",
                "system3/judgement",
                "system3/reflex-evidence",
                "system3/reflex-supervision",
            }:
                observations.append(
                    {
                        "type": event["type"],
                        "seq": event.get("seq"),
                        "data": public_evidence(event.get("data", {})),
                    }
                )
    return observations


def run_headless(exe, cwd, patch, session_id, prompt):
    """Run one real headless process and return its final answer plus observations."""
    command = [str(exe), "--profile", "headless", "--patch", str(patch), "--json"]
    if session_id is not None:
        command.extend(["--session-id", session_id])
    command.append(prompt)
    env = os.environ.copy()
    env.update(
        {
            "DSH_HOME": str(cwd / "home"),
            "DSH_AGENTS_HOME": str(cwd / "agents"),
            "DSH_PERMISSION_MODE": "danger-full-access",
            "DSH_TELEMETRY_DISABLED": "1",
        }
    )
    result = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    rows = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    if result.returncode != 0:
        errors = [
            row.get("message", "headless process failed")
            for row in rows
            if row.get("type") == "error"
        ]
        raise RuntimeError(
            errors[-1] if errors else result.stderr.strip() or "headless process failed"
        )
    session = next(
        (row.get("sessionId") for row in rows if row.get("type") == "session"), None
    )
    final = next(
        (row.get("text", "") for row in reversed(rows) if row.get("type") == "final"),
        None,
    )
    if not isinstance(final, str) or not final:
        raise RuntimeError("headless process returned no final answer")
    return {
        "output": final,
        "events": session_observations(cwd / "home"),
        "sessionId": session,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--reflex-model", default="APUS-OpenJev-v1-9B-5949")
    args = parser.parse_args()
    matrix = [(0, False), (0, True), (1, True), (1, False)]
    if not args.execute:
        print(
            json.dumps(
                {"matrix": matrix, "turns": [FINANCE, WARM, RESTORE], "network": False},
                ensure_ascii=False,
            )
        )
        return
    args.output.mkdir(parents=True, exist_ok=False)
    root = Path(tempfile.mkdtemp(prefix="reflex-cache-pairs-"))
    results = []
    for pair, enabled in matrix:
        run_id = f"pair-{pair}-{'on' if enabled else 'off'}"
        cwd = root / run_id
        cwd.mkdir()
        for name, text in DATA.items():
            (cwd / name).write_text(text)
        trace = args.output.resolve() / f"{run_id}.requests.jsonl"
        patch = cwd / "patch.json"
        patch.write_text(
            json.dumps(
                [
                    {
                        "id": "skill-filesystem",
                        "config": {"includeDefaultRoots": False},
                    },
                    {"id": "llm-deepseek", "disabled": True},
                    {
                        "id": "llm-pi-ai",
                        "config": {
                            "providers": {
                                "deepseek-official": {
                                    "displayName": "DeepSeek 官方",
                                    "api": "openai-completions",
                                    "baseURL": "https://api.deepseek.com",
                                    "apiKeyEnv": "DEEPSEEK_API_KEY",
                                    "compat": {"thinkingFormat": "deepseek"},
                                    "models": [
                                        {
                                            "id": "deepseek-flash",
                                            "contextWindow": 131072,
                                            "maxTokens": 8192,
                                            "input": ["text", "image"],
                                            "reasoningEfforts": {
                                                "off": None,
                                                "low": "low",
                                                "medium": "medium",
                                                "high": "high",
                                            },
                                        }
                                    ],
                                }
                            }
                        },
                    },
                    {
                        "id": "agent-default-model",
                        "config": {
                            "provider": "deepseek-official",
                            "model": "deepseek-flash",
                            "reasoningEffort": "low",
                        },
                    },
                    {
                        "id": "session-persistence-jsonl",
                        "config": {
                            "root": str(cwd / "home/sessions"),
                            "compression": "none",
                        },
                    },
                    {
                        "insert": [
                            {
                                "id": "reflex-cache-benchmark",
                                "name": Path(__file__)
                                .with_name("observe.mjs")
                                .resolve()
                                .as_uri(),
                                "config": {
                                    "enabled": enabled,
                                    "trace": str(trace),
                                    "endpoint": args.endpoint,
                                    "reflexModel": args.reflex_model,
                                },
                            }
                        ]
                    },
                ]
            )
        )
        record = {"id": run_id, "enabled": enabled, "workspace": str(cwd), "turns": []}
        try:
            session_id = None
            for label, prompt in [
                ("first-observed", FINANCE),
                ("warm-continuation", WARM),
            ]:
                start = time.monotonic()
                result = run_headless(
                    args.exe.resolve(), cwd, patch, session_id, prompt
                )
                session_id = session_id or result["sessionId"]
                if session_id is None:
                    raise RuntimeError("headless process returned no Session identity")
                record["turns"].append(
                    {
                        "stage": label,
                        "elapsedMs": (time.monotonic() - start) * 1000,
                        "output": result["output"],
                        "events": result["events"],
                        "checks": answer_checks(label, result["output"]),
                    }
                )
            before_restart = log_prefixes(cwd / "home")
            # The third prompt is a new CLI process with the same durable Session.
            start = time.monotonic()
            result = run_headless(args.exe.resolve(), cwd, patch, session_id, RESTORE)
            record["turns"].append(
                {
                    "stage": "restart-recovery",
                    "elapsedMs": (time.monotonic() - start) * 1000,
                    "output": result["output"],
                    "events": result["events"],
                    "checks": answer_checks("restart-recovery", result["output"]),
                }
            )
            record["persistedPrefix"] = prefix_checks(cwd / "home", before_restart)
        except Exception as error:
            record["error"] = str(error)
        record["inputUnchanged"] = all(
            (cwd / name).read_text() == text for name, text in DATA.items()
        )
        record["inputHashes"] = {
            name: hashlib.sha256((cwd / name).read_bytes()).hexdigest() for name in DATA
        }
        record["reflexDecisions"] = [
            event["data"]
            for turn in record["turns"]
            for event in turn["events"]
            if event["type"] == "system3/judgement"
        ]
        record["requests"] = (
            [json.loads(line) for line in trace.read_text().splitlines()]
            if trace.exists()
            else []
        )
        record["checks"] = {
            "allAnswers": len(record["turns"]) == 3
            and all(all(turn["checks"].values()) for turn in record["turns"]),
            "inputUnchanged": record["inputUnchanged"],
            "persistedPrefixUnchanged": bool(record.get("persistedPrefix"))
            and all(row["unchanged"] for row in record["persistedPrefix"]),
            "requestPrefixUnchanged": len(record["requests"]) >= 3
            and all(row["prefixUnchanged"] is not False for row in record["requests"]),
            "deployedRoute": bool(record["requests"])
            and all(
                row["provider"] == "deepseek-official"
                and row["model"] == "deepseek-flash"
                and row["effort"] == "low"
                for row in record["requests"]
            ),
            "stableTools": len({row["toolsSha256"] for row in record["requests"]}) == 1,
            "noRuntimeError": "error" not in record
            and all(row["error"] is None for row in record["requests"]),
            "treatmentApplied": not enabled
            or any(
                event["type"] == "reflex/context-projection"
                and event["data"]["action"] == "remove"
                for turn in record["turns"]
                for event in turn["events"]
            ),
        }
        results.append(record)
        (args.output / "report.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "model": "deepseek-flash",
                    "effort": "low",
                    "coldCacheGuaranteed": False,
                    "prices": None,
                    "records": results,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n"
        )
    print(f"Evidence: {args.output / 'report.json'}")
    assert (
        len({row["toolsSha256"] for record in results for row in record["requests"]})
        == 1
    ), "Matched conditions used different tool schemas"
    assert all(all(record["checks"].values()) for record in results), (
        "Acceptance failed; all observed conditions remain in report.json"
    )


if __name__ == "__main__":
    main()
