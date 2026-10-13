# Windows canonical paths

English | [中文](path-compatibility.zh.md)

Windows native CI built the installer but exposed two failures under an 8.3 temporary path: the image writer passed a noncanonical working directory into a canonical-path guard, and the PPT CLI compared a canonical argv path with an unnormalized module URL.

## Implementation

Canonicalize the image writer working directory before materialization, as the host workspace resolver already does. Keep rejection of linked generated-image directories and target files. Compare canonical filesystem paths for both the invoked PPT entry and its module URL; imports remain inert and direct or npm-linked invocations run the CLI. No API, credential or persistence changes.

## Files and validation

Change the maintained image writer and PPT compiler seeds, their owning README statements, and the existing clean-source subprocess regressions as needed. Run image confinement and PPT CLI regressions locally, then the complete native Windows desktop tests and installed-application qualification. Read source from the Git index so generated local copies cannot mask a missing fix.
