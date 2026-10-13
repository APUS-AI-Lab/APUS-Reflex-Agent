# Release APUS Reflex Harness

English | [中文](releases.zh.md)

This reference defines the evidence required to publish a desktop or Web release from the integrated repository. It does not mark a build as released. Users should start with [installation](installation.md).

## Version and source

The product release version is owned by `release/manifest.json`; keep the bundled Harness version separately visible in About and build metadata. GitHub’s Latest and prerelease flags are independent of the product version and signing status. A release without a beta/rc suffix does not establish stability.

Build every desktop and Web target from the same reviewed clean source commit and committed dependency locks. Each platform’s build receipt and release metadata must identify that commit. Never append assets from a different source revision to a frozen release. A release records the source revision, product and Harness versions, platform, architecture, and lockfile digests. Do not fetch a different frontend repository or substitute the upstream npm runtime.

The deployed runtime resolves a synthesized workspace dependency set. The two committed lockfile digests identify source inputs; they do not freeze every dependency resolved during deployment. After materialization and patching, `runtime-dependencies.json` records each installed package manifest’s relative path, name, version, and SHA-256, including nested dependencies. The runtime manifest and installer build receipt bind the inventory hash; packaging verifies the inventory against the actual package manifests, and Release includes it in `build-info.json` and `SHA256SUMS`. This records what was assembled; it does not establish that a later deployment resolves the same dependency versions or hash every file inside a package.

Full and Lite are collected independently. Supporting filenames include the edition and target: `build-info-full-darwin-arm64.json`, `LICENSES-full-darwin-arm64.zip`, `runtime-dependencies-full-darwin-arm64.json` and `SHA256SUMS-full-darwin-arm64`; replace `full` with `lite` for Lite, or the target with `darwin-x64`, `win32-x64` or `linux-x64`. Web uses the `web-linux-x64` target and keeps licenses inside its archive. Metadata, runtime inventory and installer receipt must agree on edition and source revision. See [edition selection](../feat-office-editions/README.md). Historical `0.1.0` assets retain their original names.

## Package and qualify

Build on the target operating system and architecture. First prepare the Harness and desktop runtime, then compile the host, assemble the production dependency closure, and package the application. Verify the included runtime, static UI, required native modules, and license notices before installation testing. A directory build is not evidence that its installer works.

| Target | Publication requirement |
| --- | --- |
| macOS Apple Silicon | Install the DMG on an Apple Silicon Mac and verify the packaged runtime |
| macOS Intel | Independent Intel build and installed-app validation |
| Windows x64 | Native Windows build, installer validation, and packaged runtime checks |
| Ubuntu 24.04 x64 desktop | Native `.deb` installation, renderer sandbox, restricted shell execution, restart and uninstall |
| Linux x64 Web | Extract the complete archive; verify bundled Node, authenticated localhost access, model configuration persistence, restricted execution and restart |
| Other targets | Explicit build support and native installation validation before advertising availability |

`v0.1.0` targets macOS Apple Silicon, macOS Intel, Windows x64, Ubuntu 24.04 x64 desktop and Linux x64 Web. The [installation status](installation.md) distinguishes qualified downloads from experimental Windows and Ubuntu desktop assets. These are unsigned prereleases: macOS is not notarized and Windows has no code signature. A qualified platform requires native installation, launch, restart and bundled-backend checks. The explicitly authorized `0.1.0` experimental Windows and Ubuntu desktop downloads are an exception to withholding unqualified assets; their failed or blocked acceptance must remain visible. The first real-model task has not been validated; retain this limitation in release notes. A signed release requires the corresponding platform identity and verification; do not imply those assurances from a build passing.

## Acceptance checklist

- Install from the exact release asset on a clean environment without developer dependencies.
- Open the application and confirm that the bundled backend and UI load without a separate service.
- Record model-task acceptance separately: configuring a real provider, receiving a response and completing a small file task remain unvalidated; do not report them as passed.
- Restart, verify persisted settings and conversation access, and test the supported upgrade path.
- Verify SHA-256 checksums, version metadata, architecture, signing status, and bundled license notices.
- Record platform-specific failures and known limitations; withhold failed or untested assets unless explicitly authorized as experimental downloads with incomplete acceptance disclosed.

The release maintainer owns these manual checks. Automated CI and local source tests complement them; neither replaces the installed-application evidence.

## Publish and update

Prepare a draft on [product Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases) with installers and their per-platform acceptance status, checksums, concise changes, supported platforms, signing status, known limitations, and a link to [configuration](configuration.md). Review the source and artifacts for credentials and private deployment data before making them public.

Publish qualified downloads only after their required native checks pass. Keep the authorized experimental `0.1.0` Windows and Ubuntu desktop assets clearly distinguished, and disclose that real-model task acceptance remains incomplete for every platform. The repository is currently private. Maintainers with release permissions can publish a GitHub prerelease; downloads require repository access until an administrator makes it public. Missing visibility permissions do not block the authorized product prerelease, but it must not be advertised as anonymously downloadable. After an administrator makes the repository public, verify anonymous downloads. Application updates remain manual until an APUS update feed has its own configuration and acceptance.
