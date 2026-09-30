# Deployment handoff notes

## Current deployment

Reviewed tag `system3-g1-reviewed-rc2` is deployed on `root@litellm` as the independent, enabled `xdan-system3.service`. The stable release remains active after a tested same-revision rollback. Exact source revision, release IDs, process IDs, artifact hashes and task receipts are in `docs/feat-system3-g1/deployment-final.json`. Existing LiteLLM, Caddy and Owlume services were not reconfigured.

The application uses Node 24.21.0 and CLI 0.1.7-rc.2, listens only on 127.0.0.1:18731, and runs as xdan-system3. Anonymous API access returns 401; untrusted Origin and Host return 403. Public task data lives in /var/lib/xdan-system3/workspace; the external oracle is not in that workspace. Service home is /var/lib/xdan-system3/home. Docker builds Linux artifacts; systemd runs them with native bubblewrap and credential scrub.

## Acceptance

The real browser task selected and injected csv-reconciliation, received an actual Fidoo response, executed native tools, and passed two strict external artifact checks after a native follow-up removed an extra field. Jev's low-confidence entry outcome correctly retained the configured baseline. A tool subprocess reported both credential names absent. User cancellation, fixed-model reset to automatic, same-session browser replay after restart and after rollback, and unchanged artifact hashes all passed. Desktop installation and live task evidence are in desktop-acceptance.json.

Every release saves its own service.unit. Publication updates the previous pointer only after health succeeds. Rollback selects the target artifact/unit pair, consumes its target on success, and restores the original pair on failure. Eight isolated Docker fixtures passed; the actual second rollback was rejected without changing PID or unit. No rollback target is currently pending. Do not point an older implementation at newer required Session events.

## Access and credentials

Root-only /etc/xdan-system3/runtime.env reuses the dedicated system3-dsh virtual key and Jev gateway key. Never print their values. The local private native launch URL is ~/.config/xdan-system3/launch-url (0600); refresh from restricted journal output after restart without printing tokens. The parent owns the SSH tunnel on local18731. Public classification is limited to explicit test material.

## Operational constraints

The kernel does not activate Landlock. A disposable Docker probe could not run bubblewrap with its private proc mount; the final deployment retains native systemd confinement instead of disabling the product sandbox. Bubblewrap workspace writes passed and writes outside the workspace were rejected. DSH launcher options must precede app options: web --patch <file> --no-open.

The obsolete pre-review controller was terminated before activation, and only its unreferenced image was deleted to free space. The reviewed dual release finished with about 7.7G free disk. Do not prune shared Docker services or caches. Build and fixture log paths, exact release IDs and current health are recorded in deployment-final.json.
