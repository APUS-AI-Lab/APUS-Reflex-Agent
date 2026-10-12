# Architecture follow-up tasks for a new contributor

English | [中文](architecture-followups.zh.md)

This list separates work that can be completed with focused repository tests from work that needs a release owner, a real provider, or platform credentials. A checked box means the evidence exists in the current checkout; it does not mean every release gate is complete.

## P0 — release and user trust

- [ ] Restore GitHub Actions capacity and rerun both repositories' required workflows. Record the run URLs and keep skipped jobs distinct from passed jobs.
- [ ] Add a shipped-profile black-box matrix for Jev shadow, Jev active, Jev unavailable, and Reflex disabled. Verify the model-visible request, decision receipt, Session event, and fallback for each case.
- [ ] Exercise a healthy long task and a mid-run Goal change through the real Web/Electron path. Prove that a late supervision result cannot overwrite the newer Goal.
- [ ] Finish Electron startup-failure recovery, session reopen, package manifest, signing, notarization and staple checks on the supported release runner.
- [ ] Measure admission latency, remote first-byte latency, total latency and visible fallback with a reproducible provider fixture and one real endpoint. Publish p50/p95 and failure evidence.

## P1 — architecture hardening

- [ ] Replace remaining maintained-document commit pins with release tags or stable repository links. Run `pnpm run verify-repository-references` and keep machine evidence in its allowlisted files.
- [ ] Move public-facing evidence links from feature branches and local `.Codex/worktrees` paths to merged `main` paths or versioned release artifacts.
- [ ] Add an explicit memory lifecycle contract: admission, deduplication, retention, deletion, scope isolation, retrieval limits and Session replay ownership.
- [ ] Add negative tests for memory leakage across users, sessions, scopes and disabled/no-Jev profiles. Include a test that proves source Session data is never rewritten by projection.
- [ ] Add provider-switch black-box coverage: save a memory with provider A, restart with provider B, and verify retrieval, attribution and compatibility behavior.
- [ ] Add retrieval quality and boundedness measurements for large memory sets. Report recall precision, selected bytes/tokens, latency and irrelevant-leaf rejection instead of claiming unlimited tokens.
- [ ] Keep the Reflex decision receipt and the general-model execution trace separately queryable, so operators can audit what was proposed, adopted and executed.

## P2 — newcomer-sized improvements

- [ ] Add one keyless unit test for each new public config field and one invalid-config fixture for its parser or loader.
- [ ] Improve README examples with a minimal no-Jev path and an opt-in Jev path. Run every documented command from a clean checkout.
- [ ] Add a small fixture that demonstrates input preservation, memory restoration and bounded context projection in one replayable Session.
- [ ] Add a diagnostic command or report that prints the active mode (`general`, `shadow`, or `active`), memory switch, provider identity and Session directory without printing secrets.
- [ ] Add a browser assertion that the Reflex-only memory switch is hidden or inert when Jev is not mounted, while the original DSH path remains usable.
- [ ] Add release-note entries for compatibility behavior, known limits and the difference between durable memory and a model token window.

## Do not assign as a first independent task

- Do not change Session event types, persistence versions, or migration behavior without reviewing the released-format rules and updating TypeScript/Python replay surfaces together.
- Do not change `agent-loop`, context projection, cache-prefix protection or cancellation semantics without a design review and cross-process regression evidence.
- Do not modify Jev safety constraints, provider credential flow, signing/notarization, or public repository transfer settings without the release owner.
- Do not treat a local mocked provider, a skipped workflow, or a component test as proof of the real Jev, Electron or provider path.

## Suggested onboarding order

1. Read `docs/architecture.md`, `docs/dev-continuum-reflex-integration/release-readiness.md`, and the README Loop Working architecture.
2. Run the focused Continuum and System3 tests, then inspect one recorded Session and one provider-visible request.
3. Take one P2 fixture or diagnostic task and add its invalid case before touching runtime code.
4. For P1 work, write a small design note, add focused tests, run build/typecheck/lint, and attach evidence to the task.
