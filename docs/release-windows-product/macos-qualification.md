# macOS installed-package qualification

English | [中文](macos-qualification.zh.md)

## Scope

The macOS helper qualifies the collected DMG on its native Apple Silicon or Intel runner. `--expected-source` selects the full product source SHA; it defaults to the workflow checkout SHA for normal builds. Requalification supplies the existing product SHA explicitly, with `--build-run-id` identifying its build. The report keeps `sourceRevision` and `helperSourceRevision` separate. Installer hash, installed runtime architecture and source, bundle version, home screen, restart and process exit must pass before the report records success.

## Image handling and diagnostics

Image attachment and application copying each have a bounded 600-second budget. Detachment has a 30-second budget. Command records retain elapsed time, timeout, exit status, termination signal and redacted bounded output. Cleanup checks the actual private mountpoint even when attachment failed before reporting success; a mounted image must be detached. Primary failures and cleanup failures remain separate in the report, and either prevents successful qualification.

## Verification and limits

Focused tests execute real child processes to check timeout and nonzero-exit diagnostics, reject mismatched source selections, and distinguish the private mountpoint from neighboring paths. Native macOS CI supplies copied-application and browser evidence. The preview is unsigned; notarization and Gatekeeper trust are not qualified. The smoke uses no provider credentials and does not exercise a real model API task.
