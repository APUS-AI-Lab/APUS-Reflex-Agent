#!/usr/bin/env bash
set -euo pipefail
# Run on a workstation: release the pushed HEAD to the deployment host, wait for it, then run the browser acceptance suite.
# Usage: deploy/system3/ship.sh release-prefix [scenario ...]
prefix=${1:?usage: ship.sh release-prefix [scenario ...]}
shift
[[ $prefix =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { echo 'Invalid release prefix' >&2; exit 2; }
host=${SYSTEM3_HOST:-prd}
root=$(git rev-parse --show-toplevel)
cd "$root"
[[ -z $(git status --porcelain --untracked-files=no) ]] || { echo 'Commit or stash tracked changes first' >&2; exit 1; }
commit=$(git rev-parse HEAD)
git branch -r --contains "$commit" | grep -q . || { echo "HEAD $commit is not on any pushed branch" >&2; exit 1; }
id="$prefix-${commit:0:10}"
archive=$(mktemp -t system3-ship.XXXXXX)
trap 'rm -f "$archive"' EXIT
git archive --format=tar.gz -o "$archive" "$commit"
scp -q "$archive" "$host:/tmp/system3-$id.tar.gz"
ssh -n -o BatchMode=yes "$host" "set -e; rm -rf /root/system3-release; mkdir -p /root/system3-release/$id
  tar xzf /tmp/system3-$id.tar.gz -C /root/system3-release/$id; rm /tmp/system3-$id.tar.gz; cd /root/system3-release/$id
  (setsid nohup bash deploy/system3/release.sh $id $commit > /root/xdan-system3-release-$id.log 2>&1 < /dev/null &)"
echo "releasing $id"
# release.sh prints "Deployed <id>" on success; anything else after it exits is a failure.
# The bracketed pattern keeps pgrep from matching the remote shell that runs this check.
# The host rate-limits SSH, so polls are 30 s apart and a refused connection counts as "still running".
remote=(ssh -n -o BatchMode=yes -o ConnectTimeout=20 "$host")
deadline=$((SECONDS + 45 * 60))
until "${remote[@]}" "grep -q '^Deployed' /root/xdan-system3-release-$id.log || ! pgrep -f '[r]elease.sh $id' >/dev/null"; do
  ((SECONDS < deadline)) || { echo "release $id did not finish within 45 minutes" >&2; exit 1; }
  sleep 30
done
if ! "${remote[@]}" "grep -q '^Deployed' /root/xdan-system3-release-$id.log"; then
  "${remote[@]}" "tail -20 /root/xdan-system3-release-$id.log" >&2
  echo "release $id failed" >&2
  exit 1
fi
echo "deployed $id; running browser acceptance"
python3 -u "$root/deploy/system3/acceptance/accept.py" "$@"
