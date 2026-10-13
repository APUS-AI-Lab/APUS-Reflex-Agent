# APUS Reflex Agent editions

English | [中文](README.zh.md)

Full and Lite use the same Agent runtime and application identity. Their difference is the bundled Office engine; downloads and acceptance status belong to [Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases).

| Capability | Full | Lite |
| --- | --- | --- |
| Agent, Reflex, memory and tools | Included | Included |
| Codex and PPT workbench | Included | Included |
| PDF, image, text and browser spreadsheet previews | Included | Included |
| Bundled Office page rendering and conversion | Included | Excluded |

Choose Full for integrated DOC/DOCX/PPT/PPTX page rendering and Office conversion. Lite offers a smaller download; unsupported previews explain the missing Host capability and retain file access. Browser XLS/XLSX previews do not require the bundled engine. Scripts that depend on LibreOffice conversion or formula recalculation require Full. Basic file operations depend on their own libraries and interpreters; Lite does not supply a replacement Office engine.

Additional custom Office skills on Lite must explicitly set `cli: false` when they do not need the engine. An explicitly enabled conversion provider fails when its engine is absent. Lite's final product overlay disables the shipped conversion provider on startup and configuration reload.

## Memory settings

Both editions prepare editable memory defaults in normal Desktop and Web profiles. Open Settings → General → Continuum memory to opt in; it starts off. The [memory profile layer](../../packages/experimental/continuum-jev/README.md) owns Session recall and separate Jev outbound approval. Existing settings and records survive restart and edition changes. Enabling this switch does not grant network access or automatically share unrelated Sessions.

<a id="macos-compatibility"></a>
## macOS compatibility

Full and Lite require macOS 15 or later. The prepared Harness native loader declares 15.0 in its actual Mach-O load commands; Node 24.9.0 requires 13.5 and Electron 43 requires 12.0. The complete application follows the highest required component version. This requirement does not certify execution on every supported macOS version; installation results belong to each release's qualification records.

| Inspected ARM64 component | Declared minimum macOS |
| --- | --- |
| Electron 43 executable, framework and helpers | 12.0 |
| Bundled Node 24.9.0 | 13.5 |
| Prepared Harness native loader 0.1.9 | 15.0 |
| node-pty and its spawn helper | 11.0 |
| Codex 0.153.4 executable | 11.0 |
| Codex bundled zsh | 15.0 |
| sherpa-onnx speech native module | 14.0 |
| Shell LibreOffice native helper | 11.0 |
| Prepared Harness LibreOffice helper 0.1.5 | 11.0 |

Product packages use a build host and Node process that match their target operating system and architecture. Passing `--x64` directly to the builder from an ARM64 process does not produce a qualified Intel package; dependency installation, runtime preparation and verification also require the matching target.

macOS previews use ad-hoc signatures that seal the application metadata and bundled resources. The builder verifies the completed application before creating DMG and ZIP files. These signatures do not provide Developer ID certification or notarization; successful signature verification does not establish Gatekeeper trust.

## Installation and upgrades

Installer filenames start with `apus-reflex-agent-full-` or `apus-reflex-agent-lite-`. Both editions preserve the previous application identifier and data location; the Debian package and installed executable keep their existing upgrade identity. Switching editions replaces the application, rather than installing a second independent copy. Back up data before upgrading; preserve the data directory when replacing a Web archive.

Source archives are not installers. Qualification is independent for each edition and platform; a Full test does not qualify Lite. The [release procedure](../feat-integrated-product/releases.md) owns build receipts, supporting filenames, checksums and publication requirements.
