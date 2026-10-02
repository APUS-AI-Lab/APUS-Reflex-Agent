"""Run the delegation calibration arms through the real headless product.

Each run copies a task workspace, answers the task prompt with `dsh headless`
under one arm's patch, then scores the result with the task's hidden tests.

Arms:
  self      the main model works alone with native tools (no delegation tool)
  delegate  the subagent_codex tool is available and the prompt asks to use it

Usage:
  python3 run_arms.py --dsh <apps/cli/lib/bin.js> --patches <dir with
  self.patch.yml and delegate.patch.yml> --out <dir> [--reps N] [--jobs N]
  [--tasks id,id]

Credentials come from the caller's environment; nothing is printed.
"""

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DELEGATE_PREFIX = (
    "请调用 subagent_codex 工具，把下面的任务完整交给 Codex 完成，"
    "完成后复核结果再回复。\n\n"
)
TIMEOUT_S = 600


def session_usage(home: Path) -> dict:
    logs = list(home.rglob("session.v4.jsonl.zstd"))
    totals = {"inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0}
    tools = []
    for log in logs:
        raw = subprocess.run(
            ["zstd", "-dc", str(log)], capture_output=True, check=False
        ).stdout.decode("utf-8", "replace")
        for line in raw.splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "assistant/message":
                usage = event["data"].get("usage") or {}
                for key in totals:
                    totals[key] += usage.get(key, 0)
            if event.get("type") == "tool/call":
                tools.append(event["data"].get("name"))
    return {"mainModelTokens": totals, "toolCalls": tools}


def hidden_score(task_dir: Path, workspace: Path) -> dict:
    hidden = task_dir / "hidden" / "test_hidden.py"
    target = workspace.parent / "hidden_test_hidden.py"
    shutil.copy(hidden, target)
    env = {**os.environ, "PYTHONPATH": str(workspace), "PYTHONDONTWRITEBYTECODE": "1"}
    result = subprocess.run(
        ["python3", "-m", "pytest", "-q", "-p", "no:cacheprovider", str(target)],
        cwd=workspace,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    tail = result.stdout.strip().splitlines()[-1:] or [""]
    counts = {
        kind: int(n) for n, kind in re.findall(r"(\d+) (passed|failed|error)", tail[0])
    }
    return {"passed": result.returncode == 0, "counts": counts, "summary": tail[0]}


def run_once(args, task_id: str, arm: str, rep: int) -> dict:
    task_dir = HERE / "tasks" / task_id
    meta = json.loads((task_dir / "meta.json").read_text())
    run_dir = Path(args.out) / task_id / f"{arm}-{rep}"
    shutil.rmtree(run_dir, ignore_errors=True)
    home = run_dir / "home"
    (home / ".dsh").mkdir(parents=True)
    workspace = run_dir / "ws"
    shutil.copytree(task_dir / "workspace", workspace)
    prompt = (DELEGATE_PREFIX if arm == "delegate" else "") + meta["prompt"]
    env = {
        **os.environ,
        "HOME": str(home),
        "DSH_HOME": str(home / ".dsh"),
        "DSH_TELEMETRY_DISABLED": "1",
        "DSH_PERMISSION_MODE": "workspace-write",
        "SYSTEM3_SESSION_DATA_CLASSES": '["public","workspace"]',
    }
    patch = Path(args.patches) / f"{arm}.patch.yml"
    started = time.monotonic()
    timed_out = False
    try:
        result = subprocess.run(
            ["node", args.dsh, "headless", "--patch", str(patch), prompt],
            cwd=workspace,
            env=env,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_S,
            check=False,
        )
        exit_code = result.returncode
        (run_dir / "answer.txt").write_text(result.stdout)
        (run_dir / "stderr.txt").write_text(result.stderr)
    except subprocess.TimeoutExpired:
        timed_out = True
        exit_code = None
    elapsed = time.monotonic() - started
    record = {
        "task": task_id,
        "size": meta["size"],
        "arm": arm,
        "rep": rep,
        "elapsedS": round(elapsed, 1),
        "exitCode": exit_code,
        "timedOut": timed_out,
        **session_usage(home),
        "hidden": hidden_score(task_dir, workspace),
    }
    record["delegated"] = "subagent_codex" in record["toolCalls"]
    (run_dir / "record.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2)
    )
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsh", required=True)
    parser.add_argument("--patches", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--reps", type=int, default=1)
    parser.add_argument("--jobs", type=int, default=3)
    parser.add_argument("--tasks", default="")
    parser.add_argument("--arms", default="self,delegate")
    args = parser.parse_args()
    args.dsh = str(Path(args.dsh).resolve())
    task_ids = (
        args.tasks.split(",")
        if args.tasks
        else sorted(p.name for p in (HERE / "tasks").iterdir() if p.is_dir())
    )
    jobs = [
        (task, arm, rep)
        for rep in range(1, args.reps + 1)
        for task in task_ids
        for arm in args.arms.split(",")
    ]
    results_path = Path(args.out) / "results.jsonl"
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(run_once, args, *job): job for job in jobs}
        for future in concurrent.futures.as_completed(futures):
            task, arm, rep = futures[future]
            try:
                record = future.result()
            except Exception as error:  # noqa: BLE001 - one failed run must not stop the batch
                record = {"task": task, "arm": arm, "rep": rep, "error": repr(error)}
            with results_path.open("a") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            hidden = record.get("hidden", {})
            print(
                f"{task} {arm}#{rep}: pass={hidden.get('passed')} "
                f"{record.get('elapsedS')}s delegated={record.get('delegated')}",
                flush=True,
            )


if __name__ == "__main__":
    main()
