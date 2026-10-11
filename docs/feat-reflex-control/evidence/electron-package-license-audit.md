# Electron package brand and license audit

English | [中文](electron-package-license-audit.zh.md)

The existing unsigned macOS arm64 directory package was inspected directly. `Info.plist` identifies `APUS Reflex Harness Dev`; `Resources/brand.json` carries `APUS Reflex Harness`, `APUS / REFLEX`, and the Model as Harness metadata. The four packaged license/notice files are byte-equal to their Frontend and Harness source files, so the MIT text, original attribution, and third-party notices are retained.

The directory package was rebuilt from the current clean Harness branch. Its deployed runtime manifest now matches that source, and a real `--safe-mode --remote-debugging-port=19224` launch reached the CDP endpoint before the owned processes were cleaned up. The machine has no valid Developer ID identity and no stapled notarization ticket; signed/notarized release remains an external CI credential gate.

See the [sanitized audit](electron-package-license-audit.json) for the exact fields and scope.
