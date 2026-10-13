# Install APUS Reflex Harness

English | [中文](installation.zh.md)

Use this guide to choose a desktop download, install it, and update it. Read the acceptance status before choosing an attached download; experimental assets have not completed installation acceptance.

## Download

The repository is currently private. Viewing and downloading a Release requires repository access; prerelease status does not enable anonymous access.

Open the [product Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases) and read the selected version's supported platform, architecture, signing status, and known limitations. Choose an application asset rather than GitHub's automatically generated source archive. An attached asset does not by itself establish installation acceptance.

The `0.1.0` targets are macOS Apple Silicon (arm64), macOS Intel (x64), Windows x64, Ubuntu 24.04 x64 desktop and a complete Linux x64 Web archive, built from the same reviewed clean source commit. Choose the asset matching your operating system and architecture: macOS uses a DMG/application ZIP; Windows uses an NSIS `.exe` installer. These are unsigned previews, and macOS is not notarized. Windows and Ubuntu desktop are explicitly experimental in this prerelease. The first task with a real model has not been validated.

| Platform | `0.1.0` installation acceptance |
| --- | --- |
| macOS Apple Silicon / Intel | Automated copying, direct process startup and restart passed; Finder/Gatekeeper acceptance is incomplete. The application in a checked DMG has an invalid bundle seal. |
| Linux x64 Web (Ubuntu 24.04) | Passed extraction, startup, default workspace, configuration persistence, sandbox and restart. |
| Windows x64 | Experimental; installer built, but installation acceptance failed with cause unresolved. |
| Ubuntu 24.04 x64 desktop | Experimental; installer built, but acceptance stopped on a runtime file-list output buffer overflow before application launch. |

The checked published `0.1.0` macOS DMG matches its published SHA-256, but its application fails strict bundle-signature verification with `code has no resources but signature indicates they must be present`. Finder can report the copied app as damaged after the normal DMG → Applications installation flow. The previous automated checks invoked the executable directly and did not qualify that Finder/Gatekeeper flow. A matching download checksum confirms the bytes, not a valid application seal. Review the replacement release's installation results and [signature policy](../feat-office-editions/README.md#macos-compatibility) before downloading; [source development](development.md) remains available.

Windows and Ubuntu desktop rechecks could not start because GitHub Actions billing/spending limits blocked their runners. The Linux helper has been corrected, but this does not establish installation, UI or sandbox acceptance. All downloads retain the same product source recorded in their build metadata; later acceptance-helper changes do not rebuild the product.

## Install and open

1. Download the installer and the release checksum file. Compare the downloaded file's SHA-256 digest with the listed value before opening it.
2. Windows (experimental; installation acceptance incomplete): download the x64 NSIS `.exe`, run the installer, and launch APUS Reflex Harness from the Start menu or installation directory. Use `SHA256SUMS-win32-x64` to verify Windows files.
3. macOS (`0.1.0` bundle-seal defect; Finder/Gatekeeper acceptance incomplete): use [source development](development.md) or wait for a qualified replacement. The existing `0.1.0` Apple Silicon files use `SHA256SUMS` and Intel files use `SHA256SUMS-darwin-x64`; checksum verification does not repair this defect.
4. Ubuntu 24.04 x64 (experimental; installation acceptance incomplete): verify `SHA256SUMS-linux-x64`, then install the downloaded package with `sudo apt install ./apus-reflex-harness-linux-x64.deb` and open APUS Reflex Harness from the application menu. Other Linux distributions are not qualified.
5. Linux x64 Web: verify `SHA256SUMS-web-linux-x64`, extract `apus-reflex-harness-web-linux-x64.tar.gz` and run `./start.sh` in its directory. Open the authenticated localhost URL printed by the launcher; do not share that URL. See the [Web guide](../release-web-runtime/README.md) for port and data-directory settings.
6. Follow [model configuration](configuration.md), choose a workspace, and send a small task. The application starts its bundled backend automatically.

The Windows installer has no code signature, so SmartScreen may report an unknown publisher. After confirming its source and checksum, use the operating system's per-application approval flow if you choose to proceed. The macOS preview has no Developer ID signing or notarization assurance; ordinary approval does not repair the confirmed `0.1.0` bundle-seal defect. Do not disable system protection globally. Signing status belongs to the specific release; it cannot be inferred from a successful build.

The application includes its runtime, so Git, Node.js, and pnpm are unnecessary. Model providers still require network access and your own credentials; optional tools may have additional requirements.

The complete Web archive includes Node, the backend and browser resources, with no Electron or external Node requirement. It binds to localhost; remote exposure requires separate deployment configuration. The [source development entry](development.md) remains available. Successful installation and launch do not validate model tasks; configure a provider, credentials and model, then verify a small task.

## Update

Quit the application and download the next compatible release. On Windows, run the new installer; on macOS, replace the installed application; on Ubuntu, install the new `.deb`. For Web, stop the server and extract the new archive into a separate directory while retaining the same data directory. Automatic application updates are disabled. Settings and sessions live outside the application directory; back them up before installing a release with migration or compatibility warnings. Read release-specific recovery instructions before downgrading.

## Troubleshooting

If no installer exists for your platform, use [source development](development.md) on a supported environment or wait for a qualified package. An empty Releases page does not mean the source archives can be installed.

For startup failures, preserve the displayed error and diagnostics; do not erase profiles or sessions as a first step. Submit the application version, operating system, architecture, and redacted error through [Issues](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/issues). Never attach credentials or an unreviewed user-data directory.
