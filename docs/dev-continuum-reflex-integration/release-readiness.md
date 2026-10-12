# APUS Continuum + Reflex release readiness

English | [中文](release-readiness.zh.md)

## Decision

This branch is a release candidate for the integrated Continuum/Reflex feature, but it is not ready for a public release tag yet. The core opt-in memory path is implemented and locally verified; the remaining blockers are release evidence and product deployment acceptance.

## Ready

- The original profile remains the default: Continuum is disabled and automatic admission is explicit.
- The Reflex-only switch gates both admission and recall. A missing Jev service resolves to the original path.
- A committed human message can be admitted with an exact Session source reference, replayed from `continuum/memory-record`, and recalled after a seeded restart.
- Deterministic bounded retrieval and Jev shadow/active selection are covered by focused tests.
- Package metadata, MIT licensing, bilingual READMEs, generated catalogs, and credential references are present; repository scans found no supplied live API key in tracked files.
- RunPod Jev authentication and DeepSeek gateway evaluation were exercised with ephemeral credentials; credentials were not committed.

## Blocking before public release

- Product-level shipped-profile E2E remains required; the new production composition test now proves JSONL flush, context disposal, `AgentLoop.resume()` from disk, recall injection, and model-visible source attribution, with an explicit-mode negative control.
- System3 real Jev validation passes all six selected files: task-frame, handoff-pack, delegation calibration, entry routing, completion-review, and the strict `reflex-context` scenario. A deterministic safety layer preserves explicit precision and file-integrity constraints when Jev returns a delete decision; the model decision remains recorded for audit.
- The full repository suite is not green on this branch because of pre-existing desktop/UI/workflow infrastructure failures. Each must be either fixed or explicitly quarantined with an owner before claiming repository-wide release readiness.
- CI must run the new admission/restart test and the real-provider lane with repository-managed secrets; local credentials must never enter configuration, fixtures, HTML, logs, or commits.
- Publish the feature from a clean release branch after the final build, typecheck, lint, documentation, persistence, catalog, snapshot, and targeted regression gates pass on the exact release commit.

## Recommended release sequence

1. Deploy a staging profile with `CONTINUUM_MEMORY_ENABLED=true`, `CONTINUUM_MEMORY_MODE=active`, `CONTINUUM_MEMORY_ADMISSION=user-message`, and a non-empty explicit scope.
2. Run a black-box session: send a fact, flush, restart from durable storage, ask a related question, and assert the recall message cites the original event sequence.
3. Run the original profile with the same conversation and assert no `continuum/memory-record` or `continuum-memory` message is emitted.
4. Fix or document the remaining baseline suite failures.
5. Re-run release gates on the exact commit, inspect the package tarballs, then tag and publish.
