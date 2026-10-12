#!/bin/bash
# Tests for bin/winvm-rdp, through its command line only.
#
# Every process here is a fake: a copy of sleep under a made-up name, found
# through WINVM_RDP_CLIENT / WINVM_RDP_LAUNCHER. A real xfreerdp3 session is
# never seen, let alone signalled.

set -u

RDP="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)/bin/winvm-rdp"
TMP=$(mktemp -d)
# comm is cut at 15 characters and pgrep -x matches on it.
CLIENT="fakerdp$$"
LAUNCHER="fakelaunch$$"
export WINVM_RDP_CLIENT=$CLIENT WINVM_RDP_LAUNCHER=$LAUNCHER
# A copy of bash that sits in `sleep` as a child, so it stays under the fake
# name (a lone `sleep` would exec itself over it) and takes any argv.
cp /bin/bash "$TMP/$CLIENT"

failed=0
pids=()

# Kill a process and everything below it, children first, so no orphaned
# sleep is left holding the test's output open.
kill_tree() {
  local child
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null
}

cleanup() {
  local p
  for p in "${pids[@]}"; do kill_tree "$p"; done
  rm -rf "$TMP"
}
trap cleanup EXIT

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

# fake_client [argv...]: run the fake client in the background, pid in $!.
fake_client() { "$TMP/$CLIENT" -c 'sleep 60; :' fake "$@" 2>/dev/null & pids+=($!); }

# Each test starts from nothing running.
reset() {
  local p
  for p in "${pids[@]}"; do kill_tree "$p"; done
  wait 2>/dev/null
  pids=()
}

# assert_equal <name> <want> <got>
assert_equal() {
  if [[ $2 == "$3" ]]; then ok "$1"; else not_ok "$1" "got '$3', wanted '$2'"; fi
}

alive() { kill -0 "$1" 2>/dev/null; }

# Wait until a process's argv is readable (the fork has exec'd).
settle() { sleep 0.3; }

# --- tests ---

reset
assert_status "open fails when nothing is running" 1 "$RDP" open

reset
"$RDP" run "$TMP/$CLIENT" -c 'sleep 60; :' fake 2>/dev/null &
pids+=($!)
settle
assert_status "a session started through run is reported open" 0 "$RDP" open

# Releases of omarchy-windows-vm up to 4.0.4 put the window title on argv.
reset
fake_client "/title:Windows VM - Omarchy"
settle
assert_status "a client with the window title on argv is reported open" 0 "$RDP" open

# Later releases pipe the arguments in, so argv shows nothing; the launcher
# is the parent instead. The fake launcher is `bash <path>/<name> launch`.
cat >"$TMP/$LAUNCHER" <<SCRIPT
"$TMP/$CLIENT" -c 'sleep 60; :' fake
:
SCRIPT
reset
bash "$TMP/$LAUNCHER" launch 2>/dev/null & pids+=($!)
settle
assert_status "a client whose parent is the launcher's launch is reported open" 0 "$RDP" open

# A process with the client's name but none of the three marks is somebody
# else's, and is left alone.
reset
fake_client --unrelated
stranger=$!
settle
assert_status "a same-named process with no mark is not a session" 1 "$RDP" open
"$RDP" close
if alive "$stranger"; then ok "close leaves an unrelated same-named process alone"; else not_ok "close leaves an unrelated same-named process alone" "it was killed"; fi

# close ends each kind of session.
reset
"$RDP" run "$TMP/$CLIENT" -c 'sleep 60; :' fake 2>/dev/null &
marked=$!
fake_client "/title:Windows VM - Omarchy"
titled=$!
bash "$TMP/$LAUNCHER" launch 2>/dev/null & launcher=$!
pids+=("$marked" "$launcher")
fake_client --unrelated
stranger=$!
settle
assert_status "close exits 0" 0 "$RDP" close
settle
gone=1
for p in "$marked" "$titled"; do alive "$p" && gone=0; done
if ((gone)); then ok "close ends the marked and the titled session"; else not_ok "close ends the marked and the titled session" "one survived"; fi
if pgrep -P "$launcher" -x "$CLIENT" >/dev/null; then not_ok "close ends the launcher's session" "client survived"; else ok "close ends the launcher's session"; fi
if alive "$stranger"; then ok "close spares the unrelated process among them"; else not_ok "close spares the unrelated process among them" "it was killed"; fi

reset
assert_status "close exits 0 with nothing to close" 0 "$RDP" close

# run execs the command with the marker, its arguments, and fd 3 intact.
reset
out=$("$RDP" run bash -c 'echo "$WINVM_RDP|$1|$2|$(cat <&3)"' _ "two words" b 3<<<"from fd3")
assert_equal "run passes the marker, arguments and fd 3 to the command" "1|two words|b|from fd3" "$out"
assert_status "run with no command is a usage error" 2 "$RDP" run

# A launcher that waits on its window stops the VM itself; --keep-alive
# (or -k) means it does not.
reset
assert_status "launcher-waiting is false with no launcher" 1 "$RDP" launcher-waiting

cat >"$TMP/$LAUNCHER" <<'SCRIPT'
sleep 60
:
SCRIPT
for args in "launch" "start"; do
  reset
  bash "$TMP/$LAUNCHER" $args 2>/dev/null & pids+=($!)
  settle
  assert_status "launcher-waiting is true for $args" 0 "$RDP" launcher-waiting
done
for args in "launch --keep-alive" "launch -k"; do
  reset
  bash "$TMP/$LAUNCHER" $args 2>/dev/null & pids+=($!)
  settle
  assert_status "launcher-waiting is false for $args" 1 "$RDP" launcher-waiting
done

assert_status "an unknown verb is a usage error" 2 "$RDP" frobnicate
assert_status "no verb is a usage error" 2 "$RDP"

((failed)) && exit 1
exit 0
