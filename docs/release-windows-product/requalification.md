# Native installed-package requalification

English | [中文](requalification.zh.md)

## Scope

The existing `product-release.yml` manual workflow uses `qualification_run_id` and `qualification_source` with one native target (`windows`, `mac`, `mac-intel` or `linux`) to qualify an existing installer without rebuilding product bytes. Leave both qualification inputs empty for the normal build path. Inputs select an existing build run and its expected 40-character source SHA. The workflow accepts only this repository’s product-release workflow and its exact `apus-preview-<native-target>-<run-id>` artifact. It validates the run’s source SHA, downloads that artifact, and requires installer hashes, build metadata and installed runtime identity to agree with the selected source. The qualification helper has its own checkout SHA, recorded separately from the product source.

## Process and diagnostics

The Windows smoke owns the installer PID and sampled descendants, then the installed application and its profile. Installation has a bounded 600-second budget for the full native payload. Reports preserve elapsed time, numeric exit status, killed/signal information, a bounded installation-directory summary and independent cleanup errors. Shutdown waits for owned processes to disappear; failures cannot be reported as a successful qualification. Credentials and authentication URLs are redacted. The script uses a fresh temporary installation and profile, and verifies initial launch, product version, restart, uninstall and process exit without external Node on the application PATH.

The workflow requires only contents/actions read permissions, installs the helper’s locked root dependencies, executes focused tests and the actual installed smoke, and uploads small reports and screenshots. It does not upload or republish product binaries. A passed report qualifies only the selected source SHA and installer hash, not the helper commit’s product source. A failed build run may supply a completed installer for diagnosis; a passing requalification does not waive other build or platform checks.

## Verification

Focused tests reject run/source/artifact mismatches, preserve primary and cleanup diagnostics, and verify process-descendant ownership and quiescent cleanup. Each native runner owns its installation and browser evidence. No local source-only test substitutes for that result.
