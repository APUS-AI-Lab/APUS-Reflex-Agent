# APUS Reflex release readiness

English | [中文](release-readiness.zh.md)

## Decision

The memory and Reflex control integration is on `main`. The latest local build, lifecycle checks and real memory fusion case pass; final release acceptance still requires the published revision's CI, a clean Frontend runtime pin and packaged-product verification. This review separates full-suite results from targeted checks after fixture repairs.

## Verified evidence

- The final Harness build, full lint, Ruff lint and Ruff format checks pass. The plugin catalog is regenerated and `verify-plugin-packages` passes. The next documentation synchronization passes 41 of 42 checks, failing only on a local task record. Internal task records are now privately archived and removed from version control; the final documentation synchronization then passes all 42 checks with exit code 0.
- The latest full backend run records 1,904 passing, 2 failing and 17 skipped files; 39,400 passing tests, 2 failures, 1 expected failure and 204 skips. The failures are obsolete welcome copy and the translation-prompt golden. Only those two expected-output files are repaired; the affected two files and six tests then pass without updating snapshots during replay. This is not a single all-green full-suite run.
- All 95 memory lifecycle tests pass across 12 files. `context.ts` reaches 100% statement, branch, function and line coverage. Indexed partial-query recovery and disposal during downstream hooks or selection are covered, including configuration changes, Jev unload/remount, scope isolation and late-result rejection. The lifecycle repair is complete.
- All seven shipped headless memory cases and one CLI smoke pass. Memory cases include English and Chinese partial-query recovery across source/built process restarts, no Reflex, disabled memory and new-Session isolation. Both built Web memory cases and both PWA cases pass.
- The final live fusion case uses two independent built headless processes, real Jev selection and DeepSeek generation. The durable memory record retains exact source references; the resumed model request contains the complete original fact under `continuum-memory` with that record ID. The active Jev receipt selects that record with confidence 0.853179; recall is logged, the provider completes normally and the final answer contains the random verification marker. The selector keeps its 2-second deadline and 0.8 threshold with zero retries. Source and artifact hashes remain unchanged during the run. This proves one synthetic same-Session case, not general answer quality or the Reflex control layer's privacy-routing policy.
- Recorded Session replay passes 186 cases with 2 skips. All eight affected Python SDK scenarios pass after identity-text refresh and again in replay. Their only fixture changes are the model identity text; historical Session generations are unchanged.
- The Frontend passes all 1,590 tests, typecheck and build. An isolated first launch displays APUS Reflex. These checks do not replace an existing installation or update its old runtime.
- Earlier live Jev and completion-recovery checks remain bounded historical evidence. Injected premature-completion cases retain actual tool denial, Jev review, real generation and final-artifact assertions; they do not show a model autonomously choosing the injected error. The earlier [Independent harness CI](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/actions/runs/38243375340) does not certify the final release revision, and its skipped real-provider lane is not a pass.

## Remaining acceptance work

- Publish and verify the final Harness revision, then pin and verify the Frontend against that clean revision. Keep generator configuration and the runtime pin aligned; a passing isolated launch does not certify an upgrade from an old installation.
- Validate signed packages, required native-platform behavior, installation, recovery and notarization separately. Source tests and build success do not establish signed-app acceptance.
- Verify remote CI against the final release revision. Preserve failed runs alongside their targeted repair evidence; keep credentials and raw private execution records outside the repository.

## Scope

Continuum requires explicit activation and defaults to off. Accepted Session facts persist and are projected into bounded model requests; same-Session recovery does not establish cross-Session recall, an unlimited model context window, perfect retrieval or unlimited storage. Without explicit Session classification, the public deployment disables the Reflex control layer while retaining the general-model path. See the [memory configuration and limits](../../packages/context/continuum/README.md) and [public provider configuration](public-provider-configuration.md).
