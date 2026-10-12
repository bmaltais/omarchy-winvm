#!/bin/bash
# Tests for bin/winvm-tune, through its command line only.
#
# The compose, credentials and disk image are files in a temp directory, the
# host's size comes from the environment, and apply runs with
# WINVM_TUNE_DRY_RUN=1: nothing is written and nothing prompts.

set -u

TUNE="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)/bin/winvm-tune"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

export WINVM_COMPOSE=$TMP/docker-compose.yml WINVM_CREDENTIALS=$TMP/credentials WINVM_IMAGE=$TMP/data.img
export WINVM_HOST_CORES=12 WINVM_HOST_RAM_GB=32 WINVM_FREE_GB=150 WINVM_RUNNING=0 WINVM_TUNE_DRY_RUN=1

cat >"$WINVM_COMPOSE" <<'COMPOSE'
services:
  windows:
    environment:
      RAM_SIZE: "8G"
      CPU_CORES: "4"
      DISK_SIZE: "64G"
COMPOSE
printf 'USERNAME=someone\nPASSWORD=p=ss word\n' >"$WINVM_CREDENTIALS"
truncate -s 64G "$WINVM_IMAGE"

failed=0
ok() { echo "ok - $1"; }
not_ok() { echo "not ok - $1 ($2)"; failed=1; }

# assert_status <name> <expected> <command...>
assert_status() {
  local name=$1 want=$2 got
  shift 2
  "$@" >/dev/null 2>&1
  got=$?
  if [[ $got == "$want" ]]; then ok "$name"; else not_ok "$name" "exit $got, wanted $want"; fi
}

# assert_output <name> <expected> <command...>
assert_output() {
  local name=$1 want=$2 got
  shift 2
  got=$("$@" 2>&1)
  if [[ $got == "$want" ]]; then ok "$name"; else not_ok "$name" "got: $got"; fi
}

assert_output "limits reports the host and the VM's shape" \
  '{"hostCores":12,"hostRamGb":32,"freeGb":150,"cores":4,"ramGb":8,"diskGb":64}' "$TUNE" limits

assert_output "limits reads the shape as unknown without a compose" \
  '{"hostCores":12,"hostRamGb":32,"freeGb":150,"cores":0,"ramGb":0,"diskGb":64}' \
  env WINVM_COMPOSE="$TMP/none" "$TUNE" limits

assert_output "apply hands the writer the new shape and the login, password masked" \
  $'RAM=16G\nCORES=6\nDISK=64G\nUSERNAME=someone\nPASSWORD=***\nTZ='"$(timedatectl show -p Timezone --value 2>/dev/null || echo UTC)" \
  "$TUNE" apply 6 16 64

assert_status "a bigger disk that fits is accepted" 0 "$TUNE" apply 4 8 128
assert_status "a running VM is refused" 2 env WINVM_RUNNING=1 "$TUNE" apply 6 16 64
assert_status "one core is refused" 2 "$TUNE" apply 1 8 64
assert_status "more cores than the host has is refused" 2 "$TUNE" apply 13 8 64
assert_status "less RAM than Windows 11 needs is refused" 2 "$TUNE" apply 4 2 64
assert_status "more RAM than the host has is refused" 2 "$TUNE" apply 4 64 64
assert_status "a smaller disk is refused" 2 "$TUNE" apply 4 8 32
assert_status "a disk with no room to grow into is refused" 2 "$TUNE" apply 4 8 256
assert_status "a full drive does not stop a change of cores" 0 env WINVM_FREE_GB=0 "$TUNE" apply 6 8 64
assert_status "something that is not a number is refused" 2 "$TUNE" apply 4 8G 64
assert_status "a missing argument is refused" 2 "$TUNE" apply 4 8
assert_status "missing credentials are refused" 2 env WINVM_CREDENTIALS="$TMP/none" "$TUNE" apply 6 16 64
assert_status "an unknown verb is a usage error" 2 "$TUNE" frobnicate
assert_status "no verb is a usage error" 2 "$TUNE"

((failed)) && exit 1
exit 0
