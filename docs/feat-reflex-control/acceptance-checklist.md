# APUS Reflex Harness acceptance checklist

English | [中文](acceptance-checklist.zh.md)

## Summary

This page is the requirements and acceptance entry point for `feat-reflex-control`, covering product acceptance, implementation completion, and session handoff. Results were checked on 2026-10-11 against the pushed Harness and Frontend `feat-reflex-control` revisions; they do not describe main or a signed/notarized release. Designs, source, and trial records retain their respective responsibilities. This page defines what must be observed before an item is complete without copying the underlying reports.

Current conclusion: representative real routing and settings scenarios, Harness line omission and restart recovery, controlled native-silence recovery, the narrow controlled repeated-failure scenario, the Host20 controlled semantic-drift correction, the four-condition real cross-process C-06 pair, and the unsigned macOS arm64 Electron directory-package settings flow have passing evidence. Healthy long-task false-intervention control, mid-task requirement changes, page-level 200% zoom, signed/notarized packaging, and merging remain incomplete. The Electron recovery UI has separate passing 200% system-scale evidence. The three core capabilities cannot all be marked accepted.

## Table of Contents

- [Requirements and designs](#acceptance-design)
- [Verdict rules](#acceptance-rules)
- [Acceptance cases](#acceptance-cases)
- [Complete user journeys](#acceptance-journeys)
- [Evidence and execution order](#acceptance-evidence)
- [Release completion criteria](#acceptance-release)

<a id="acceptance-design"></a>

## Requirements and designs

Existing proposals own capability design, cache constraints, and recovery rules. This checklist owns acceptance status; update it first and link it from the handoff.

| User objective | Design owner | Acceptance IDs |
| --- | --- | --- |
| Select a model or agent for each request | [Complete design](reflex-complete-design.html), [Goal entry design](goal-routing-design.html) | R-01–R-04 |
| Observe long Codex tasks, correct them, and verify improvement | [Semantic supervision](supervision-semantic-design.md), [native recovery](recovery-addendum.md), [verification targets](verification-target-design.md) | S-01–S-09 |
| Omit irrelevant context lines or fragments and restore needed facts | [Context implementation](reflex-context-implementation.md), [cache protection](context-cache-design.md) | C-01–C-07 |
| Provide a dedicated Reflex configuration page whose settings take effect | [Settings design](reflex-settings-proposal.html) | F-01–F-03 |
| Deliver APUS branding, MIT compliance, and both repositories | [Brand guidelines](../../BRAND_GUIDELINES.md), [worktree handoff](../../tasks/feat-reflex-control/handoff.md) | D-01–D-04 |
| Let users understand, operate, and control the complete task | UI/UX acceptance below; real interaction evidence for shared settings and task screens | UX-01–UX-10 |

<a id="acceptance-rules"></a>

## Verdict rules

Evidence has distinct levels. “Real passed” covers only the named real scenario. “Regression passed” means deterministic tests or controlled SDK replay, not a real-model pass. “Failed” means a trial did not satisfy its criteria. “Pending” means evidence is missing. One success establishes neither general reliability nor the invalidity of earlier failures.

P0 items are required for complete functional delivery. P1 items validate performance or wider claims; those claims remain unavailable until acceptance. Deterministic regressions can accept race and error paths, but complete journeys for the three core capabilities also require real models and user-entry evidence. Performance targets cannot be chosen retrospectively to fit results.

<a id="acceptance-cases"></a>

## Acceptance cases

Each row gives the user scenario, pass conditions, and current evidence. “Regression passed; real pending” remains incomplete.

### User entry routing

| ID / priority | Scenario and pass conditions | Evidence and remaining gap |
| --- | --- | --- |
| R-01 / P0 | The user asks for 0.10 yuan plus 0.20 yuan. Reflex decides first, generation uses the selected model, and the answer is 0.30 yuan. | Real passed; routing in the [browser record](evidence/browser-progress.json) and [screenshot](evidence/reflex-ux-routing.png). New evidence linked here supersedes the other sections of that older report. |
| R-02 / P0 | The user sets a Goal asking Codex to add JSON output to an aging tool. First-turn delegation occurs, original CSV stays intact, and new output plus existing behavior pass independent verification. | Real browser passed; [independent report](evidence/browser-goal-json-independent.json), [10 tests](evidence/browser-goal-json-tests.log), and [completed screenshot](evidence/reflex-goal-json-completed.png). |
| R-03 / P0 | Judgment fails, abstains, or has no admitted candidate. Apply configured failure handling without unauthorized routing or lost input; define and verify precedence between manual selection and automatic routing. | The [controller manual-selection protections](../../packages/api/session-controller/tests/prompt-router.host.spec.ts), [entry](../../packages/experimental/system3/tests/entry-routing.spec.ts), and [Goal regressions](../../packages/experimental/system3/tests/goal-entry-routing.spec.ts) passed 93 tests. The [real browser routing record](evidence/browser-manual-routing.json) also passed fixed-model selection, return to automatic, manual precedence, and matching completed requests. Visible failure/no-candidate paths remain pending; the record is from a dirty development build. |
| R-04 / P1 | Compare automatic routing with a fixed model on a fixed simple, complex, ambiguous, and explicit-delegation set; measure correctness, added entry delay, first visible output, and total time. | [Local admission/status](evidence/r04-admission-status-queue.md) passed at 16 ms, and [local user-echo performance](evidence/r04-local-echo-perf.md) stayed below 1,000 ms through short, business, and long inputs at normal and 6× CPU throttle. [Real Jev evaluation v2](evidence/entry-routing-eval-v2.md) reports route-decision p50/p95 of 309/588 ms (two-tier, 50 tasks) and 317/405 ms (four-tier, 30 tasks), with no transport failures. Remote first byte, full answer time and visible fallback remain pending. |

### Long Goal supervision and correction

| ID / priority | Scenario and pass conditions | Evidence and remaining gap |
| --- | --- | --- |
| S-01 / P0 | Codex repeatedly fails or repeats ineffective actions. After sufficient evidence, Reflex proposes a correction, Codex consumes it, performs a useful repair and relevant verification, and completes normally. | The narrow controlled repeated-failure journey passed: [sanitized evidence](evidence/supervision-real-repeated-failure.md) records three failed verification operations, attributed advice, sanitized native input lifecycle events, subsequent diagnostic/file-change/verification evidence, protected-file hashes, and normal completion. This is a controlled `semantic=false` scenario with non-release thresholds; semantic drift remains pending and the earlier aborted steer trial stays in [validation](supervision-validation.md). |
| S-02 / P0 | Observe prolonged lack of progress; do not repeatedly pay to judge unchanged evidence. New evidence permits reassessment, and elapsed time alone does not classify healthy work as wrong. | [Supervision regressions](../../packages/experimental/system3/tests/reflex-supervision.spec.ts) passed. The [latest real controls](evidence/healthy-codex-20261011.md) cancelled at the 150-second budget with zero steers; the literal relay received no first byte. This is not a completion pass, and the deployment-default healthy long-task control remains pending. |
| S-03 / P0 | A native request is silent with no pending side effect or approval. Reflex authorizes interruption, the adapter confirms the interrupted terminal, resumes the same thread, and obtains completed plus independent verification. | Controlled real passed in 127.41 seconds; [v4 report](evidence/native-recovery-real-v4.json). The actual cancellation budget was 180 seconds; the legacy 150-second report field does not apply, as explained in [validation](supervision-validation.md). This does not cover every uncontrolled production failure. |
| S-04 / P0 | A finance Goal repeatedly produces unrelated marketing changes. Reflex detects sustained drift even when each action succeeds and brings Codex back; relevant investigation and insufficient evidence do not trigger false correction. | [Host20 controlled real trial](evidence/semantic-codex-host20-persistent.md) recorded a stale fence, accepted realignment, post-consumption finance work, and independent completion. Historical failures remain in [Host16](evidence/semantic-codex-host16.md) and [Host19](evidence/semantic-codex-host19-persistent.md); natural healthy-task and mid-run Goal-change comparisons remain separate. |
| S-05 / P0 | Automatic advice has an identifiable source. Record decision, delivery ACK, and native Codex input consumption separately, followed by new execution evidence. | The controlled repeated-failure report contains a separate Reflex judgement, `accepted` state, attributed `subagent/supervision-steer`, sanitized native `item/started` and `item/completed` lifecycle events, and post-advice diagnostic/file-change evidence in [evidence](evidence/supervision-real-repeated-failure.md). This satisfies the receipt/consumption requirement for that controlled scenario; semantic drift still needs its own journey. |
| S-06 / P0 | After correction, a successful Goal-related verification produces a real verification-target and Reflex assesses improvement. Reading tests, echoing a test name, or unrelated verification cannot count. | [Host20](evidence/semantic-codex-host20-persistent.md) contains a successful structured `verification-target` for `finance/test_remaining.py`, independent `1137.41` validation, and `improved`. The controlled repeated-failure report remains separate evidence without a structured target. |
| S-07 / P0 | The user adds Chinese columns and compatibility constraints mid-task, or changes/cancels the Goal. Stale judgments, queued controls, and late ACKs cannot override intent; budgets and cooldowns survive restart. | Human-priority, revision, and late-ACK [regressions passed](../../packages/experimental/system3/tests/reflex-supervision.spec.ts); a real mid-task request change with final-artifact acceptance remains pending. |
| S-08 / P0 | Without approval to transmit workspace data, use only admitted evidence. Do not send raw commands, output, diffs, or reasoning to Reflex; unknown receipts cannot cause blind repetition of side effects. | [Collection regressions](../../packages/subagent/subagent-codex/tests/evidence-summary.spec.ts) and [supervision regressions](../../packages/experimental/system3/tests/reflex-supervision.spec.ts) passed. Accept permission rejection and inspected payloads; do not require a real leak. |
| S-09 / P0 | Complete S-01–S-06 with the release configuration and report observation window, recovery threshold, model, and effort. Remain conservative when evidence is incomplete. | Host20 used the semantic deployment parameters (`intervalMs=15000`, `stallMs=180000`, `feedbackMs=60000`, `maxInterventions=3`, `effort=low` on the Codex relay) and produced a complete controlled S-04/S-06 chain. A healthy long-task false-intervention comparison and mid-run user Goal change remain pending. |

### Dynamic context, memory, and cache

| ID / priority | Scenario and pass conditions | Evidence and remaining gap |
| --- | --- | --- |
| C-01 / P0 | Read six separate documents in one step. Omit an irrelevant old-trip line while retaining invoice/payment amounts, precision, and original-file constraints. Produce 1137.41 yuan using exactly six reads. | [Host16 real browser passed](evidence/browser-context-v3.json) without extra memory calls. Earlier necessary-data omission and unnecessary retrieval failures remain in the [summary](evidence/context-semantic-validation.md). |
| C-02 / P0 | Locate long lines, Unicode, multiple blocks, and mixed omission/restoration accurately. Preserve characters, structured content, tool-call/result pairs, and traceable originals. | [Context regressions](../../packages/experimental/system3/tests/reflex-context.spec.ts) passed. Real E2E demonstrates ordinary line selection, not every document format. |
| C-03 / P0 | Fully exit Host, reopen the same session, and ask for the omitted trip's hotel, breakfast, time, and location. Restore automatically before the first main-model request without file rereads or network search. | [Real passed](evidence/browser-context-v3.json): four correct facts, zero tool calls, unchanged input hashes and 44 earlier events; [screenshot](evidence/reflex-context-v3-restored.png). |
| C-04 / P0 | Keep submitted prefixes and generated model content unchanged. Failure, cancellation, or restart cannot unfreeze them. Edit only the unsubmitted tail; restore frozen information by appending. | Host16 real journey and [TypeScript](../../snapshots/sdk/reflex-context/) / [Python](../../scripts/snapshots/python-sdk-single-exe/reflex-context/) replay passed. Without exact provider cache boundaries, freeze the entire submitted prefix. |
| C-05 / P0 | Reassess relevance after topic changes while retaining unrevoked permissions and precision constraints. Protect the latest 4 messages, skip safely without candidates or budget, and deduplicate recovery. | [Regressions and limited real v3 probes passed](evidence/context-v3-priority-validation.md). A single latest tool result may remain entirely protected; do not claim every step saves tokens. |
| C-06 / P1 | Compare omission on/off using matched tasks, model, effort, and tools across cold/warm caches, recovery, and route changes. Record provider cache usage, Reflex overhead, total cost, and latency. | Real cross-process pair passed; the [sanitized report](evidence/cache-c06-real.md) covers four conditions, 12 turns, three-process Session recovery, input/persisted-prefix/request-prefix/routing/tool checks, and real `remove` projections. The provider offers no cold-cache isolation, `coldCacheGuaranteed=false`, prices are unknown, so cache-hit or cost benefit is not claimed; Anthropic/OpenAI are not covered. |
| C-07 / scope limit | State what is managed and retained. | Confirmed scope: later Harness requests are filtered and original session logs remain. Codex-private context, unified memory across all sessions, and unlimited physical history are not implemented capabilities that can be checked off. |

### Reflex model settings

| ID / priority | Scenario and pass conditions | Evidence and remaining gap |
| --- | --- | --- |
| F-01 / P0 | Open the dedicated Reflex model configuration page, edit service/model/effort, test, and save. Values survive refresh and full restart, and actual judgments use them. | Passed in the Web flow; the [F-01 sanitized report](evidence/reflex-settings-real.md) confirms the canonical connection decision, expected invalid-model failure, low save, cross-process restart with low, a real request consuming low, and restoration to deployed high. |
| F-02 / P0 | Invalid keys or configuration fail explicitly without overwriting valid saved settings. UI and evidence do not reveal secrets. | [Real invalid-credential screenshot](evidence/reflex-ux-settings-rejected-key.png) and settings regressions passed. A successful connection test does not prove task execution. |
| F-03 / P0 | The final Electron package saves settings in an isolated user directory and retains them after exit/restart. Safe mode starts, normal mode restores settings, and existing user configuration survives. | Frontend configuration-preservation regressions and the unsigned macOS arm64 directory package on `feat-reflex-control` passed normal launch, Reflex settings save/restart, Safe Mode, normal-mode restoration, endpoint/model preservation, and no-secret rendering. The recovery UI passed 40 variants at 200% system scale; [package audit](evidence/electron-package-license-audit.md) confirms brand and MIT/NOTICE retention. Current-runtime parity, signature/notarization, and page-level 200% zoom remain pending. |

### Branding, licensing, and delivery

| ID / priority | Scenario and pass conditions | Evidence and remaining gap |
| --- | --- | --- |
| D-01 / P0 | User-visible branding is APUS Reflex Harness and settings say Reflex. Original MIT copyright, license, and upstream acknowledgements ship with artifacts. | The earlier branding batch is on main; this batch passed MIT checks for 324 Harness packages and third-party notices. The unsigned Electron directory package directly passed brand and four-file MIT/NOTICE comparison in the [package audit](evidence/electron-package-license-audit.md); current-runtime parity and signed/notarized artifact checks remain part of F-03. |
| D-02 / P0 | Logs reconstruct model-visible input, automatic corrections, context projections, and recovery. TypeScript/Python consume matching events; committed historical formats are not overwritten. | Focused regressions, persistence checks, and both SDKs' recording/independent replay for Goal, supervision, recovery, and context passed. External-model fixtures are not real-model E2E. |
| D-03 / P0 | Commit a clean backend version, pin it in Frontend, prepare a real runtime package with a non-dirty manifest, and pass actual startup and configuration flows. | Harness and Frontend `feat-reflex-control` revisions are committed and pushed; the release workflow pins the Harness revision, the deployed runtime manifest reports a matching clean source with `sourceDirty=false`, and the unsigned directory package passed startup/configuration checks. |
| D-04 / P0 | Required checks pass, review has no unresolved blockers, both repositories merge to main as authorized, remote/CI results are verified, and handoff remains available. | In progress; relevant build, lint, Ruff, documentation, and package checks have passing records. Real closed-loop and final-package acceptance still block completion. Missing or queued CI is not a pass. |

### UI/UX acceptance

Operate the visible user entry points without bypassing interactions through internal APIs. Label real-model tasks separately from controlled error/state replays. Replays can validate difficult-to-trigger failure messages but cannot replace real core journeys. Current acceptance targets macOS arm64 browsers and the final Electron package; do not claim other operating systems were tested.

| ID / priority | Scenario and pass conditions | Evidence and remaining gap |
| --- | --- | --- |
| UX-01 / P0 | On first launch, find the workspace, conversation, and Reflex settings. Unconfigured and empty states provide a clear next action without unexplained blanks, developer jargon, or false success. | First-use and empty-state interaction evidence remains pending. |
| UX-02 / P0 | Settings have clear labels and guidance. Invalid addresses, effort, and timeouts identify the affected field. Testing, saving, waiting, success, and failure are distinct; errors preserve saved configuration and hide credentials. | Field-error association and Escape were tested; endpoint/model application, all feedback, and save/restart still need complete acceptance. |
| UX-03 / P0 | Automatic/fixed mode is clear. Recommendations, adopted routes, and actual responses are distinct. Manual switching, returning to automatic, and failure fallback match actual requests. | The [real browser routing record](evidence/browser-manual-routing.json) passed fixed-model selection, return to automatic, manual precedence, and matching requests. Failure fallback and final Electron revalidation remain pending. |
| UX-04 / P0 | Long tasks show stage, elapsed time, and recent useful progress. No progress, approval waits, and healthy work are distinguishable without repeated notices or premature whole-Goal completion after a child ends. | Component regressions cover the Reflex observing state and bounded timeline; real long-task and controlled no-progress states remain pending for the final Electron package. |
| UX-05 / P0 | Users can find guidance, stop/cancel, and keep-waiting actions. Delivery feedback is clear and accidental duplicate submission is prevented. Final work follows added requirements; stopped tasks do not silently continue. | Component regressions exist; actual interactions and final-artifact behavior remain pending under S-07. |
| UX-06 / P0 | Distinguish deciding, sending advice, accepted-but-unverified, unknown delivery, recovering, and verified improvement. Unknown receipts cannot appear as undecided models or successful tasks. | Component regressions and projection checks pass; the monitoring card now shows “Reflex is observing” and the latest 12 content-free timeline entries, and a new user message clears stale improvement state. Final-build UI revalidation remains. |
| UX-07 / P0 | Omission/restoration notices explain that originals remain recoverable. Restored information answers the question without claims of permanent deletion or infinite context; feedback does not obscure input or answers. | Real backend recovery and cross-process C-06 passed; recoverable notices and timeline now have component regressions, while final-package conversation readability remains to be checked. |
| UX-08 / P0 | Network/credential errors, timeouts, disconnection, and restart provide understandable explanations and recovery paths. Preserve input and existing content; users need not read raw logs to proceed. | Bounded error cases and restart experience remain pending. |
| UX-09 / P0 | At widths 375/768/1280, light/dark themes, and 200% zoom, fields/buttons remain usable without page overflow or obstruction. Keyboard order, visible focus, Escape, focus return, and edge-fitting overlays work. | [Initial evidence](evidence/uiux/before.json) retains the 375px failure that compressed fields to about 59px. The [built Web recheck](evidence/uiux/after.json) passed the 375/768/1280 light/dark matrix, keyboard traversal, invalid-field association, Escape, focus return, and zero post-clear console errors. The real Electron recovery UI passed 200% system scaling; page-level 200% zoom remains pending. |
| UX-10 / P0 | The final Electron package supports normal/safe mode, close/reopen, and settings/session recovery. Branding and titles agree, window chrome does not obscure controls, startup failures are recoverable, and owned background processes do not leak. | The unsigned arm64 package passed normal/Safe Mode launch, close/reopen, settings recovery, consistent APUS Reflex branding, and process cleanup. The recovery UI passed 200% system scaling; session recovery, startup-failure recovery, and page-level 200% zoom remain pending. |

<a id="acceptance-journeys"></a>

## Complete user journeys

These journeys supplement individual tests and determine whether complete delivery can be announced. Fix original inputs and independent verification scripts before running; do not loosen outcome criteria during acceptance.

- [x] Configure Reflex in the browser → save low → fully restart → actual requests use low. Covers F-01.
- [x] Submit an aging JSON Goal → first-turn Codex delegation → normal completion → 10 tests and independent amount checks. Covers R-02.
- [x] Omit the old-trip line during finance reconciliation → produce 1137.41 → fully restart → ask about the trip → automatic recovery without prefix changes. Covers C-01, C-03, C-04.
- [x] Hold a native request → Reflex authorizes recovery → confirm interruption → resume the same thread → normal terminal and independent artifact checks. Covers S-03 with explicit fault injection.
- [ ] Repeated failures → Codex consumes automatic advice → relevant structured verification-target succeeds → Reflex confirms improvement → normal completion. The narrow fault run passed repair, artifact, and native input receipt; S-06 target evidence remains incomplete.
- [ ] Successful work drifts from the Goal → Reflex detects it → Codex realigns → complete real verification and improvement feedback; repeat with the deployment window. Covers S-04–S-06, S-09.
- [ ] User adds requirements mid-task → stale correction is invalidated → final output satisfies new requirements and compatibility. Covers S-07.
- [ ] Final clean Electron package → normal and safe mode → persisted settings → representative routing, Goal, and context journeys → both main branches. Covers F-03, D-01, D-03, D-04.
- [ ] First launch → locate workspace/settings → understand automatic/fixed mode → ask a question and recognize actual completion. Covers UX-01–UX-03.
- [ ] Wait for a long task → inspect progress/correction/recovery → add requirements or stop → compare feedback with actual results. Covers UX-04–UX-06.
- [ ] Invalid configuration or connection loss → understand and recover → retain input/settings → resume use after restart. Covers UX-02, UX-08, UX-10.
- [ ] Complete key journeys on narrow screens and at 200% zoom, in light/dark themes, using the keyboard → results and recovery notices remain readable. Covers UX-07, UX-09.

<a id="acceptance-evidence"></a>

## Evidence and execution order

Each real trial records case ID, date, source/artifact identity and dirty status, actual model/effort, configuration differences, original user input, natural or injected conditions, session/run/decision relationships, timing, terminal state, independent artifacts, and failure reasons. Never include secrets or reasoning in the acceptance package. Missing performance fields remain unknown. Preserve all bounded trials; never retry indefinitely and show only a success.

S-06 transport observation without content changes is complete: two actual responses took about 26 and 25 seconds to their first byte, and native command collection plus independent verification passed. Host20 now adds the controlled real correction-loop evidence: accepted realignment, native consumption, structured `verification-target`, independent `1137.41` validation and `improved`. Earlier semantic failures remain retained as failure evidence. Do not install dependencies, build, or rewrite runtime artifacts during a real acceptance window.

After functional loops pass, create a clean backend version, pin Frontend, perform F-03/D-03 and final UI/UX journeys, then review and merge. P1 benchmarks use bounded, predefined matched scenarios; report observations only before evidence exists. The user authorized complete testing and UI/UX acceptance; documentation checks are not product passes.

<a id="acceptance-release"></a>

## Release completion criteria

- [ ] Close every P0 gap and satisfy all complete user journeys above; branch implementation cannot replace final-package acceptance.
- [ ] Each completed status links to evidence for the delivered version. Retain historical failures and distinguish their causes from post-fix validation.
- [ ] Relevant builds, lint, behavior regressions, both SDKs, persistence, and documentation checks cover the final diff; each push satisfies the project's Ruff check and format-check requirements.
- [ ] Both PR/main states match the Frontend runtime version, remote checks and actual startup outcomes are explicit, and handoff lists excluded P1 work and scope limits.

## Dev Note

This page records acceptance for the current worktree. It does not guarantee reliability across every model, platform, or task. Linked designs and source own implementation detail; linked evidence owns test logs.
