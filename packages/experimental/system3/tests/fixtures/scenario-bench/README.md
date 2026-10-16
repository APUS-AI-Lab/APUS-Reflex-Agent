# Reflex scenario benchmark

English | [中文](README.zh.md)

This benchmark runs the same tasks natively and with Reflex pre-decisions against the real DeepSeek API and the deployed Jev, and compares wall time, main-model steps and success. Each task runs in a fresh Headless session in its own workspace and has a deterministic success check on the answer or on the workspace after the turn. Results feed the [Reflex pre-decision research frame](../../../../../../docs/research-reflex-predecision/README.md#results).

## Files

| File | Purpose |
| --- | --- |
| `driver.ts` | Builds the workspaces, runs the selected tasks under one overlay, and prints one `RUN {…}` JSON line per run |
| `native.patch.yml` | Native arm: the shipped Headless profile with `deepseek-flash`, native Skill discovery, no Reflex |
| `reflex.patch.yml` | Reflex arm: the native setup plus Jev (HTTP/2, one question per parallel request), prefetch and Skill selection |
| `suite.ts` | Runs arms in interleaved rounds, writes JSON Lines, and prints the summary |
| `analyze.ts` | Summarizes one or more JSON Lines files |

## Tasks

The `project` suite works in a 40-file JavaScript service in a Git repository with staged changes and two Skills (`commit-message`, `changelog`) that state no `whenToUse`. The `personal` suite works in a personal folder that is not a repository: calendar, flights, expenses, todos, mail, meeting notes, contacts and documents, mostly in Chinese.

| Suite | Category | Task ids |
| --- | --- | --- |
| project | chat | `chat-capital`, `chat-joke` |
| project | facts | `facts-version`, `facts-refund`, `facts-pool` |
| project | locate | `locate-refund`, `locate-page-size`, `locate-stock` |
| project | changes | `changes-commit`, `changes-review` |
| project | skill | `skill-commit`, `skill-changelog` |
| project | edit | `edit-page-size`, `edit-refund-window` |
| project | chinese | `zh-version`, `zh-refund` |
| personal | p-chat, p-schedule, p-finance, p-todo, p-mail, p-notes, p-lookup | `p-chat`, `p-calendar`, `p-flight`, `p-expense`, `p-overdue`, `p-reply`, `p-meeting`, `p-contact`, `p-passport` |
| personal | p-edit | `p-add-todo` |

## Running a comparison

Tutorial: one comparison from credentials to a recorded result. Commands run from the repository root.

1. Put `DEEPSEEK_API_KEY`, `JEV_ENDPOINT`, `JEV_MODEL` and `JEV_API_KEY` in the root `.env`, which Git ignores, and load it into the shell with `set -a; . ./.env; set +a`. Never print or commit the values.
2. Choose tasks with `SCENARIO_ONLY`, a comma-separated list of task ids, categories or suites; leave it unset to run all 26 tasks. Every run calls both paid APIs, so select the tasks the change affects.
3. Run both arms in interleaved rounds: `SCENARIO_ONLY=edit,skill,p-edit node --import tsx/esm packages/experimental/system3/tests/fixtures/scenario-bench/suite.ts <out.jsonl> 3 native reflex`. Each round runs every arm once, so both arms meet the same provider load. Use at least 2 rounds, and 3 for edit and Skill tasks, whose main-model step counts vary between runs.
4. Read the printed summary: per-category totals, medians, the ratio of mean durations, main-model steps and success, then Jev decision times, the prefetched items and Skill outcome of each Reflex run, failures, stalled runs and per-task durations. `node --import tsx/esm packages/experimental/system3/tests/fixtures/scenario-bench/analyze.ts <a.jsonl> <b.jsonl>` summarizes several files together, for example native runs from one batch with Reflex runs after a change.
5. Record the result in the research frame's Results table with the date, task selection and rounds, and update the package README when the measured behavior changes.

Keep source files unchanged while a run is in progress: each arm loads the System3 source when it starts, so an edit during a run mixes versions inside one result.

## Variables

Reference: environment variables read by the scripts.

| Variable | Read by | Effect |
| --- | --- | --- |
| `SCENARIO_ONLY` | `driver.ts` | Comma-separated task ids, categories or suites to run |
| `SCENARIO_REPEATS` | `driver.ts` | Repeats inside one driver process; `suite.ts` rounds interleave arms instead |
| `PREFETCH_YES` | `reflex.patch.yml` | Prefetch `yes` threshold, default `0.5` |
| `SCENARIO_STALL_MS` | `suite.ts`, `analyze.ts` | Runs at or above this duration are listed as stalled and left out of all totals, default `300000`. The DeepSeek API occasionally holds a main-model call for 10–15 minutes without an error. |

## Run fields

Reference: each JSON line holds `arm`, `pass` (round), `id`, `suite`, `category`, `ms`, `success`, `steps` (assistant messages), `tools` (tool names in call order), `reflex` (prefetch outcome and decision time), `prefetched` (candidate ids injected), `skill` (Skill outcome, selected name and decision time), `stepTimes` (per step, `llm` from step start to the assistant message and `tools` from that message to the next step), `error` and the first 100 characters of `answer`.

## Iteration procedure

Tutorial: one change to a pre-decision mechanism, measured.

1. Change one mechanism, so a difference in the result has one cause.
2. When the change alters a question sent to Jev, run the decision-only Skill evaluation first: `SKILL_EVAL_FORMS='choice + yes confirmation (product)' SKILL_EVAL_THRESHOLDS=0.5 node --import tsx/esm packages/experimental/system3/tests/fixtures/skill-eval/eval.ts`, once with `SKILL_EVAL_NO_WHEN` unset and once each with `1` and `half`. Jev answers change with small wording changes, so keep a wording only when the labelled score does not fall where it matters for the change.
3. Run the unit tests of the package with `pnpm exec vitest run packages/experimental/system3`.
4. Run the affected tasks with `suite.ts` as above, both arms, the same rounds.
5. Read `stepTimes` of slow Reflex runs: a long first `llm` time means the injected facts made the prompt longer, extra `read` or `grep` tools before an edit mean prefetch missed the file, and a Skill outcome on a task that needs none means a false selection.
6. Record the result, including runs that got slower.

The deployed Jev gateway rejects a choice question with more than 16 options (HTTP 422) and limits concurrent requests to about 48 (HTTP 429); a change that adds questions stays within both limits.
