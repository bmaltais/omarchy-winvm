#!/bin/bash
# Tests for bin/winvm-credential, through its command line only, against a
# credentials file in a temp directory.

set -u

CREDENTIAL="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)/bin/winvm-credential"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

export WINVM_CREDENTIALS=$TMP/credentials
printf 'USERNAME=someone\nPASSWORD=p=ss word\nEMPTY=\n' >"$WINVM_CREDENTIALS"

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

assert_output "prints the value saved under a key" "someone" "$CREDENTIAL" USERNAME
assert_output "keeps an = and a space inside the value" "p=ss word" "$CREDENTIAL" PASSWORD
assert_status "a key that is not there fails" 1 "$CREDENTIAL" DOMAIN
assert_status "a key with nothing saved fails" 1 "$CREDENTIAL" EMPTY
assert_status "a missing file fails" 1 env WINVM_CREDENTIALS="$TMP/none" "$CREDENTIAL" USERNAME
assert_status "no key is a usage error" 2 "$CREDENTIAL"

((failed)) && exit 1
exit 0
