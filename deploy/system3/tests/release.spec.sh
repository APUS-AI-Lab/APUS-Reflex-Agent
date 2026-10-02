#!/usr/bin/env bash
set -euo pipefail
[[ -f /.dockerenv && ! -e /opt/xdan-system3 ]] || { echo 'This test requires a clean disposable container' >&2; exit 1; }
mkdir -p /test/bin /test/source/deploy/system3 /etc/xdan-system3 /etc/systemd/system
cp /work/deploy/system3/{release.sh,rollback.sh,xdan-system3.service} /test/source/deploy/system3/
mkdir -p /test/source/deploy/system3/codex && cp /work/deploy/system3/codex/config.toml /test/source/deploy/system3/codex/
printf 'FIXTURE=public\n' > /etc/xdan-system3/runtime.env
id xdan-system3 >/dev/null 2>&1 || useradd --system xdan-system3
cat > /test/bin/docker <<'SH'
#!/bin/bash
set -eu
case "$1" in
image) exit 1;;
build) exit 0;;
create) echo fixture-container;;
rm) exit 0;;
cp)
  case "$2" in
  *:/app)
    [[ ${FAIL_COPY:-0} == 0 ]] || exit 1
    mkdir -p "$3/apps/cli/lib"
    touch "$3/apps/cli/lib/bin.js";;
  *:/usr/local/.)
    mkdir -p "$3/bin"
    printf '#!/bin/bash\necho 0.1.7-rc.2\n' > "$3/bin/node"
    chmod +x "$3/bin/node";;
  *:/usr/bin/bwrap) printf '#!/bin/bash\nexit 0\n' > "$3";;
  *) exit 2;;
  esac;;
*) exit 2;;
esac
SH
cat > /test/bin/systemctl <<'SH'
#!/bin/bash
set -eu
if [[ $1 == restart ]]; then
  selected=$(readlink -f /opt/xdan-system3/current)
  printf '%s %s\n' "$selected" "$(cat /etc/systemd/system/xdan-system3.service)" >> /test/restarts
  if [[ ${FAIL_RESTART:-0} == 1 && $selected != /opt/xdan-system3/releases/old ]]; then exit 1; fi
  if [[ -n ${FAIL_TARGET:-} && $selected == /opt/xdan-system3/releases/$FAIL_TARGET ]]; then exit 1; fi
fi
exit 0
SH
cat > /test/bin/curl <<'SH'
#!/bin/bash
if [[ ${FAIL_HEALTH:-0} == 1 && $(readlink -f /opt/xdan-system3/current) != /opt/xdan-system3/releases/old ]]; then printf 000; else printf 401; fi
SH
printf '#!/bin/bash\nexit 0\n' > /test/bin/sleep
chmod +x /test/bin/*
export PATH=/test/bin:$PATH
setup_case() {
  rm -rf /opt/xdan-system3
  mkdir -p /opt/xdan-system3/releases/old/bin
  printf '#!/bin/bash\nexit 0\n' > /opt/xdan-system3/releases/old/bin/node
  chmod +x /opt/xdan-system3/releases/old/bin/node
  ln -s /opt/xdan-system3/releases/old /opt/xdan-system3/current
  printf 'old-unit\n' > /etc/systemd/system/xdan-system3.service
  cp /work/deploy/system3/xdan-system3.service /test/source/deploy/system3/xdan-system3.service
  : > /test/restarts
}
assert_old() {
  [[ $(readlink -f /opt/xdan-system3/current) == /opt/xdan-system3/releases/old ]]
  [[ $(cat /etc/systemd/system/xdan-system3.service) == old-unit ]]
}
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
setup_case
bash /test/source/deploy/system3/release.sh test-success "$sha"
[[ $(readlink -f /opt/xdan-system3/current) == /opt/xdan-system3/releases/test-success ]]
bash /test/source/deploy/system3/rollback.sh
assert_old
printf 'PASS successful release and manual rollback restore previous unit and artifact\n'
setup_case
if FAIL_RESTART=1 bash /test/source/deploy/system3/release.sh test-restart "$sha"; then exit 1; fi
assert_old
printf 'PASS activation failure restores previous unit and artifact\n'
setup_case
if FAIL_HEALTH=1 bash /test/source/deploy/system3/release.sh test-health "$sha"; then exit 1; fi
assert_old
printf 'PASS authentication/health failure restores previous unit and artifact\n'
setup_case
if FAIL_COPY=1 bash /test/source/deploy/system3/release.sh test-copy "$sha"; then exit 1; fi
assert_old
printf 'PASS extraction failure leaves active release unchanged\n'
setup_case
if bash /test/source/deploy/system3/release.sh invalid/id "$sha"; then exit 1; fi
assert_old
printf 'PASS invalid release identifier is rejected before activation\n'

setup_case
printf 'unit-B\n' > /test/source/deploy/system3/xdan-system3.service
bash /test/source/deploy/system3/release.sh B "$sha"
[[ $(readlink -f /opt/xdan-system3/previous) == /opt/xdan-system3/releases/old ]]
printf 'unit-C\n' > /test/source/deploy/system3/xdan-system3.service
if FAIL_TARGET=C bash /test/source/deploy/system3/release.sh C "$sha"; then exit 1; fi
[[ $(readlink -f /opt/xdan-system3/current) == /opt/xdan-system3/releases/B ]]
[[ $(readlink -f /opt/xdan-system3/previous) == /opt/xdan-system3/releases/old ]]
[[ $(cat /etc/systemd/system/xdan-system3.service) == unit-B ]]
bash /test/source/deploy/system3/rollback.sh
assert_old
printf 'PASS failed third release preserves the earlier rollback target and paired units\n'
setup_case
printf 'unit-B\n' > /test/source/deploy/system3/xdan-system3.service
bash /test/source/deploy/system3/release.sh B "$sha"
printf 'unit-C\n' > /test/source/deploy/system3/xdan-system3.service
bash /test/source/deploy/system3/release.sh C "$sha"
bash /test/source/deploy/system3/rollback.sh
[[ $(readlink -f /opt/xdan-system3/current) == /opt/xdan-system3/releases/B ]]
[[ $(cat /etc/systemd/system/xdan-system3.service) == unit-B ]]
[[ ! -e /opt/xdan-system3/previous ]]
cp /test/restarts /test/restarts.before
if bash /test/source/deploy/system3/rollback.sh; then exit 1; fi
cmp /test/restarts.before /test/restarts
[[ $(readlink -f /opt/xdan-system3/current) == /opt/xdan-system3/releases/B ]]
[[ $(cat /etc/systemd/system/xdan-system3.service) == unit-B ]]
printf 'PASS repeated rollback is rejected without restarting or changing the unit\n'
setup_case
printf 'unit-B\n' > /test/source/deploy/system3/xdan-system3.service
bash /test/source/deploy/system3/release.sh B "$sha"
printf 'unit-C\n' > /test/source/deploy/system3/xdan-system3.service
bash /test/source/deploy/system3/release.sh C "$sha"
if FAIL_TARGET=B bash /test/source/deploy/system3/rollback.sh; then exit 1; fi
[[ $(readlink -f /opt/xdan-system3/current) == /opt/xdan-system3/releases/C ]]
[[ $(readlink -f /opt/xdan-system3/previous) == /opt/xdan-system3/releases/B ]]
[[ $(cat /etc/systemd/system/xdan-system3.service) == unit-C ]]
printf 'PASS failed rollback restores original release and unit while retaining the target\n'
