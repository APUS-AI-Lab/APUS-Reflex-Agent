# system3-delegation-progress todo

Base: branch `feat-system3-g1`. Order follows [architecture section 11](../../docs/feat-system3-g1/architecture.html#next).

## Slice 0 · entry evaluation

- [x] Update the unified architecture page (sections 02, 05, 07, 08, 10, 11) and re-scope the recovery plan.
- [x] Labelled task set: `packages/experimental/system3/tests/fixtures/entry-routing-eval.tasks.json`.
- [x] Real-Jev evaluation: `packages/experimental/system3/tests/entry-routing-eval.e2e.ts`, self-skipping without `JEV_API_KEY`.
- [x] Run it and record the report under `docs/system3-delegation-progress/`.

## Slice 1a · provider activity (live)

- [x] `reportActivity` on the provider start request; the seam publishes `subagent/activity` only between a run's start and end.
- [x] Codex provider reports item categories from `item/started` and `item/completed`; Claude Code provider reports assistant blocks and tool calls.
- [x] Redacted summaries only (category and phase); a malformed `item/started` is skipped and never fails the run.
- [x] AG-UI forwards `CUSTOM dsh.subagent.activity` and now follows out-of-process runs by their delegating parent.
- [x] Unit tests, README updates in both languages, regenerated catalogs, `doc-sync` 42 / 42, `typecheck`.
- [x] Real Codex run observed through the production provider: start, reasoning, command, message, end, in order.
- [ ] Real Claude Code run observed end to end.

## Entry tiers and follow-up retention

- [x] `retainOnAbstain`: abstain and low confidence continue the previous route when it is still an admitted candidate; receipts record `retained`; persistence change `2026-10-02-system3-entry-retained-route`.
- [x] Deployed profile: four tiers (deepseek-v4-flash, deepseek-v4-pro, gpt-5.6-sol-relay, gpt-6-sol-relay) through Fidoo; GPT relay models use a separate `fidoo-relay` provider.
- [x] Four-tier evaluation: 29 / 30 decisions match labels; p50 482 ms.
- [x] Architecture page section 07: layered entry design, tier table, image-input handling.
- [ ] Image input: modality filter before Jev; update deployed input modalities (Flash and both GPT relays read images, Pro does not).
- [ ] Not yet deployed to the server or Desktop.

## Speed and delegation (2026-10-02)

- [x] Jev connection pool (`keepAliveMs`, `http2`) and System3 `keepWarm`; warm decisions 0.44–0.50 s, in-app 0.49–1.25 s on this Mac.
- [x] Candidate `label`; route notice the moment the decision is recorded; stale notice hidden while a newer submission is pending.
- [x] Delegation candidates (`delegate: { provider, tool }`), one `system3-delegation` instruction, suggested / injected / called stages.
- [x] Real Web run: coding task routed to Codex in 0.69 s, instruction injected, `subagent_codex` called, fix and 4 tests added, 5 / 5 pass, 108 s total.
- [ ] Delegation threshold: the model itself called the task a one-line fix; compare Flash / always-delegate / Jev on small and large coding tasks.
- [ ] Python SDK snapshot verified only by hand-patching the committed log (the local runtime build bundles Office skills); CI must confirm.

## Slice 1b · delegation progress card

- [x] `delegationProgress`: start, throttled running, and end snapshots as `system3/delegation-progress` in the delegating Agent's Session; persistence change recorded.
- [x] Projection `subagentRun` and the dock progress line with locally advancing elapsed time.
- [x] Real Web run: slugify task delegated to Codex; the line updated every 2 s from start to "finished · 152 s" (reasoning 7, messages 7, commands 8, file changes 2); 25 snapshots; 8 / 8 tests pass; the line is restored after a page reload.
- [ ] The main model read files for about 25 s before calling `subagent_codex`; tighten the instruction so delegation starts at once.
- [ ] Codex reported no step for its first ~26 s; only the running timer shows then.

## Perceived speed and delegation monitoring (2026-10-02)

- [x] ui-chat `conversation.chat.turnHead`; System3 route line in the Turn header; fallback notices.
- [x] Dock phases: preparing hand-off, starting, running, checking result; minutes-and-seconds durations.
- [x] Activity notes (child's own progress text, 200-character bound); `delegationProgress.monitor` alerts for slow start, stall, and overtime.
- [x] Real Web run with low thresholds: starting alert at 16 s, keep-waiting dismissed it, notes showed Codex's plan and file scope, overtime alerts at 1 min and 2 min, stop ended the Turn within 2 s ("codex stopped · 16 s").
- [ ] Expected-duration labels, end summary in `turnTail`, short follow-ups skipping Jev.
- [ ] 8.2 composer model chip (not decided).
- [ ] Browser or desktop notification when the page is not visible.
- [x] Delegated Codex reads a service-owned `CODEX_HOME` (`deploy/system3/codex/config.toml`, Fidoo Responses API, gpt-5.6-sol-relay); committed. Real Web run: routed to Codex, wordcount task done, 8 / 8 tests pass, nothing written outside the private home.
- [ ] That run's first step took 5 min 39 s: Codex's first 5 POSTs to Fidoo each failed at the connection layer after ~62 s (`logs_2.sqlite`, `error sending request`), then succeeded. Same config via `codex exec`: 11 s and 27 s. Local network path (Clash TUN, fake-IP 198.18.x), not configuration; re-measure on the server.
- [ ] Server unverified: Codex's own Linux command sandbox on a kernel without Landlock; release.spec.sh not rerun (needs the server's Docker).
- [ ] Locally, Codex shell commands still source the user's `~/.zshenv` (login shell); the server's private HOME has none.
- [x] Mid-run steer: design `docs/system3-delegation-progress/steer-design.html`, awaiting approval.

## Slice 2 · delegation supervision

- [ ] Design only after slice 0 and 1 results.

## Review · 2026-10-02

- Slice 0: 50-input evaluation run twice against the deployed Jev with identical decisions; results in `docs/system3-delegation-progress/entry-eval.md`.
- Slice 1a: touched files in the three subagent packages stay at 100% coverage; 990 tests across subagent, AG-UI, scope and System3 pass.
- `test:snapshot`: 177 pass; `browser-use-stagehand-native` fails in this worktree with a Node loader-hook error inside its fixture, in code this branch does not touch. Not yet compared against the base branch.
- `packages/experimental/agui/src` is below the per-file coverage threshold before and after this change.
- Real Codex run (bundled CLI, local ChatGPT login, model `gpt-5.5`): the first step arrived about 22 s after start, so a progress view needs a visible started state before any step. The local default model `gpt-6.1-sol` is rejected by the bundled CLI for ChatGPT accounts; the provider needs an explicit `model`.

## Mid-run steer (approved 2026-10-02; parent model does not see steers; Claude Code later)

- [x] dsh-subagent: `SubagentRun.steer?`, `SubagentRunInfo.steerable`, live steerable-run registry in `observeRun`, `@Remote('steerByParent')`, parent Session event `subagent/steer`, `subagent/not-steerable` error.
- [x] subagent-codex: `turn/steer` with `expectedTurnId`; reject before turn start / after completion / after close.
- [x] System3: progress snapshot `steerable`; projection `subagentRun.steerable` and `steers` (latest 3); stateVersion 8.
- [x] Client: DelegationRun steer input + sent list + failure notice; zh/en copy; inject `remote.subagents`.
- [x] Persistence records, READMEs, architecture section 05, SDK expected outputs / snapshots.
- [x] Gates + real Web run: steer a running Codex and observe adoption.
- Real Web run (personal Codex login, gpt-5.5): TaskQueue task delegated; at 21 s into the run a steer asked for an extra `snapshot()` method; the card showed "Added at 21 s" 0.4 s after send; Codex implemented `snapshot()` with tests, 35 / 35 pass; the steer line survived a page reload. A smaller task (textstats) finished before a steer could be sent, so simple delegations often last under a minute.
- Gates: typecheck, lint, doc-sync 42/42, hygiene 18/18, 100 % coverage on changed files. `test:snapshot` and `packages/experimental` have failures only in browser-use-stagehand-native (Node load hook returns no source); the same test fails on main.

## Server probes, delegation calibration, composer marker (2026-10-03)

- [x] Server probes without releasing: Jev p50 274 ms / p95 406 ms on a reused connection; Codex 0.153.4 under the unit's hardening fixed a file in 38 s, and its sandbox refused a write outside the workspace. `CODEX_HOME` must not be under `/tmp`.
- [x] Three-arm calibration (10 tasks x 2 runs, hidden tests): Flash alone and always-delegate both 20/20, median 36 s vs 203 s; Jev under the old wording delegated 8/10. Deployed Codex wording tightened; repository-scale probes still delegate 2/3. Four-tier eval unchanged at 29/30.
- [x] Composer chip: verified in Web that a routed turn already showed the routed model; added an Auto caption during the routed turn (verified: "Auto gpt-5.6-sol-relay Medium" during, "deepseek-v4-flash Low" after).
- [x] Released the `s3-delegation` release to root@litellm on 2026-10-03 (release cases 8/8 first; rollback target the `g1-stable` release). Online browser e2e: Flash / Pro / GPT-5.6 routes correct, follow-up retained, in-product decisions 638-1039 ms, route line 1.2-1.45 s with tunnel; explicit Codex delegation 374 s, steer 0.7 s, stalled + overtime alerts, hidden tests 13/13.
- [ ] GPT-5.6 Sol through the Fidoo relay streams about 18 tok/s; a 10k-token design answer took 553 s. Consider an output budget or a faster expert route.
- [ ] An explicit "交给 Codex" request got Jev low-confidence (baseline); the main model still delegated. Add the explicit-intent rule.
- [ ] Stall alert fired during 90 s of Codex reasoning without a step; consider a longer stallMs for reasoning-heavy runs.
- [ ] Tier routing for coding tasks: GPT-5.6 Sol took 321-581 s on two large tasks Flash did in 68-117 s; calibrate tiers separately.
- [ ] Tasks Flash fails, to measure where delegation pays off.

## Moved to prd (2026-10-03)

- [x] Deployed the `s3-delegation` release with explicit delegation to `prd` (release cases 8/8). Online: Flash / Pro routes correct; "交给 Codex" delegated without Jev (`explicit: true`), 389 s, hidden tests 13/13.
- [x] Removed the System3 deployment from `litellm` (service, unit, 5 images, releases, data, credentials, user); data archive kept at `/root/xdan-system3-data-backup-20261003.tgz` there; other services unaffected; disk 83% -> 59%.
- [x] Steers are restated to the main model: the run result lists accepted `steers` and the delegation tool appends them to its result; rerun on `prd` kept the README, hidden tests 13/13.

## Pilot top three in System3 (approved 2026-10-04: all three; supervision advises only; degraded routes are avoided with a notice)

- [ ] Supervision: repeated error >= 2, failed attempts >= 3, no progress for K steps, Codex command failures >= 3 (new `outcome` on subagent activity), missing acceptance evidence after file changes or delegation; `system3/supervision` event; post-execute nudge in advise mode; dock notices.
- [ ] Route health: passive first-token / throughput / error samples per route, idle probes, degraded candidates excluded from entry routing with a recorded reason and route-notice text.
- [ ] Hand-off pack: Jev classifies recent user messages as constraint / background / unrelated; constraints appended verbatim to the delegation instruction; `system3/handoff-pack` event; constraint-retention comparison.
- [ ] Persistence records, READMEs, architecture doc, tests (100% changed files), gates, prd release, online acceptance.
