# Packaging handoff

- Product identity/version/userData isolation implemented; main index identity block is done. Root owns further product-profile wiring in index.ts and generate-system3-patch.mjs.
- prepare-system3-runtime.mjs owns isolated production closure and invokes root's profile generator; system3-runtime.ts validates pinned source/target and seven own package identities. beforePack checks matching target, commit/dirty flag, required packages and 27 patch receipts.
- Never run pnpm legacy deploy against the active Harness tree: it modified source install metadata and triggered a subsequent production reinstall. Use the temporary copied tree in prepare; it retains dependency native lifecycle scripts.
- patch-system3-runtime.mjs replays runtime JS only, maps generated CSS hashes from same module/key, and adapts three reviewed API context changes. No fuzzy patching or stock package replacement. All27 passed against actual own built files; full closure including UI completed with all27 receipts, 0 symlinks, unchanged source installation metadata fingerprint and passing package gate. Parent can run Mac directory packaging now.
- Local QA before commit: prepare --deploy --allow-dirty, then SYSTEM3_ALLOW_DIRTY_PACKAGE=1 npm run build:dir. Final release requires committed source and no dirty override.
- Native QA uses SYSTEM3_DESKTOP_USER_DATA_DIR absolute path; --safe-mode exercises native recovery. Credentials remain environment inputs, never build artifacts.
- Deployment subagent also owns server release; parent owns source freeze, commits and final browser/Electron QA.

- Actual Mac package exposed electron-builder extraResources filtering node_modules. Fixed with explicit afterPack physical copy plus output package/hash/symlink checks and actual packaged Node/dsh invocation; beforePack alone is insufficient.

- Normal boot additionally requires generated PPT preview-manifest and templates: prepare now runs prepare-ppt-runtime first and deploys its generated packages. CLI artifact manifest explicitly names all six experimental packages; generated profile uses bare package names because Desktop relocates relative patch paths under DSH_HOME. Prepare and afterPack import-smoke these host entries and PPT modules.

- A native NSAlert report-confirmation dialog can block startup before any BrowserWindow: DesktopService.flush runs in bootstrap startSending and prompts over previous failed launches. System3 now skips this upstream service initialization; local harness.log remains. macOS diagnostic uses /usr/bin/sample (PATH sample here is an unrelated broken Python command).

## Native normal-mode preflight

Fourth directory package passed the final Resources gate and booted with Harness ready after 1961 ms. Native CDP showed System3 controls and the Fidoo model picker; no prompt was sent. Previous no-window hang was an upstream diagnostics NSAlert before bootstrap, confirmed by /usr/bin/sample; independent product disables that service while keeping local logs. Exact old PID was stopped with parent approval. Final clean-source packaging, safe-mode smoke, and task acceptance are still pending.
