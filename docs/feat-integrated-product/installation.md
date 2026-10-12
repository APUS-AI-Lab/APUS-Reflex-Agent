# Install APUS Reflex Harness

English | [中文](installation.zh.md)

Use this guide to choose a desktop download, install it, and update it. The Windows preview installer is being prepared and becomes downloadable only after native installation and launch validation and publication; existing macOS arm64 assets remain unchanged.

## Download

The repository is currently private. Viewing and downloading a Release requires repository access; prerelease status does not enable anonymous access.

Open the [product Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases) and read the selected version's supported platform, architecture, signing status, and known limitations. Choose an application asset rather than GitHub's automatically generated source archive. Only platforms with an attached, validated installer are supported by that release.

The `0.1.0` targets are macOS Apple Silicon and Windows x64. macOS uses the existing DMG/application ZIP; the additional Windows installer is an unsigned NSIS `.exe` preview. Windows assets require native installation and launch validation before publication. The first task with a real model has not been validated. Intel Mac and Linux are outside this Windows delivery.

## Install and open

1. Download the installer and the release checksum file. Compare the downloaded file's SHA-256 digest with the listed value before opening it.
2. Windows: download the x64 NSIS `.exe`, run the installer, and launch APUS Reflex Harness from the Start menu or installation directory. Use `SHA256SUMS-win32-x64` to verify Windows files.
3. macOS: open the DMG, drag APUS Reflex Harness into Applications, and launch that copy. Use the existing `SHA256SUMS` for these assets.
4. Follow [model configuration](configuration.md), choose a workspace, and send a small task. The application starts its bundled backend automatically.

The Windows installer has no code signature, so SmartScreen may report an unknown publisher. The macOS preview has no Apple signing or notarization assurance and may also be blocked. After confirming the source and checksum, use the operating system's per-application approval flow if you choose to proceed. Do not disable system protection globally. Signing status belongs to the specific release; it cannot be inferred from a successful build.

The application includes its runtime, so Git, Node.js, and pnpm are unnecessary. Model providers still require network access and your own credentials; optional tools may have additional requirements.

Web runs through the [source development entry](development.md), not a standalone downloadable installer. Successful installation and launch do not validate model tasks; configure a provider, credentials and model, then verify a small task.

## Update

Quit the application and download the next compatible release. On Windows, run the new installer; on macOS, replace the installed application. Automatic application updates are disabled. Settings and sessions live outside the application directory; back them up before installing a release with migration or compatibility warnings. Read release-specific recovery instructions before downgrading.

## Troubleshooting

If no installer exists for your platform, use [source development](development.md) on a supported environment or wait for a qualified package. An empty Releases page does not mean the source archives can be installed.

For startup failures, preserve the displayed error and diagnostics; do not erase profiles or sessions as a first step. Submit the application version, operating system, architecture, and redacted error through [Issues](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues). Never attach credentials or an unreviewed user-data directory.
