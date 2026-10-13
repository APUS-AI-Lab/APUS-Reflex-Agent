# APUS Reflex Harness Web runtime

English | [中文](README.zh.md)

## Start the application

This Linux x64 download includes the Web server, browser application, and Node.js runtime. You need a supported Linux system and a browser; starting the application does not require Git, pnpm, an external Node installation, or Electron. The native qualification job uses Ubuntu 24.04 x64. Other Linux distributions are not yet qualified. Confined shell execution requires kernel Landlock support; the archive includes its native launcher.

1. Download `apus-reflex-harness-web-linux-x64.tar.gz` and the matching `SHA256SUMS-web-linux-x64` from the same release. Check the archive's SHA-256 against its listed value.
2. Extract the archive and enter `apus-reflex-harness-web`.
3. Run `./start.sh`. Open the authenticated localhost URL printed in the terminal. Keep that terminal running; press Ctrl+C to stop the server.
4. Open **Settings → Models** to configure your provider, API key, and model. Model requests require your provider's credentials and network access.

The listener uses `127.0.0.1:3080`. Choose another port with `./start.sh --port 8080`. The launcher does not expose a network binding option. Keep the printed authenticated URL private.

## Configuration and data

Data defaults to `$XDG_DATA_HOME/apus-reflex-web`, or `~/.local/share/apus-reflex-web` when `XDG_DATA_HOME` is unset. Set `DSH_HOME` or use `./start.sh --data-dir /absolute/path` to select another directory. Restarting with that same directory restores the profile, settings, credentials, and sessions. Keep a backup before upgrading. Replace the extracted application directory to upgrade; do not delete your data directory.

**Settings → Reflex model configuration** configures the optional Jev decision service. Choose OpenJev for APUS Reflex or Typesafe for a Typesafe service, then enter the endpoint and model supplied by your provider. Saving configuration does not test connectivity; use the connection-test action explicitly. Connecting Jev does not automatically enable advanced routing, supervision, or memory policies.

The server can start before any provider credentials are configured. A model task cannot succeed until a usable provider is configured. Installing additional plugins or invoking development tools may require software beyond this archive.

## Release verification

General Settings and the home sidebar show the product release version from `release/manifest.json`; the sidebar also includes the short source commit. Build metadata records the Harness package version separately.

The archive carries package-local license notices, root notices, and the Node.js license under `licenses/`. `files.json` records payload hashes; adjacent build metadata records the source revision, source archive hash, dependency inventory, lockfile hashes, Node version and binary hash, and final archive hash.

The native review job extracts the archive outside the checkout and starts it with a fresh data directory and no external Node, Git, pnpm, or inherited API keys. It verifies the bundled Node version and Landlock enforcement, executes shell and Node writes inside an allowed directory, rejects writes outside it, checks the home and General Settings product versions, checks HTTP, opens Models and Reflex settings, saves a keyless Reflex configuration, verifies it after restart, and waits for owned processes to exit. Its report and screenshots accompany the candidate. This qualification does not claim an external model task without provider credentials. Publication remains separate from artifact collection.

The first workspace is created automatically under `Documents/` in the persistent data directory; no system Documents configuration or desktop directory utility is required. Its files remain outside the extracted application and survive restarts and package replacement.
