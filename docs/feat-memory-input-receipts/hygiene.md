# Frontend integration hygiene repair

This follow-up removes 34 historical assertions to unknown without increasing the baseline and corrects vendor-rescope false positives for runtime identifiers. All affected frontend files matched origin/main before editing. The input receipt behavior is unchanged.

The rescope pass preserves only registered exact file/literal occurrences with expected counts; imports and dependencies in those same files remain checked. Built-in preset IDs, executable names and scoped-package path segments retain their values. Parser results retain extra fields and their existing acceptance rules. Tests use structurally typed fetch/DOM dependencies and direct fixtures, with no replacement assertions to any.

Files: scripts/rescope-vendor.ts and its tests; the 13 frontend files reported by verify-no-unknown-casts; a narrow boot-failure document reader signature; affected README pairing. API behavior is unchanged; the reader accepts its actual querySelector requirement instead of an entire Document.

Verification: rescope check and unknown-cast check; script tests including wrong-file/additional-import/duplicate-exemption negative cases; affected frontend tests; frontend node typecheck; Ruff and diff review. No baseline expansion, migration removal, whole-file exclusion, package renaming or production lifecycle change.
