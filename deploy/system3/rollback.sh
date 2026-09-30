#!/usr/bin/env bash
set -euo pipefail
previous=$(readlink -f /opt/xdan-system3/previous || true)
[[ -n $previous && -x $previous/bin/node ]] || { echo 'No previous release exists' >&2; exit 1; }
current=$(readlink -f /opt/xdan-system3/current || true)
if [[ -f $current/previous.service ]]; then
  install -m 644 "$current/previous.service" /etc/systemd/system/xdan-system3.service
  systemctl daemon-reload
fi
switch=/opt/xdan-system3/current.next.$$
trap 'rm -f "$switch"' EXIT
ln -s "$previous" "$switch"
mv -Tf "$switch" /opt/xdan-system3/current
systemctl restart xdan-system3.service
for attempt in $(seq 1 60); do
  status=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:18731/api/remote.mux || true)
  if [[ $status == 401 ]] && systemctl is-active --quiet xdan-system3.service; then
    echo 'Previous compatible release restored; persistent sessions retained.'
    exit 0
  fi
  sleep 2
done
echo 'Rollback did not become healthy; inspect the restricted service journal.' >&2
exit 1
