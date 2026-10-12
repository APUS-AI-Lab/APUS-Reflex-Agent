# Integrated repository publication audit

English | [中文](publication-audit.zh.md)

This reference records the source files, reachable Git history, and product defaults reviewed on 2026-10-12. It does not replace installer acceptance or establish that every document is suitable for publication merely because secret scanning passed.

## Scan scope and results

The audit used local Gitleaks 8.30.1 with its default rules, bypassing repository allow comments and ignore lists, and `--redact=100` reports. Raw JSON, file copies, remote-ref lists, and extracted text remain in a local temporary directory; this document contains no matched text, credentials, or report copies.

| Target | Scope | Scanned text | Findings | Review |
|---|---|---:|---:|---|
| Current Harness files | 14,460 tracked non-symlink files on `main` | 119.17 MB | 32 | Digests or test fixtures only |
| Harness Git history | 20,398 commits reachable from all local refs; the tool processed 12,227 commits with diffs | 320.82 MB | 502 | Digests, test fixtures, or non-credential text only |
| Current Frontend files | 706 tracked non-symlink files on `main` | 9.18 MB | 0 | No findings |
| Frontend Git history | 524 commits reachable from all local refs; the tool processed 426 commits with diffs | 29.35 MB | 0 | No findings |
| Demo and presentation attachments | Extractable text from three PDFs, two PPTX files, and the demo ZIP | 615.70 KB | 0 | No findings |

Neither local repository is a shallow clone. History scanning used `gitleaks git --log-opts=--all`, covering history reachable from local branches, remote-tracking refs, and tags. All 36 refs returned by the GitHub API for `APUS-AI-Lab/APUS-Reflex-Harness`, comprising 4 branches, 4 PR head refs, and 28 tags, resolve to commits in the scanned reachable set. Source-repository remote-tracking refs and local development branches also participated, so local coverage exceeds the GitHub-visible refs at that time. Frontend GitHub refs were not independently enumerated; the import uses its scanned current files.

Git scanning examines text diffs; merge commits account for the difference between reachable and processed commit counts. Coverage excludes reflogs, unreachable objects, later commits, Release files not yet built, text embedded in images, and unextracted binary contents. The final commit and actual installers require an additional scan before publication.

## Finding classification

The 32 current Harness findings comprise 26 translation-record paths and Git digests, 3 commit digests in import-verification JSON, and 3 test fixtures. Directory names alone were not used to allow every finding in a directory.

The 502 Harness history findings comprise:

- 481 `*.i18n.yaml` translation digests, individually checked as Markdown file keys with 40- or 64-character hexadecimal digests.
- 5 Git or file digests in verification JSON: 2 in `docs/feat-reflex-experience/jev-api-guide-verification.json` and 3 in `tasks/chore-apus-fork/import-verification.json`.
- 13 test fixtures in model settings, credential persistence, and telemetry redaction tests, including explicit `FIXTURE_SECRET` values, consecutive-digit samples, and a redaction-test JWT.
- 3 ordinary-text false positives in performance-evidence Markdown, a Session projection module comment, and an old desktop renderer localStorage key.

Rule totals are 495 `generic-api-key`, 5 `cloudflare-api-key`, 1 `gcp-api-key`, and 1 `jwt`. Every raw report's `Secret` field was verified as fully redacted. The review found no confirmed real credential, so it did not rotate credentials or rewrite history.

## Product-default publication requirements

The source Frontend's `scripts/generate-system3-patch.mjs` generates desktop configuration from Harness `deploy/system3/runtime.patch.yml` and replaces the empty `SYSTEM3_SESSION_DATA_CLASSES` default with `[workspace]`. The source configuration contains organization model gateways and a Jev deployment endpoint. This configuration serves an existing managed deployment and cannot directly provide universal defaults for a public installer.

The public product must use independent configuration: users supply model credentials, organization secrets are not bundled, ordinary startup does not depend on organization production gateways, and remote Jev access and workspace-data authorization require explicit user configuration. Installers must exclude developer environment files, runtime logs, session data, internal deployment patches, and shell profiles. Final build and first-launch tests must verify these requirements; source review does not replace those tests.

## Documentation and internal material

Deployment-address and personal-path checks located 70 lines in Harness and 12 in Frontend. Private IP addresses in tests are network-function fixtures and must be distinguished from real deployment information. Real organization deployment references mainly occur in `deploy/system3/`, `docs/feat-independent-harness/`, `docs/feat-system3-foundation/`, and corresponding `tasks/` records; some acceptance JSON contains developer-local paths. These references are not credentials, but they are unsuitable as universal configuration tutorials.

The CEO PDFs, PPTX files, preview images, and `report-ceo-onepage.html` under `docs/feat-jev-decision-kernel/` are management presentations; `report.html` also discusses company strategy and resource investment. Extracted text revealed no real credential, explicit financial amount, or confidentiality marking. Current evidence does not justify removing these files from Git history; user-facing Release packages should exclude this non-runtime material. Keeping it in the source repository is an editorial decision, and filenames alone do not establish commercial confidentiality.

README declarations may be shortened without removing license texts and third-party notices required by distributed dependencies. Publication includes old commits and PR refs; deleting a file in a new commit does not withdraw historical content.

## Publication verification

- [x] Current source files and locally reachable history scanned, with findings classified.
- [x] Commit coverage verified for current Harness GitHub refs.
- [x] Extractable demo and presentation text scanned separately.
- [ ] Final integrated commit scanned incrementally.
- [ ] Product profile independent of organization production deployments, with explicit user configuration and data authorization verified.
- [ ] Actual installers checked for secrets, environment files, third-party notices, and first-launch behavior.
- [ ] Remote refs checked again for changes before publication.

## Dev Note

This document records the audit at one point in time. Source history was not modified, credentials in local environment files were neither read nor printed, and candidate credentials were not tested against remote services.
