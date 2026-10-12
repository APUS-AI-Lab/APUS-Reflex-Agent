# Open-source documentation audit

English | [中文](open-source-docs-audit.zh.md)

This audit is for a public release of the Harness and its separate Frontend repository. It classifies documentation by release action; it does not delete evidence automatically because some files are needed for internal reproducibility.

## Block before making the repository public

- Remove or rewrite absolute local paths and `.Codex`/`.claude` worktree paths. Current examples include `docs/feat-jev-decision-kernel/completion-browser-result.json`, `docs/feat-jev-decision-kernel/completion-browser-session.jsonl`, `docs/feat-system3-foundation/evidence.json`, `docs/feat-system3-foundation/design.md`, `docs/feat-system3-desktop/delivery-objectives-and-ux-audit.html`, and several `tasks/*/handoff.md` files.
- Remove private infrastructure endpoints from public instructions and evidence, or replace them with `<JEV_ENDPOINT>` and a reproducible owner-controlled test fixture. Current examples include `docs/feat-continuum-memory/continuum-evaluation-results.json`, `docs/feat-reflex-control/cache-benchmark-design.md`, `docs/feat-reflex-control/evidence/entry-routing-eval-v2.json`, and the `native-recovery-real-v*.log` files.
- Replace links into local Frontend worktrees and feature branches in `docs/feat-reflex-control/apus-reflex-harness-acceptance-review.html` with merged `main` links or versioned release artifacts.
- Keep provider request logs, session JSONL, raw browser captures and screenshots out of the public tree until they have a data-owner review. Treat `docs/feat-jev-decision-kernel/completion-browser-session.jsonl`, `docs/feat-reflex-control/evidence/*.json`, `*.log`, and user-facing PNGs as internal by default.
- Complete a real Gitleaks scan after Actions capacity is restored. The local scan is still running in the current session; no secret-scan result should be advertised until it exits successfully.

## Keep after review and redaction

- Architecture, API contracts, README examples, deterministic keyless fixtures, and compact evidence that contains no private endpoint, user content, local path or credential.
- The Loop Working architecture diagram and the classic casebook after replacing internal links with repository-relative or public release links.
- Acceptance summaries that state the test command, date, mode and limitations without embedding raw provider traffic.

## Do not publish as product proof

- Internal handoff notes, abandoned design explorations, private organization/repository history, raw model transcripts, incomplete performance runs, or documents that call a skipped workflow “passed”. Move them to a private evidence archive or rewrite them as a short, current release note.
- Any document that presents a RunPod URL, a gateway URL, a machine path, a branch-only link or a commit pin as a durable public dependency.

## Required release checks

1. Run Gitleaks on the tracked checkout and history with the repository configuration.
2. Run `pnpm run verify-public-repository-links`, `pnpm run verify-repository-references`, `pnpm run test:docs`, and `pnpm run doc-sync`.
3. Inspect every HTML/JSON/JSONL/log/image under `docs/` and `tasks/` against the block list above.
4. Rebuild both independent repositories from clean `main` checkouts and verify that README commands use public paths and placeholder credentials.
