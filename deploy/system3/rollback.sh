#!/usr/bin/env bash
set -euo pipefail
[[ -L /opt/xdan-system3/previous ]] || { echo 'No unconsumed rollback target exists' >&2; exit 1; }
previous=$(readlink -f /opt/xdan-system3/previous || true)
current=$(readlink -f /opt/xdan-system3/current || true)
[[ -n $previous && $previous != "$current" && -x $previous/bin/node && -f $previous/service.unit ]] || { echo 'No compatible paired rollback target exists' >&2; exit 1; }
[[ -n $current && -f $current/service.unit ]] || { echo 'Current release has no saved unit' >&2; exit 1; }
switch=/opt/xdan-system3/current.next.$$
trap 'rm -f "$switch"' EXIT
select_release() {
  install -m 644 "$1/service.unit" /etc/systemd/system/xdan-system3.service &&
    systemctl daemon-reload &&
    ln -s "$1" "$switch" &&
    mv -Tf "$switch" /opt/xdan-system3/current &&
    systemctl restart xdan-system3.service
}
restore_current() {
  rm -f "$switch"
  select_release "$current"
}
if ! select_release "$previous"; then
  restore_current
  echo 'Rollback activation failed; original release restored' >&2
  exit 1
fi
for attempt in $(seq 1 60); do
  status=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:18731/api/remote.mux || true)
  if [[ $status == 401 ]] && systemctl is-active --quiet xdan-system3.service; then
    rm /opt/xdan-system3/previous
    echo 'Previous compatible release restored; rollback target consumed; persistent sessions retained.'
    exit 0
  fi
  sleep 2
done
restore_current
echo 'Rollback did not become healthy; original release restored.' >&2
exit 1
