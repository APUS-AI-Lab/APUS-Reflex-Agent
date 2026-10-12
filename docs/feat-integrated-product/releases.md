# Release APUS Reflex Harness

English | [中文](releases.zh.md)

This reference defines the evidence required to publish a desktop or Web release from the integrated repository. It does not mark a build as released. Users should start with [installation](installation.md).

## Version and source

The first APUS desktop product version is `0.1.0`, with release tag `v0.1.0`. This product version does not inherit the upstream runtime sequence; keep the bundled Harness version separately visible in About and build metadata. GitHub’s prerelease flag is independent of the version string: mark this first release as a prerelease and an unsigned preview. The absence of a beta/rc suffix does not establish stability.

Build every desktop and Web target from the same reviewed clean source commit and committed dependency locks. Each platform’s build receipt and release metadata must identify that commit. Never append assets from a different source revision to a frozen release. A release records the source revision, product and Harness versions, platform, architecture, and lockfile digests. Do not fetch a different frontend repository or substitute the upstream npm runtime.

The deployed runtime resolves a synthesized workspace dependency set. The two committed lockfile digests identify source inputs; they do not freeze every dependency resolved during deployment. After materialization and patching, `runtime-dependencies.json` records each installed package manifest’s relative path, name, version, and SHA-256, including nested dependencies. The runtime manifest and installer build receipt bind the inventory hash; packaging verifies the inventory against the actual package manifests, and Release includes it in `build-info.json` and `SHA256SUMS`. This records what was assembled; it does not establish that a later deployment resolves the same dependency versions or hash every file inside a package.

macOS Apple Silicon uses `build-info.json`, `LICENSES.zip`, `runtime-dependencies.json` and `SHA256SUMS`. Intel Mac uses `build-info-darwin-x64.json`, `LICENSES-darwin-x64.zip`, `runtime-dependencies-darwin-x64.json` and `SHA256SUMS-darwin-x64`. Windows uses `build-info-win32-x64.json`, `LICENSES-win32-x64.zip`, `runtime-dependencies-win32-x64.json` and `SHA256SUMS-win32-x64`. Linux desktop uses the same companion names with `-linux-x64`. Web uses `build-info-web-linux-x64.json`, `runtime-dependencies-web-linux-x64.json` and `SHA256SUMS-web-linux-x64`; its licenses are inside the archive. Check each platform’s files against its checksums and the shared source commit.

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

`v0.1.0` targets macOS Apple Silicon, macOS Intel, Windows x64, Ubuntu 24.04 x64 desktop and Linux x64 Web. Available platforms are limited to qualified installers actually attached to the Release. These are unsigned prereleases: macOS is not notarized and Windows has no code signature. Each platform requires native installation, launch, restart and bundled-backend checks before publication. The first real-model task has not been validated; retain this limitation in release notes. A signed release requires the corresponding platform identity and verification; do not imply those assurances from a build passing.

## Acceptance checklist

- Install from the exact release asset on a clean environment without developer dependencies.
- Open the application and confirm that the bundled backend and UI load without a separate service.
- Record model-task acceptance separately: configuring a real provider, receiving a response and completing a small file task remain unvalidated; do not report them as passed.
- Restart, verify persisted settings and conversation access, and test the supported upgrade path.
- Verify SHA-256 checksums, version metadata, architecture, signing status, and bundled license notices.
- Record platform-specific failures and known limitations; withhold failed or untested platform assets.

The release maintainer owns these manual checks. Automated CI and local source tests complement them; neither replaces the installed-application evidence.

## Publish and update

Prepare a draft on [product Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases) with validated installers, checksums, concise changes, supported platforms, signing status, known limitations, and a link to [configuration](configuration.md). Review the source and artifacts for credentials and private deployment data before making them public.

Publish an unsigned preview only after the required native installation, launch and artifact checks pass, explicitly disclosing that real-model task acceptance is incomplete. The repository is currently private. Maintainers with release permissions can publish a GitHub prerelease; downloads require repository access until an administrator makes it public. Missing visibility permissions do not block the authorized product prerelease, but it must not be advertised as anonymously downloadable. After an administrator makes the repository public, verify anonymous downloads. Application updates remain manual until an APUS update feed has its own configuration and acceptance.
