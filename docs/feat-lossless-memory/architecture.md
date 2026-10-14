---
description: "Target capabilities of the APUS Reflex Agent Infinity Memory Framework, mapped to the current implementation, with iteration items and acceptance criteria."
---

# APUS Reflex Agent Infinity Memory Framework: capabilities and acceptance

English | [中文](architecture.zh.md)

## Summary

The goal is an APUS Reflex Agent whose context window stays a constant size and is never wiped, loses no original text, and recalls precisely when needed: the Infinity Memory Framework is driven by the APUS Reflex instant decision model, which recognizes what matters and files it by tier on write, then scores and ranks on recall, returning originals whose relevance exceeds 70% (configurable) to the LLM.

- **Product hierarchy**: APUS Reflex Agent (product) → Infinity Memory Framework (core module) → APUS Reflex instant decision model (driver). The model uses the repository's System One protocol: Choice, Score, and Noul.
- **Three storage tiers**: L0 is the fixed sliding window of the LLM context; L1 Cache Index holds the originals the instant decision model judges worth keeping, verbatim with their surrounding noise, plus pointers back to L2; L2 File Memory Layer keeps every original losslessly.
- **Purpose of this page**: align on the target capabilities, and name for each one the existing repository basis, the remaining iteration, and the evidence acceptance requires.

## Target capabilities

Nine capabilities make up the Infinity Memory Framework: C1–C5 are the main line, and C6–C9 are the constraints that keep it trustworthy.

| ID | Capability | Promise to the user | Responsible part |
| --- | --- | --- | --- |
| C1 | Fixed context window | The context stays a constant size and slides forward; it is never wiped and restarted | L0 window policy |
| C2 | Millisecond recognition and keeping | Before content leaves the window, the instant decision model judges which originals hold key information and keeps them in L1 verbatim; it never rewrites, extracts, or trims them | Reflex write judgement |
| C3 | Lossless tiered filing | The original of every message lands in L2 and can be read back verbatim by seq; compaction shadows and never deletes | Session log + file tier |
| C4 | Memory index tree | L1 Cache Index is a tree for fast lookup: topic → entry → pointer to the L2 original | Index construction |
| C5 | Reverse scored recall | On every user input, the instant decision model walks the index tree, scores every memory for relevance, ranks them, and returns originals above the threshold (default 70%) to the LLM | Reflex recall judgement + context injection |
| C6 | Key-fact protection | User constraints, values, and paths are kept verbatim; a summary that drops any of them is not committed | Rules + pre-commit check |
| C7 | Recorded and replayable | Every judgement and recall of the instant decision model is a Session event, replayable verbatim without an API key | Session events |
| C8 | Scope and revocation | Memories have a visibility scope, and the user can exclude or revoke a memory | Host |
| C9 | Rules first | Decisions rules can settle never call the model; the instant decision model judges only ambiguous candidates and may abstain | Rule admission checks |

## End-to-end mechanism

Write and recall share the L1 index and the L2 originals, but only the recall path sits on the critical path the user waits on.

![Write path and recall path · L0 / L1 / L2 tiers](architecture-write-recall-paths.png)

The write path runs asynchronously after compaction; the recall path runs on every user input through `memoryRecall` (decision `memory.recall`); both are implemented on `feat/recallable-memory`. Measured on the real endpoint, one recall request (up to 16 questions) takes about 0.7 s at p50, and a single judgement about 0.2 s.

After the loop claims a user input and while it assembles the request, the instant decision model judges each user input that compaction moved out of the context (L2) for relevance to the input (with a character-pair prefilter that prefers L1-kept inputs when there are more than `maxCandidates`; before the first compaction there is nothing to judge and no request); originals at or above `yes` replace that request's `system3:memory` runtime context and are recorded as `system3/memory-recall`. Candidates are the Session's compacted user inputs; tool results and model output in L2 are reachable only through `history_read` / `history_search`, and a cross-Session index tree is not implemented yet.

## Mapping to the existing basis

The latest local code covers most of the main line: recallable compaction, memory scoring by the instant decision model, recording, and Web presentation are all on `feat/recallable-memory`. The remote `main` has not been checked (see "Risks and open questions").

