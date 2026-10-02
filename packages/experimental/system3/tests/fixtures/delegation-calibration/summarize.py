"""Summarize delegation calibration runs into the three-arm comparison.

The Jev arm is composed from recorded entry decisions: each decision maps to
the arm that executes it (Codex to delegate, the baseline or fast tier to
self, reasoning to self-pro, expert to self-expert), and the task takes that
arm's runs. A task whose decided arm has no runs is left out of every arm.
Runs that never started (a nonzero exit in under one second) are reported as
infrastructure failures and excluded from the arms.

Usage:
  python3 summarize.py --results <results.jsonl> --decisions <decisions.json>
"""

import argparse
import json
import statistics
from collections import defaultdict


def is_infrastructure_failure(record: dict) -> bool:
    return "error" in record or (
        record.get("exitCode") not in (0, None) and record.get("elapsedS", 0) < 1
    )


def arm_stats(runs: list) -> dict:
    if not runs:
        return {"runs": 0}
    times = [run["elapsedS"] for run in runs]
    tokens = [
        run["mainModelTokens"]["inputTokens"] + run["mainModelTokens"]["outputTokens"]
        for run in runs
    ]
    return {
        "runs": len(runs),
        "passRate": round(sum(run["hidden"]["passed"] for run in runs) / len(runs), 3),
        "medianS": round(statistics.median(times), 1),
        "totalS": round(sum(times), 1),
        "medianMainTokens": int(statistics.median(tokens)),
        "delegatedRuns": sum(run["delegated"] for run in runs),
    }


DECISION_ARMS = {
    "codex": "delegate",
    "baseline": "self",
    "fast": "self",
    "reasoning": "self-pro",
    "expert": "self-expert",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", required=True)
    parser.add_argument("--decisions", required=True)
    args = parser.parse_args()
    records = [json.loads(line) for line in open(args.results, encoding="utf-8")]
    decisions = {
        row["id"]: row["decision"]
        for row in json.load(open(args.decisions, encoding="utf-8"))["rows"]
    }
    usable = [record for record in records if not is_infrastructure_failure(record)]
    by_task = defaultdict(lambda: defaultdict(list))
    for record in usable:
        by_task[record["task"]][record["arm"]].append(record)
    tasks = {}
    complete = []
    for task, arms in sorted(by_task.items()):
        jev_arm = DECISION_ARMS.get(decisions.get(task, "baseline"), "missing")
        row = {
            "size": next(iter(arms.values()))[0]["size"],
            "jevDecision": decisions.get(task),
            "self": arm_stats(arms.get("self", [])),
            "delegate": arm_stats(arms.get("delegate", [])),
            "jevArm": jev_arm,
            "jev": arm_stats(arms.get(jev_arm, [])),
        }
        tasks[task] = row
        if arms.get("self") and arms.get("delegate") and arms.get(jev_arm):
            complete.append((task, jev_arm, arms))
    overall = {}
    for name in ("self", "delegate", "jev"):
        runs = [
            run
            for task, jev_arm, arms in complete
            for run in arms[jev_arm if name == "jev" else name]
        ]
        overall[name] = arm_stats(runs)
    by_size = defaultdict(dict)
    for size in ("trivial", "small", "medium", "large"):
        for name in ("self", "delegate"):
            runs = [
                run
                for task, _, arms in complete
                if tasks[task]["size"] == size
                for run in arms[name]
            ]
            by_size[size][name] = arm_stats(runs)
    skipped = sorted(set(tasks) - {task for task, _, _ in complete})
    report = {
        "completePairs": len(complete),
        "incompleteTasks": skipped,
        "infrastructureFailures": len(records) - len(usable),
        "overall": overall,
        "bySize": by_size,
        "tasks": tasks,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
