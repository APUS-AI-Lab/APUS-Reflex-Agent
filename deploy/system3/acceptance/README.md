# System3 browser acceptance

English | [中文](README.zh.md)

`accept.py` checks a System3 deployment the way a person uses it: it types into the public site through the gstack browse binary, then checks what the person sees (dock lines, terminal cards) and what the Session log records. Run it after every release; a scenario passes only when all of its checks pass.

```sh
python3 deploy/system3/acceptance/accept.py                 # all scenarios
python3 deploy/system3/acceptance/accept.py goal-interrupt  # one scenario
```

| Scenario | What a person does | What must hold |
|---|---|---|
| `routing` | Asks for a translation, then a reasoning question | Two entry decisions; the translation is answered by `deepseek-flash`, the reasoning question by a stronger model |
| `folding` | Asks why a unittest run with five identical failures fails | A `system3/output-fold` was applied; the terminal card marker quotes the repeated first line; the answer names the shared cause |
| `task-frame` | Sets a task, adds a requirement, continues, then switches topic | The dock shows one kept requirement; the model received the task card; the card leaves the dock and a new frame starts after the switch |
| `goal-interrupt` | Starts a `/goal`, then interrupts the running round | The dock reports the requirement added to the running turn; after reading the interruption the model renames the test file before running tests; the goal completes; the workspace holds `check_ledger.py` |
| `codex-forward` | Hands a task to Codex, then adds a requirement while Codex runs | The Codex card lists the forwarded text; `system3/interjection` records `forwardedTo: codex`; Codex produces `check_ledger.py` |

`goal-interrupt` answers a question card with its first option, as the recommended choice. Scenarios that write files use `goal-check` or `fold-check` under the service workspace and remove them afterwards.

## Release and accept

`deploy/system3/ship.sh` runs both steps from a workstation: it refuses uncommitted tracked changes and an unpushed HEAD, releases HEAD to the host as `<prefix>-<first ten characters of the commit>`, waits for `release.sh` to print `Deployed`, prints the release log and exits on failure, then runs this suite with any scenario names given after the prefix.

```sh
deploy/system3/ship.sh s3-frame
```

## Requirements

- An SSH alias for the deployment host (`SYSTEM3_HOST`, default `prd`); the script reads Session logs and, when the browser is signed out, the latest launch token from the service log. It writes the launch URL to `~/.config/xdan-system3/public-launch-url` with mode 600 and never prints it.
- The gstack browse binary (`BROWSE`, default `~/.claude/skills/gstack/browse/dist/browse`).
- `SYSTEM3_SITE` overrides the site URL; `ACCEPT_OUT` sets the directory for screenshots and browser state.

Model answers vary between runs, so the checks assert facts that the deployment guarantees (events, files, dock text) rather than exact wording.
