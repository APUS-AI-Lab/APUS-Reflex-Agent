# Delegation calibration fixtures

English | [中文](README.zh.md)

These fixtures calibrate the delegation threshold: each task is a realistic Python coding request of graded size (trivial, small, medium, large) with hidden acceptance tests, so the same task can be run through each arm (the fast model working directly with shell and file tools, or delegation to the Codex agent) and compared on pass rate and wall time.

## Layout

Each `tasks/<id>/` directory contains `meta.json` (`id`, `size`, the Chinese user `prompt`, and an English `note` explaining the size), `workspace/` (the starting project the agent edits; Python 3.12 standard library plus pytest), `hidden/test_hidden.py` (acceptance tests the agent never sees), and `reference/` (files that, copied over `workspace/` at the same relative paths, form a correct solution).

Hidden tests run with a copy of the workspace as the current directory, pytest rootdir, and `PYTHONPATH`: `cd <workspace-copy> && PYTHONPATH=. python3 -m pytest -q -p no:cacheprovider --rootdir . <path>/test_hidden.py`. A task passes an arm when that command exits 0 after the agent finishes; visible tests under `workspace/tests/` are part of the task where the prompt says so.

The agent receives only `meta.json`'s `prompt` and a copy of `workspace/`. Never expose `hidden/` or `reference/` to the agent under test.

## Verification

Run `python3 verify.py` from this directory (or pass task ids to check a subset). For every task it validates `meta.json`, requires the hidden tests to fail on an untouched workspace copy, then overlays `reference/` and requires the hidden tests and any visible tests to pass. It works in temporary directories, disables bytecode and pytest caches, and fails if any `__pycache__`, `.pytest_cache`, or `.ruff_cache` directory exists in the fixture tree.

## Running the arms

`probes/*.json` hold decision-only repository-scale prompts that `delegation-calibration-decisions.e2e.ts` routes together with the tasks. `run_arms.py` answers each task through `dsh headless` under one patch per arm (`<arm>.patch.yml`), with an isolated home and a fresh workspace copy, and appends one record per run with time, main-model tokens, tool calls, and the hidden-test result. `summarize.py` composes the Jev arm from a decisions report and prints the comparison. Results are in [the calibration report](../../../../../../docs/system3-delegation-progress/delegation-calibration.md).
