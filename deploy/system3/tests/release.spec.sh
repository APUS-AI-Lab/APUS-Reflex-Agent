#!/usr/bin/env bash
set -euo pipefail
[[ -f /.dockerenv && ! -e /opt/xdan-system3 ]] || { echo 'This test requires a clean disposable container' >&2; exit 1; }
mkdir -p /test/bin /etc/xdan-system3 /etc/systemd/system
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
if [[ $1 == restart && ${FAIL_RESTART:-0} == 1 && $(readlink -f /opt/xdan-system3/current) != /opt/xdan-system3/releases/old ]]; then exit 1; fi
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
}
assert_old() {
  [[ $(readlink -f /opt/xdan-system3/current) == /opt/xdan-system3/releases/old ]]
  [[ $(cat /etc/systemd/system/xdan-system3.service) == old-unit ]]
}
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
setup_case
bash /work/deploy/system3/release.sh test-success "$sha"
[[ $(readlink -f /opt/xdan-system3/current) == /opt/xdan-system3/releases/test-success ]]
bash /work/deploy/system3/rollback.sh
assert_old
printf 'PASS successful release and manual rollback restore previous unit and artifact\n'
setup_case
if FAIL_RESTART=1 bash /work/deploy/system3/release.sh test-restart "$sha"; then exit 1; fi
assert_old
printf 'PASS activation failure restores previous unit and artifact\n'
setup_case
if FAIL_HEALTH=1 bash /work/deploy/system3/release.sh test-health "$sha"; then exit 1; fi
assert_old
printf 'PASS authentication/health failure restores previous unit and artifact\n'
setup_case
if FAIL_COPY=1 bash /work/deploy/system3/release.sh test-copy "$sha"; then exit 1; fi
assert_old
printf 'PASS extraction failure leaves active release unchanged\n'
setup_case
if bash /work/deploy/system3/release.sh invalid/id "$sha"; then exit 1; fi
assert_old
printf 'PASS invalid release identifier is rejected before activation\n'
