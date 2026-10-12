# Release APUS Reflex Harness

English | [中文](releases.zh.md)

This reference defines the evidence required to publish a desktop release from the integrated repository. It does not mark a build as released. Users should start with [installation](installation.md).

## Version and source

The first APUS desktop product version is `0.1.0`, with release tag `v0.1.0`. This product version does not inherit the upstream runtime sequence; keep the bundled Harness version separately visible in About and build metadata. GitHub’s prerelease flag is independent of the version string: mark this first release as a prerelease and an unsigned preview. The absence of a beta/rc suffix does not establish stability.

Build each platform from its reviewed commit and committed dependency locks. Additional Windows assets do not replace existing macOS assets; record each platform’s actual source commit separately. A release records the source revision, product and Harness versions, platform, architecture, and lockfile digests. Do not fetch a different frontend repository or substitute the upstream npm runtime.

The deployed runtime resolves a synthesized workspace dependency set. The two committed lockfile digests identify source inputs; they do not freeze every dependency resolved during deployment. After materialization and patching, `runtime-dependencies.json` records each installed package manifest’s relative path, name, version, and SHA-256, including nested dependencies. The runtime manifest and installer build receipt bind the inventory hash; packaging verifies the inventory against the actual package manifests, and Release includes it in `build-info.json` and `SHA256SUMS`. This records what was assembled; it does not establish that a later deployment resolves the same dependency versions or hash every file inside a package.

The Windows collector uses separate asset names: `build-info-win32-x64.json`, `LICENSES-win32-x64.zip`, `runtime-dependencies-win32-x64.json` and `SHA256SUMS-win32-x64`. Keep the existing macOS `build-info.json`, `LICENSES.zip`, `runtime-dependencies.json`, `SHA256SUMS` and application assets unchanged. Check hashes and source commits against the files for the corresponding platform.

## Package and qualify

Build on the target operating system and architecture. First prepare the Harness and desktop runtime, then compile the host, assemble the production dependency closure, and package the application. Verify the included runtime, static UI, required native modules, and license notices before installation testing. A directory build is not evidence that its installer works.

| Target | Publication requirement |
| --- | --- |
| macOS Apple Silicon | Install the DMG on an Apple Silicon Mac and verify the packaged runtime |
| macOS Intel | Independent Intel build and installed-app validation |
| Windows x64 | Native Windows build, installer validation, and packaged runtime checks |
| Other targets | Explicit build support and native installation validation before advertising availability |

`v0.1.0` retains the existing macOS Apple Silicon assets and prepares an additional Windows x64 NSIS installer. Both are unsigned prereleases: macOS is not notarized and Windows has no code signature. Windows assets require native installation, launch and bundled-backend checks before publication. The first real-model task has not been validated; retain this limitation in release notes. A signed release requires the corresponding platform identity and verification; do not imply those assurances from a build passing.

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

Publish an unsigned preview only after the required native installation, launch and artifact checks pass, explicitly disclosing that real-model task acceptance is incomplete. The repository is currently private. Maintainers with release permissions can publish a GitHub prerelease; downloads require repository access until an administrator makes it public. Missing visibility permissions do not block the authorized Windows prerelease, but it must not be advertised as anonymously downloadable. After an administrator makes the repository public, verify anonymous downloads and update the root README to match actual availability. Application updates remain manual until an APUS update feed has its own configuration and acceptance.
