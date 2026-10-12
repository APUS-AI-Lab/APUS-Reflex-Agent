# System3 desktop runtime closure

English | [中文](README.zh.md)

This private dependency manifest supplies the built rc.2 Harness CLI, Web assets, native profile dependencies and System3/Reflex plugins to the separate APUS-Reflex-Frontend application. It exposes no application entry or executable; the desktop application launches the deployed `dsh` profile.

Build the Harness artifacts before deploying this package. The Frontend preparation script owns assembly, runtime identity checks and platform packaging. Development may resolve an explicitly selected Harness workspace; packaged applications require a complete deployed dependency tree and must not fall back to an installed stock DSH package. Credentials remain outside this package and its artifacts.

The normal APUS profile declares the Reflex provider bundle below its user patches, so the dedicated settings page can persist edits. Server startup runs `../prepare-profile.mjs` before `dsh web`; Desktop startup declares the same bundle during profile maintenance. Both preserve existing user patches, and command-line deployment overlays omit the `jev` row.

The deployment enables bounded Codex action summaries for Goal supervision. Reflex receives operation categories and workspace-relative paths only when the existing remote policy explicitly approves the `workspace` data class; otherwise supervision retains its operation fingerprints without those summaries. Raw commands, output, search queries, diffs and private reasoning are excluded. See the [supervision configuration](../../../packages/experimental/system3/README.md).