| Capability | Existing repository basis | Status | Gap or to confirm |
| --- | --- | --- | --- |
| C1 Fixed window | `compaction-basic` keeps the context inside the window through `thresholdRatio` / `retainRatio` / `headroomTokens`; `small-window.patch.yml` stress-tests a 24K window | Partial | Size is controlled by summary replacement; a constant-size sliding-window policy is not defined |
| C2 Recognition and keeping | System3 `memoryScoring` (`memory.ts`): after compaction replaces a span, the next step starts one instant-decision-model request asynchronously without blocking that step; each person message becomes one Noul question and is kept at probability ≥ `yes`; task-frame / handoff-pack also keep requirements verbatim | Implemented (experimental module, modes off / shadow / active) | Covers only the person's plain-text messages, not tool results or model output; runs at compaction, not whenever a message leaves the window |
| C3 Lossless filing | Append-only Session log; `shadowedRange` / `shadowedSeqs` of `compaction/summary` are checked at runtime; `spill` / `spill-local` move long text out of the context and return a locator | Implemented | The L2 "File Memory Layer" is currently the Session log plus spill files; whether to lay out one file per memory is undecided |
| C4 Memory index tree | The recall footer at the end of each checkpoint (`recallFooter`, `c<seq>` → shadowed range); the FTS5 full-text index of `session-query-sqlite` | Partial | Today this is a flat checkpoint directory plus a full-text index; a hierarchical Cache Index tree is not defined |
| C5 Scored recall | `memoryRecall` (`memory.ts`): one Noul per compacted user input (L2) against each input; originals at or above `yes` are injected into `system3:memory` and recorded as `system3/memory-recall`; `history_read` / `history_search` remain for model-initiated read-back | Implemented (Session level) | Candidates are only the Session's compacted user inputs, at most 16 per input; the cross-Session index tree and hierarchical Cache Index are not implemented; the threshold is not calibrated |
| C6 Key-fact protection | task-frame and handoff-pack keep requirements verbatim; the `memory.score` question targets constraints, corrections, completion criteria, values, paths, and commands; a compaction result that is not smaller than its source is refused | Partial | A deterministic "all required facts present" check before committing a compaction is not implemented |
| C7 Recorded and replayable | The `system3/memory-score` event (checkpoint id, scanned count, kept items and probabilities); `system3/judgement` records the full request and response; the persistence type change is acknowledged | Implemented | A snapshot case must cover keyless replay of the whole compact → score → recall flow |
| C8 Scope and revocation | System3 privacy policy (`privacyMode`, `approvedRemoteDataClasses`, `sessionDataClasses`); delegated child Agents are not scored | Partial | No interface or UI yet lets a user exclude or revoke a single memory |
| C9 Rules first | The decision kernel's `yes` / `no` thresholds and `unsure`; privacy admission; deterministic limits such as `maxMessageChars` and `maxCandidates` (≤ 16); failures and timeouts keep nothing | Implemented | — |

The Web client labels recallable compaction checkpoints, renders `history_read` / `history_search` as detail cards, and shows a memory card in the System3 dock. The integration configuration is [tokenhub-jev-recall.patch.yml](tokenhub-jev-recall.patch.yml) (`APUS-OpenJev-v1-9B`, `timeoutMs` 15000).

## main compared with feat/recallable-memory

Memory on `main` is "lossless log + summary compaction + cross-Session search + the instant decision model keeping task requirements"; the model cannot read compacted content back, and nothing scores memories. Both pieces are on `feat/recallable-memory` and are not merged into `main`. This view is local; the remote has not been checked.

