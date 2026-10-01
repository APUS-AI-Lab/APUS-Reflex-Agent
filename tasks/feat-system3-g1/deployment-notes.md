# Deployment handoff notes

## Current deployment

Reviewed tag `system3-g1-reviewed-rc2` is deployed on `root@litellm` as the independent, enabled `xdan-system3.service`. The stable release remains active after a tested same-revision rollback. Exact source revision, release IDs, process IDs, artifact hashes and task receipts are in `docs/feat-system3-g1/deployment-final.json`. Existing LiteLLM, Caddy and Owlume services were not reconfigured.

The application uses Node 24.21.0 and CLI 0.1.7-rc.2, listens only on 127.0.0.1:18731, and runs as xdan-system3. Anonymous API access returns 401; untrusted Origin and Host return 403. Public task data lives in /var/lib/xdan-system3/workspace; the external oracle is not in that workspace. Service home is /var/lib/xdan-system3/home. Docker builds Linux artifacts; systemd runs them with native bubblewrap and credential scrub.

## Acceptance

The real browser task selected and injected csv-reconciliation, received an actual Fidoo response, executed native tools, and passed two strict external artifact checks after a native follow-up removed an extra field. Jev's low-confidence entry outcome correctly retained the configured baseline. A tool subprocess reported both credential names absent. User cancellation, fixed-model reset to automatic, same-session browser replay after restart and after rollback, and unchanged artifact hashes all passed. Desktop installation and live task evidence are in desktop-acceptance.json.

Every release saves its own service.unit. Publication updates the previous pointer only after health succeeds. Rollback selects the target artifact/unit pair, consumes its target on success, and restores the original pair on failure. Eight isolated Docker fixtures passed; the actual second rollback was rejected without changing PID or unit. No rollback target is currently pending. Do not point an older implementation at newer required Session events.

## Access and credentials

Root-only /etc/xdan-system3/runtime.env reuses the dedicated system3-dsh virtual key and Jev gateway key. Never print their values. The local private native launch URL is ~/.config/xdan-system3/launch-url (0600); refresh from restricted journal output after restart without printing tokens. Public classification is limited to explicit test material. Local launch and tunnel recovery instructions are in [the deployment reference](../../docs/feat-system3-g1/deployment.md#access-and-isolation).

## Manual access verification — 2026-10-01

The user authorized manual deployment. The independent Jev operations session compared the reviewed implementation with both current PR heads and found no newer runtime changes. It retained the accepted server and Desktop artifacts, restored the missing local SSH tunnel, and brought the existing Desktop process to the foreground. No rebuild, service restart or model call was needed.

Operations verified the authenticated SPA using its own browser state at /private/tmp/system3-g1-review-browse/browse.json: the workspace, historical public CSV sessions, new-session input and send control were visible; the title was xDAN System3 and the displayed version was rc.2. The launch query was cleared. Anonymous access remained 401. Screenshot: /private/tmp/system3-manual-access.png. At verification, the tunnel PID was 87739, Desktop PID 3582 and unchanged server PID 4148582; these are observations, not persistent identifiers.

The product session independently inspected the screenshot, existing tunnel command and installed manifest: rc.2, reviewed source, sourceDirty=false, darwin/arm64, deployed mode. It opened the private launch URL in the user's default browser without printing the token. Operations created the current tunnel; product owns subsequent access maintenance. Do not interrupt the independent review browser. The tunnel has ServerAliveInterval=30 and ServerAliveCountMax=3; it does not automatically reconnect after exiting.

This verifies access to the accepted deployment, not new task execution. The frozen task, restart and same-source rollback evidence remains authoritative. Remote CI is still blocked by Actions budget; both PRs remain unmerged. Native DSH branding remains visible in parts of the workspace.

## Operational constraints

The kernel does not activate Landlock. A disposable Docker probe could not run bubblewrap with its private proc mount; the final deployment retains native systemd confinement instead of disabling the product sandbox. Bubblewrap workspace writes passed and writes outside the workspace were rejected. DSH launcher options must precede app options: web --patch <file> --no-open.

The obsolete pre-review controller was terminated before activation, and only its unreferenced image was deleted to free space. The reviewed dual release finished with about 7.7G free disk. Do not prune shared Docker services or caches. Build and fixture log paths, exact release IDs and current health are recorded in deployment-final.json.
