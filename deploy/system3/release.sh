#!/usr/bin/env bash
set -euo pipefail
# Run on litellm with a source archive whose checks have passed.
root=$(cd "$(dirname "$0")/../.." && pwd)
release_id=${1:?usage: release.sh immutable-release-id source-commit}
source_commit=${2:?source Git commit is required for build metadata}
[[ $release_id =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { echo 'Invalid release id' >&2; exit 2; }
[[ $source_commit =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid source commit' >&2; exit 2; }
[[ -s /etc/xdan-system3/runtime.env ]] || { echo 'Missing protected runtime credentials' >&2; exit 1; }
image="xdan-system3:$release_id"
release="/opt/xdan-system3/releases/$release_id"
[[ ! -e $release ]] || { echo 'Release directory already exists' >&2; exit 1; }
if docker image inspect "$image" >/dev/null 2>&1; then
  echo 'Release image already exists; choose a new immutable release id' >&2
  exit 1
fi
docker build --build-arg "DSH_CLIENT_COMMIT_HASH=$source_commit" -f "$root/deploy/system3/Dockerfile" -t "$image" "$root"
install -d -m 755 "$release/bin"
container=$(docker create "$image")
switch=/opt/xdan-system3/current.next.$$
previous_switch=/opt/xdan-system3/previous.next.$$
trap 'docker rm "$container" >/dev/null 2>&1 || true; rm -f "$switch" "$previous_switch"' EXIT
docker cp "$container:/app" "$release/app"
docker cp "$container:/usr/local/." "$release"
docker cp "$container:/usr/bin/bwrap" "$release/bin/bwrap"
chown -R root:root "$release"
chmod -R go-w "$release"
chmod 755 "$release/bin/node" "$release/bin/bwrap"
id xdan-system3 >/dev/null 2>&1 || useradd --system --home-dir /var/lib/xdan-system3/home --shell /usr/sbin/nologin xdan-system3
install -d -m 700 -o xdan-system3 -g xdan-system3 /var/lib/xdan-system3 /var/lib/xdan-system3/home /var/lib/xdan-system3/workspace
"$release/bin/node" "$release/app/apps/cli/lib/bin.js" --version
previous=
if [[ -L /opt/xdan-system3/current ]]; then
  previous=$(readlink -f /opt/xdan-system3/current)
fi
install -m 644 "$root/deploy/system3/xdan-system3.service" "$release/service.unit"
if [[ -f /etc/systemd/system/xdan-system3.service ]]; then
  cp /etc/systemd/system/xdan-system3.service "$release/previous.service"
  # Adopt a legacy active release before its first paired rollback.
  if [[ -n $previous && ! -f $previous/service.unit ]]; then
    install -m 644 /etc/systemd/system/xdan-system3.service "$previous/service.unit"
  fi
fi
restore_previous() {
  if [[ -f $release/previous.service ]]; then
    install -m 644 "$release/previous.service" /etc/systemd/system/xdan-system3.service
    systemctl daemon-reload
  fi
  if [[ -n $previous ]]; then
    ln -s "$previous" "$switch"
    mv -Tf "$switch" /opt/xdan-system3/current
    systemctl restart xdan-system3.service
  else
    systemctl stop xdan-system3.service
  fi
}
activate() {
  install -m 644 "$release/service.unit" /etc/systemd/system/xdan-system3.service &&
    systemctl daemon-reload &&
    systemctl enable xdan-system3.service >/dev/null &&
    systemctl restart xdan-system3.service
}
ln -s "$release" "$switch"
mv -Tf "$switch" /opt/xdan-system3/current
if ! activate; then
  restore_previous
  echo 'Activation failed; previous release restored when available' >&2
  exit 1
fi
for attempt in $(seq 1 60); do
  status=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:18731/api/remote.mux || true)
  if [[ $status == 401 ]] && systemctl is-active --quiet xdan-system3.service; then
    if [[ -n $previous ]]; then
      ln -s "$previous" "$previous_switch"
      mv -Tf "$previous_switch" /opt/xdan-system3/previous
    fi
    printf 'Deployed %s: authenticated loopback service is ready\n' "$release_id"
    exit 0
  fi
  sleep 2
done
restore_previous
echo 'Candidate failed health/auth check; previous release restored when available' >&2
exit 1
