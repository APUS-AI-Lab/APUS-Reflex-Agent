# Install APUS Reflex Harness

English | [中文](installation.zh.md)

Use this guide to choose a desktop download, install it, and update it. The integrated preview is being prepared; an unpublished installer is not available for download.

## Download

Open the [product Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases) and read the selected version's supported platform, architecture, signing status, and known limitations. Choose an application asset rather than GitHub's automatically generated source archive. Only platforms with an attached, validated installer are supported by that release.

The first preview targets macOS Apple Silicon and is being prepared as an unsigned build; signing and notarization are not configured. Intel Mac, Windows, and Linux availability must be established by their own release assets and validation; the presence of build scripts does not establish support.

## Install and open

1. Download the installer and the release checksum file. Compare the downloaded file's SHA-256 digest with the listed value before opening it.
2. For a macOS DMG, open the disk image and drag APUS Reflex Harness into Applications. Start the copy in Applications.
3. Follow [model configuration](configuration.md), choose a workspace, and send a small task. The application starts its bundled backend automatically.

An unsigned preview has no Apple signing or notarization assurance and macOS may block it. After confirming the source and checksum, use the operating system's per-application approval flow if you choose to proceed. Do not disable system protection globally. Signing status belongs to the specific release; it cannot be inferred from a successful build.

The application includes its runtime, so Git, Node.js, and pnpm are unnecessary. Model providers still require network access and your own credentials; optional tools may have additional requirements.

## Update

Quit the application, download the next compatible release, and replace the installed application. Automatic application updates are disabled. Settings and sessions live outside the application directory; back them up before installing a release with migration or compatibility warnings. Read release-specific recovery instructions before downgrading.

## Troubleshooting

If no installer exists for your platform, use [source development](development.md) on a supported environment or wait for a qualified package. An empty Releases page does not mean the source archives can be installed.

For startup failures, preserve the displayed error and diagnostics; do not erase profiles or sessions as a first step. Submit the application version, operating system, architecture, and redacted error through [Issues](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues). Never attach credentials or an unreviewed user-data directory.