| Tier / capability | main (merged) | feat/recallable-memory (added) | Target |
| --- | --- | --- | --- |
| L0 context window | `compaction-basic` replaces old conversation with a summary at a threshold; `compaction-tool-result-pruner` and `compaction-image-offload` trim tool results and images | Each checkpoint ends with a recall footer `c<seq>` (`recallFooter`, opt-in) | A constant-size sliding window whose size is measurable |
| L2 original storage | Append-only Session log with runtime checks of `shadowedRange` / `shadowedSeqs`; `spill-local` stores long output in local files (opt-in) | Same as main | File Memory Layer: a memory-entry entity that spans Sessions |
| Reading originals after compaction | No model-facing tool; originals exist only in the log | `history_read` (paged originals) and `history_search` (literal search over every checkpoint) | Plus index-tree lookup |
| L1 Cache Index | None | `system3/memory-score` records + a flat checkpoint directory | A hierarchical index tree |
| Instant decision model and memory | Used for entry routing, Skill selection, the task frame, and completion review; scores no memories | `memoryScoring` keeps messages after compaction; `memoryRecall` scores against each input and recalls at ≥ `yes` | Recall over a cross-Session index tree at a calibrated 70% |
| Key facts | `taskFrame` keeps requirements verbatim and shows them throughout; `entryRouting.handoffPack` passes requirements verbatim on delegation; `outputFolding` folds repeated output losslessly | Same as main | A required-fact check before committing a compaction |
| Cross-Session | `tool-session-query` (five read-only tools, authorized by `cwd`, opt-in); `session-reference` turns @-mentioned Sessions into read-only snapshots; reference configurations for third-party MCP memory services (off by default) | Same as main | Cross-Session memory scoped by workspace or user |
| UI | No dedicated presentation | Recallable checkpoint labels, recall detail cards, System3 memory card | Plus exclude / revoke actions |

## Architecture constraints

These six rules come from the repository's CLAUDE.md and the System3 design documents; they are preconditions of every capability above, and a change that breaks any of them cannot merge.

1. **Model-visible ⇔ logged**: everything in a model request must be reconstructable from the Session log. Recalled originals and every judgement of the instant decision model are Session events.
2. **Keyless replay**: replay reads recorded judgements and never calls the model again. `history_read` / `history_search` stay pure functions of the Session log.
3. **Plugins, not loop changes**: new behavior attaches to existing extension points (the `compaction/summary` event, `agent/pre-step`, runtime context); a change to agent-loop must update [architecture.md](../architecture.md) in the same change.
4. **Configurable parameters**: the recall threshold (70%), `yes` / `no`, `maxCandidates`, `deadlineMs`, and the window size are validated `Config` fields, never constants in code.
5. **Acknowledged persistence changes**: a new `SessionEventMap` event is acknowledged in persistence-changes, and the TypeScript and Python SDK expected outputs update with it; only a structural format change bumps `SESSION_FORMAT_VERSION`.
6. **Privacy before advice**: the instant decision model only advises and cannot bypass the privacy policy; it never writes permanent facts on its own or decides which earlier fact to overwrite.

## Iteration items

The top items are threshold calibration and recall-quality evaluation: per-turn recall and latency measurement are done, and these two decide whether the public claim "recall above 70%" can pass acceptance.

| Priority | Item | Current state (`feat/recallable-memory`) | Work |
| --- | --- | --- | --- |
| P0 | Per-turn scoring against the question | Implemented: `memoryRecall` makes one request per input with at most 16 candidates, and the real-endpoint e2e passes | Collect hit and false-recall data in shadow mode before enabling it by default |
| P0 | Latency measurement and budget | Measured on the real endpoint (8 runs each): one Noul p50 191 ms, p95 755 ms; 1 Choice + 15 Noul p50 704 ms, p95 1100 ms; 672 ms for the recall judgement in a real Session | Recall falls back at `deadlineMs` (5000 ms in the measured configuration); evaluate local deployment if lower latency is needed |
| P0 | Threshold calibration | The test configuration sets `yes` 0.5 and `no` 0.3; the public figure is 70% | Calibrate Noul probabilities against the real endpoint on a labelled set (as completion review did) and fix which probability "70% relevance" maps to |
| P1 | Cache Index tree | Flat checkpoint footers + FTS5 full-text index | Define the tree (topic → entry → seq pointer), built deterministically from kept items and checkpoints; written index entries are never rewritten, so the prompt prefix cache keeps hitting |
| P1 | Coverage | Only person plain-text messages ≤ `maxMessageChars` (400 in the test configuration) are scored | Rules first; extend as needed to key values in tool results and to model decisions |
| P1 | Required-fact commit check | Only checks that the summary is smaller than its source | Before committing a compaction, deterministically check user constraints, values, and paths; commit nothing if any is missing |
| P1 | Fixed-window policy | Size is controlled by compaction thresholds | Define the window budget and compaction cadence so that a constant window is measurable |
| P2 | File Memory Layer and cross-Session | Session log + spill files, limited to the current Session | Define the memory-entry entity (source seq, version, scope), then extend it across Sessions |
| P2 | Exclusion and revocation | Only privacy data classes control it | Host-side exclude / revoke interface and persistence, plus actions on the Web memory card |
| P2 | Default enablement | `memoryScoring` is off by default, with shadow / active available | Collect adoption and benefit evidence in shadow mode first, then default to active once it meets the bar |

