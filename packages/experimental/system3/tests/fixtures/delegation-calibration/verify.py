#!/usr/bin/env python3
"""Check that every delegation-calibration task is well formed.

For each task under ``tasks/`` this script:

1. validates ``meta.json``;
2. copies ``workspace/`` to a temporary directory and requires the hidden
   tests to fail there;
3. overlays ``reference/`` onto that copy and requires the hidden tests and
   any visible tests under ``tests/`` to pass.

Usage: ``python3 verify.py [TASK_ID ...]``. Exit status is 0 only when all
selected tasks pass. Nothing is written inside the fixture tree.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASKS = ROOT / "tasks"
SIZES = ("trivial", "small", "medium", "large")
PYTEST = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"]
IGNORE = shutil.ignore_patterns("__pycache__", ".pytest_cache", "*.pyc")


def run_pytest(workspace: Path, target: Path) -> subprocess.CompletedProcess:
    """Run pytest on ``target`` with ``workspace`` as cwd, rootdir and path."""
    env = dict(os.environ, PYTHONPATH=str(workspace), PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run(
        [*PYTEST, "--rootdir", str(workspace), str(target)],
        cwd=workspace,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )


def last_line(result: subprocess.CompletedProcess) -> str:
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    return lines[-1] if lines else "(no output)"


def check_meta(task_dir: Path) -> dict:
    meta = json.loads((task_dir / "meta.json").read_text(encoding="utf-8"))
    if set(meta) != {"id", "size", "prompt", "note"}:
        raise AssertionError(f"meta.json keys are {sorted(meta)}")
    if meta["id"] != task_dir.name:
        raise AssertionError(f"meta id {meta['id']!r} != directory name")
    if meta["size"] not in SIZES:
        raise AssertionError(f"unknown size {meta['size']!r}")
    if not meta["prompt"].strip() or not meta["note"].strip():
        raise AssertionError("prompt and note must be non-empty")
    for name in ("workspace", "reference", "hidden/test_hidden.py"):
        if not (task_dir / name).exists():
            raise AssertionError(f"missing {name}")
    return meta


def verify_task(task_dir: Path) -> list[str]:
    """Return report lines for one task; raise AssertionError on failure."""
    meta = check_meta(task_dir)
    report = [f"{meta['id']} ({meta['size']})"]
    with tempfile.TemporaryDirectory(prefix="delegation-calibration-") as tmp:
        workspace = Path(tmp) / "workspace"
        hidden = Path(tmp) / "hidden" / "test_hidden.py"
        shutil.copytree(task_dir / "workspace", workspace, ignore=IGNORE)
        hidden.parent.mkdir()
        shutil.copy2(task_dir / "hidden" / "test_hidden.py", hidden)

        baseline = run_pytest(workspace, hidden)
        if baseline.returncode == 0:
            raise AssertionError("hidden tests pass on the starting workspace")
        report.append(f"  baseline hidden:  FAIL as expected ({last_line(baseline)})")
        if (workspace / "tests").is_dir():
            start = run_pytest(workspace, workspace / "tests")
            status = "PASS" if start.returncode == 0 else "FAIL"
            report.append(
                f"  baseline visible: {status} ({last_line(start)}; informational)"
            )

        shutil.copytree(
            task_dir / "reference", workspace, ignore=IGNORE, dirs_exist_ok=True
        )
        solved = run_pytest(workspace, hidden)
        if solved.returncode != 0:
            raise AssertionError(
                "hidden tests fail with reference applied:\n" + solved.stdout
            )
        report.append(f"  reference hidden: PASS ({last_line(solved)})")

        visible = workspace / "tests"
        if visible.is_dir():
            result = run_pytest(workspace, visible)
            if result.returncode != 0:
                raise AssertionError(
                    "visible tests fail with reference applied:\n" + result.stdout
                )
            report.append(f"  reference visible: PASS ({last_line(result)})")
        else:
            report.append("  reference visible: none")
    return report


def find_residue() -> list[Path]:
    names = {"__pycache__", ".pytest_cache", ".ruff_cache"}
    return sorted(p for p in ROOT.rglob("*") if p.is_dir() and p.name in names)


def main(argv: list[str]) -> int:
    selected = set(argv)
    task_dirs = sorted(
        d
        for d in TASKS.iterdir()
        if d.is_dir() and (not selected or d.name in selected)
    )
    unknown = selected - {d.name for d in task_dirs}
    if unknown:
        print(f"unknown task ids: {', '.join(sorted(unknown))}")
        return 2

    failures = []
    sizes: dict[str, int] = {}
    for task_dir in task_dirs:
        try:
            report = verify_task(task_dir)
        except (AssertionError, json.JSONDecodeError, KeyError) as exc:
            failures.append(task_dir.name)
            print(f"FAIL {task_dir.name}: {exc}")
            continue
        size = json.loads((task_dir / "meta.json").read_text(encoding="utf-8"))["size"]
        sizes[size] = sizes.get(size, 0) + 1
        print("PASS " + "\n".join(report))

    residue = find_residue()
    if residue:
        failures.append("residue")
        print("FAIL cache directories left in fixture tree:")
        for path in residue:
            print(f"  {path.relative_to(ROOT)}")

    mix = ", ".join(f"{size}={sizes.get(size, 0)}" for size in SIZES)
    passed = len(task_dirs) - len([f for f in failures if f != "residue"])
    print(f"\n{passed}/{len(task_dirs)} tasks verified; size mix: {mix}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
