# Release APUS Reflex Harness

English | [中文](releases.zh.md)

This reference defines the evidence required to publish a desktop release from the integrated repository. It does not mark a build as released. Users should start with [installation](installation.md).

## Version and source

The first APUS desktop product version is `0.1.0`, with release tag `v0.1.0`. This product version does not inherit the upstream runtime sequence; keep the bundled Harness version separately visible in About and build metadata. GitHub’s prerelease flag is independent of the version string: mark this first release as a prerelease and an unsigned preview. The absence of a beta/rc suffix does not establish stability.

Build each platform from the same reviewed commit and committed dependency locks. A release records the source revision, product and Harness versions, platform, architecture, and lockfile digests. Do not fetch a different frontend repository or substitute the upstream npm runtime.

The deployed runtime resolves a synthesized workspace dependency set. The two committed lockfile digests identify source inputs; they do not freeze every dependency resolved during deployment. After materialization and patching, `runtime-dependencies.json` records each installed package manifest’s relative path, name, version, and SHA-256, including nested dependencies. The runtime manifest and installer build receipt bind the inventory hash; packaging verifies the inventory against the actual package manifests, and Release includes it in `build-info.json` and `SHA256SUMS`. This records what was assembled; it does not establish that a later deployment resolves the same dependency versions or hash every file inside a package.

## Package and qualify

Build on the target operating system and architecture. First prepare the Harness and desktop runtime, then compile the host, assemble the production dependency closure, and package the application. Verify the included runtime, static UI, required native modules, and license notices before installation testing. A directory build is not evidence that its installer works.

| Target | Publication requirement |
| --- | --- |
| macOS Apple Silicon | Install the DMG on an Apple Silicon Mac and verify the packaged runtime |
| macOS Intel | Independent Intel build and installed-app validation |
| Windows x64 | Native Windows build, installer validation, and packaged runtime checks |
| Other targets | Explicit build support and native installation validation before advertising availability |

The first preview targets macOS Apple Silicon; signing remains unconfigured, and the first `v0.1.0` release must still be explicitly marked as an unsigned prerelease. An unsigned preview must explicitly state that signing and notarization are absent. A signed release requires the corresponding platform identity and verification; do not imply those assurances from a build passing.

## Acceptance checklist

- Install from the exact release asset on a clean environment without developer dependencies.
- Open the application and confirm that the bundled backend and UI load without a separate service.
- Configure a real provider through the UI, receive a model response, and complete a small file task.
- Restart, verify persisted settings and conversation access, and test the supported upgrade path.
- Verify SHA-256 checksums, version metadata, architecture, signing status, and bundled license notices.
- Record platform-specific failures and known limitations; withhold failed or untested platform assets.

The release maintainer owns these manual checks. Automated CI and local source tests complement them; neither replaces the installed-application evidence.

## Publish and update

Prepare a draft on [product Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases) with validated installers, checksums, concise changes, supported platforms, signing status, known limitations, and a link to [configuration](configuration.md). Review the source and artifacts for credentials and private deployment data before making them public.

Publish only after the checks above pass, then confirm that a user without repository permissions can download the intended asset. Update the root README's availability statement to match the published release. Application updates remain manual until an APUS update feed has its own configuration and acceptance.
