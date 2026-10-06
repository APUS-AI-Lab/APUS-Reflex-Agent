# System3 server deployment reference

English | [中文](deployment.zh.md)

## Scope

The independent `xdan-system3.service` runs on `root@litellm`. Docker builds the Linux source and dependencies; the application runs as the dedicated `xdan-system3` system user. Existing LiteLLM, Caddy and Owlume containers remain separate. The runtime starts the supported `dsh web` profile with `deploy/system3/runtime.patch.yml`. Release directories are root-owned and immutable to the service user; `/opt/xdan-system3/current` selects the active release.

## Access and isolation

The application binds `127.0.0.1:18731`. Connect with `ssh -N -L 18731:127.0.0.1:18731 root@litellm`, then privately retrieve the native launch URL from the restricted service journal. The browser exchanges its launch token for the native signed, authority-bound cookie; anonymous API calls remain rejected. SSH authenticates transport access and the Harness cookie authenticates API access. No public Caddy route or DNS change is required.

The local installation is `~/Applications/xDAN System3.app`; double-click `~/Applications/启动 xDAN System3.command` or run `~/.local/bin/xdan-system3` to start Desktop. The first Web authentication URL is stored in the mode-0600 `~/.config/xdan-system3/launch-url` and opened in the local browser; never print this file in chat or shared logs. An authenticated browser can access `http://127.0.0.1:18731`; unauthenticated access returns 401.

The SSH tunnel is separate from the systemd service and may exit after a network interruption. Restore it with the command below only when local port 18731 has no listener; retain existing tunnel and service processes.

```sh
ssh -fN -o BatchMode=yes -o ConnectTimeout=10 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:18731:127.0.0.1:18731 root@litellm
```

The systemd unit uses an empty capability set, NoNewPrivileges, ProtectSystem=strict, ProtectHome, PrivateTmp, PrivateDevices, ProtectProc=invisible and RestrictSUIDSGID. Only `/var/lib/xdan-system3` is writable; private home and task workspace remain separate. Existing application directories and the environment-file directory are inaccessible inside the service. The service has a 2 GiB memory limit, 2 CPU quota and 256-task limit. Native workspace-write permissions remain enabled; subprocesses use the native credential scrub and bubblewrap.

The root-only `/etc/xdan-system3/runtime.env` reuses the existing `system3-dsh` virtual key and supplies `SYSTEM3_LITELLM_API_KEY`, `JEV_API_KEY` and the explicit JSON `SYSTEM3_SESSION_DATA_CLASSES`. The acceptance environment declares only public material; operators must not put personal or confidential files into this workspace. Classification is a deployment declaration, not automatic sanitization. Credentials never enter build artifacts or frontend bundles. Native browser credentials persist in the private Harness home. DeepSeek session-log contribution and telemetry delivery are disabled.

## Release and recovery

Run `deploy/system3/release.sh <immutable-release-id> <source-commit>` on the server from a reviewed source archive. The script installs dependencies from the lockfile and builds Linux artifacts in the pinned Node image, extracts the application and matching Node/bubblewrap binaries, creates a root-owned release directory, selects it atomically, then restarts only the System3 unit. The source commit is embedded in client metadata and the image label. Release health requires an active process and HTTP 401 for an anonymous API request. Only a healthy publication updates the previous-release pointer; failed publications retain the existing rollback target. Each release saves its own `service.unit`; an active legacy release receives its current unit once before replacement.

`deploy/system3/rollback.sh` selects the compatible predecessor with that release’s saved unit and preserves sessions. A successful rollback consumes its target; a repeated invocation fails without restarting or changing the unit. A failed rollback restores the original release and unit and retains the target. Application rollback does not reverse session-format or database migrations; take a stopped-service backup before releases changing persistent formats. `Restart=on-failure` and the enabled systemd unit recover after process failure or host restart. Availability checks do not establish task acceptance: separately verify browser authentication, actual Jev selection, Fidoo output, Skill adoption, native shell execution, artifact correctness, cancellation and persistence after restart.

## Source files

| File | Purpose |
| --- | --- |
| `deploy/system3/Dockerfile` | Pinned Linux build with source metadata |
| `deploy/system3/Dockerfile.dockerignore` | Excludes local dependencies, build outputs and common secret files |
| `deploy/system3/runtime.patch.yml` | Loopback transport, model routes and explicit System3 policy |
| `deploy/system3/xdan-system3.service` | Dedicated user, filesystem isolation and resource limits |
| `deploy/system3/release.sh` | Build, extract, switch and health validation |
| `deploy/system3/rollback.sh` | Compatible previous-release recovery |
| `deploy/system3/tests/release.spec.sh` | Isolated fault injection for release and rollback |

## Verified deployment constraints

The target runs TencentOS x86_64, kernel 6.6.117, glibc 2.38, systemd 255 and Docker 29.8.1. The pinned Node image runs 24.21.0. The dedicated System3 key successfully listed both configured Fidoo models; the A100 Jev health endpoint reported ready/high32. The baseline rc.2 Linux build passed native compilation, Host and Client TypeScript/bundling, desktop bundle and Web build (343 client artifacts).

The kernel has no active Landlock LSM. A non-root container with default Docker seccomp could not create the bubblewrap namespace; a diagnostic container without that filter still could not mount the private proc filesystem. The deployment therefore uses native systemd instead of weakening container controls. Bubblewrap on the host and under the selected systemd hardening both passed workspace writes and rejected writes to the same user's home with a read-only-filesystem error. The native environment scrub also passed a child-process check with both deployed credential names present only in the parent. Eight isolated release-script cases passed: publish/manual rollback, activation failure, HTTP/auth health failure, extraction failure, invalid release identifier, failed third publication preserving the earlier rollback target, repeated rollback without service mutation, and failed rollback restoring the original release/unit pair. Initial browser task evidence is in `deployment-preflight.json`. Reviewed tag `system3-g1-reviewed-rc2` remains active as the stable release after a successful same-commit rollback from the verification release; the rollback target was consumed. Both Linux builds and release health checks passed; the actual CLI reports `0.1.7-rc.2` on Node 24.21.0. Anonymous API access returns 401, untrusted Origin/Host requests return 403, and the enabled non-root service binds loopback only. Infrastructure evidence, including the exact source commit, is in [deployment-final.json](deployment-final.json); the real browser task, credential scrub, cancellation, model reset, strict artifact oracle and same-session browser replay after both restart and rollback passed. The initial artifact had an extra field; a native continuation removed it before final oracle acceptance. The real entry decision abstained on low confidence and used the configured baseline; the Skill decision injected the selected instructions into the actual Fidoo request.