## Acceptance criteria

Core acceptance must run against real endpoints: DeepSeek's official model for generation, and the APUS Reflex instant decision model for judgements (System One endpoint `/v1/systemone`, model `APUS-OpenJev-v1-9B-5949`). Keyless unit tests and snapshots prove only logic and replay; they cannot stand in for latency and scoring-quality evidence from real endpoints.

**Three test environments**

1. **Keyless**: unit tests (`tool-history-recall.spec.ts`, the System3 memory tests) and recorded-Session snapshot replay, run by CI on every change.
2. **Local System One gateway**: the existing headless e2e and `apps/web/tests/history-memory.e2e.ts`, which check the flow and the UI.
3. **Real endpoints**: DeepSeek's official generation endpoint + the APUS Reflex decision endpoint. Keys are passed only through the environment variables `DEEPSEEK_API_KEY` and `APUS_JEV_API_KEY` and are never written to the repository or documents; e2e skips itself without them. The existing integration configuration points generation at TokenHub, so a second configuration overlay must point it at DeepSeek's official endpoint.

| Item | Pass condition | Evidence | Environment |
| --- | --- | --- | --- |
| Lossless read-back (C3) | After a long Session triggers several compactions under the 24K small-window configuration, every checkpoint's shadowed originals read back verbatim through `history_read` | e2e assertions + compaction invariant checks | 1, 3 |
| Constant window (C1) | No model request's context exceeds the configured window budget | Per-request token-usage curve | 3 |
| Write-scoring quality (C2) | On a labelled set, the keep rate of messages that must be kept and the false-keep rate meet agreed targets | Labelled-set evaluation report | 3 |
| Recall hits (C5) | Questions about compacted facts are answered correctly more often than with the `compaction-basic` baseline without recall; every injected item above the threshold is relevant to the question | Long-horizon fact Q&A comparison | 3 |
| Latency (C2, C5) | The write path adds no per-step time; recall p95 is within the agreed budget; "millisecond-level" is used publicly only after measurements meet it | p50 / p95 report from real endpoints (with timeout and failure rates) | 3 |
| Key facts (C6) | After compaction, the model restates K known constraints and values, all correctly | Handoff-fidelity probe | 3 |
| Recorded replay (C7) | Keyless replay of the compact → score → recall scenario is identical; the TypeScript and Python SDK expected outputs are updated | Recorded-Session snapshot | 1 |
| Failure safety (C8, C9) | When the instant decision model times out, fails, or is refused by the privacy policy, nothing is kept and the conversation completes normally | Unit tests + real-endpoint timeout drill | 1, 3 |
| UI (Web) | Recallable checkpoints, recall detail cards, and the memory card display correctly | Browser e2e + the PR GIF the repository requires | 2, 3 |

## Risks and open questions

The largest risk is public wording that runs ahead of measurement: "millisecond-level" and "recall above 70%" become definite statements only after real-endpoint acceptance passes, and are labelled design targets until then.

**Risks**

- **Remote code not checked**: this machine cannot fetch from GitHub (no HTTPS credentials; the read-only deploy key is not authorized). Once authorized, compare the remote `main` and branches and re-check "Mapping to the existing basis".
- **Latency**: the instant decision model is called through a RunPod proxy, so cold starts and network jitter raise p95; the recall path is on the critical path.
- **Threshold meaning**: before Noul probabilities are calibrated, "70%" may not match the model's real relevance.
- **Key exposure**: the DeepSeek and APUS Reflex keys appeared in plain text in a conversation; rotate them after acceptance.

**Open decisions**

- [ ] Does "70% relevance" mean an uncalibrated Noul probability of 0.7, or a calibrated score?
- [x] Per-turn recall scored against the question (C5): implemented on `feat/recallable-memory` as `memoryRecall`.
- [ ] Should L2 use one file per memory, or keep the Session log as the only source of truth?
- [ ] Is cross-Session memory scoped by workspace or by user?
