# Intel Mac release

English | [中文](design.zh.md)

Reference for qualifying the Intel Mac preview of APUS Reflex Harness. The native x64 build uses `macos-15-intel`, as listed in the [official runner images](https://github.com/actions/runner-images/blob/main/README.md). Apple Silicon remains on `macos-15`.

```mermaid
flowchart LR
  Source[Dispatch commit] --> Runner[Native Intel Mac]
  Runner --> DMG[Checksummed DMG and ZIP]
  DMG --> Copy[Independent installed application]
  Copy --> Smoke[Fresh profile and restart]
  Smoke --> Review[Reports and manual publication]
```

The manual workflow accepts `mac-intel` in addition to the existing targets. It checks out the dispatch commit and builds the locked native runtime on the matching architecture. The collector keeps Apple Silicon metadata names unchanged; Intel Mac metadata uses the `-darwin-x64` suffix so both architectures coexist in one Release. No product API or persistence changes are required.

The installed smoke command accepts `--installer <absolute DMG>` and `--report-dir <absolute directory>`. It verifies the DMG against collected metadata, mounts it read-only, copies the application into a private temporary installation, and detaches the image before launch. The installed runtime must match the clean source revision and native architecture. A fresh profile and system-only PATH exclude developer Node and inherited credentials. First launch, the visible product version, exit and restart produce screenshots and a bounded redacted report. The check does not qualify notarization, Gatekeeper trust, or a real model API request.

Files owned by this batch are release/manifest.json, .github/workflows/product-release.yml, scripts/product-release.mjs and its tests, scripts/product-macos-smoke.mjs and its tests, and this design pair. Existing Windows qualification remains unchanged. Focused checks cover metadata collisions, wrong installed identity, credential isolation and workflow selection; native CI supplies actual DMG installation and UI acceptance. The workflow uploads review artifacts with read-only repository permission and never publishes a Release automatically.

The next distribution candidate is a Web full-stack package with a startup command and persistent data configuration. The existing deployment Dockerfile only builds source and does not define a runnable public image. Linux desktop qualification additionally requires Linux installer targets and native GUI acceptance; neither is included in the Intel Mac release claim.
