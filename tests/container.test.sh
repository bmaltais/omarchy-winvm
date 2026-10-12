#!/bin/bash
# Tests for bin/winvm-container, through its command line only.
#
# `docker` and `omarchy-windows-vm` are fakes at the front of PATH that write
# what they were asked to a log, HOME is a temp directory, and the RDP
# sessions are fake processes as in tests/rdp.test.sh. No real container,
# launcher or session is touched.

set -u

BIN="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)/bin"
CONTAINER="$BIN/winvm-container"
TMP=$(mktemp -d)
LOG=$TMP/log
CLIENT="fakerdp$$"
LAUNCHER="fakelaunch$$"
export WINVM_RDP_CLIENT=$CLIENT WINVM_RDP_LAUNCHER=$LAUNCHER
export HOME=$TMP/home LOG
mkdir -p "$HOME/Windows" "$TMP/path"
cp /bin/bash "$TMP/$CLIENT"

# FAKE_INSPECT and FAKE_START are the exit codes of `docker inspect` (is there
# a container this user can see) and `docker start`.
cat >"$TMP/path/docker" <<'FAKE'
#!/bin/bash
echo "docker $*" >>"$LOG"
case $1 in
  inspect) exit "${FAKE_INSPECT:-0}" ;;
  start) exit "${FAKE_START:-0}" ;;
  rm) exit "${FAKE_RM:-0}" ;;
esac
exit 0
FAKE
cat >"$TMP/path/omarchy-windows-vm" <<'FAKE'
#!/bin/bash
echo "omarchy-windows-vm $*" >>"$LOG"
FAKE
chmod +x "$TMP/path/docker" "$TMP/path/omarchy-windows-vm"
PATH=$TMP/path:$PATH

failed=0
pids=()

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

# assert_log <name> <expected>: what docker and the launcher were asked, in order.
assert_log() {
  local got
  got=$(cat "$LOG" 2>/dev/null)
  if [[ $got == "$2" ]]; then ok "$1"; else not_ok "$1" "got: ${got//$'\n'/ | }"; fi
}

alive() { kill -0 "$1" 2>/dev/null; }
settle() { sleep 0.3; }

# Each test starts from nothing asked and nothing running.
reset() {
  local p
  for p in "${pids[@]}"; do kill_tree "$p"; done
  wait 2>/dev/null
  pids=()
  : >"$LOG"
}

# --- start ---

reset
assert_status "start exits 0 when docker starts the container" 0 "$CONTAINER" start
assert_log "start brings back the container that is there, without the launcher" \
  $'docker inspect omarchy-windows\ndocker start omarchy-windows'

reset
FAKE_INSPECT=1 "$CONTAINER" start
assert_log "start goes to the launcher, kept alive, when there is no container" \
  $'docker inspect omarchy-windows\nomarchy-windows-vm launch --keep-alive'

reset
FAKE_START=1 "$CONTAINER" start
assert_log "start goes to the launcher when docker cannot start the container" \
  $'docker inspect omarchy-windows\ndocker start omarchy-windows\nomarchy-windows-vm launch --keep-alive'

# The container sets the setgid bit on ~/Windows, and the launcher's mount
# check then fails without saying why.
reset
chmod g+s "$HOME/Windows"
"$CONTAINER" start
if [[ -g $HOME/Windows ]]; then not_ok "start clears the setgid bit on the shared folder" "still set"; else ok "start clears the setgid bit on the shared folder"; fi

# --- stop ---

reset
assert_status "stop exits 0 when docker stops the container" 0 "$CONTAINER" stop
assert_log "stop stops the container and leaves it in place" \
  $'docker inspect omarchy-windows\ndocker stop omarchy-windows'

reset
FAKE_INSPECT=1 "$CONTAINER" stop
assert_log "stop goes to the launcher when there is no container to see" \
  $'docker inspect omarchy-windows\nomarchy-windows-vm stop'

# A session opened by Connect does not stop the VM when it closes, so stop
# closes it and stops the container itself.
reset
"$BIN/winvm-rdp" run "$TMP/$CLIENT" -c 'sleep 60; :' fake 2>/dev/null &
session=$!
pids+=("$session")
settle
"$CONTAINER" stop
settle
if alive "$session"; then not_ok "stop closes an open RDP session" "it survived"; else ok "stop closes an open RDP session"; fi
assert_log "stop still stops the container after closing a session" \
  $'docker inspect omarchy-windows\ndocker stop omarchy-windows'

# A launcher without --keep-alive is waiting on its window and stops the VM
# itself when it closes. Stopping the container as well would make it ask for
# a password to stop a VM that is already gone.
cat >"$TMP/$LAUNCHER" <<SCRIPT
"$TMP/$CLIENT" -c 'sleep 60; :' fake
:
SCRIPT
reset
bash "$TMP/$LAUNCHER" launch 2>/dev/null & launcher=$!
pids+=("$launcher")
settle
assert_status "stop exits 0 when it leaves the stop to a waiting launcher" 0 "$CONTAINER" stop
settle
if pgrep -P "$launcher" -x "$CLIENT" >/dev/null; then not_ok "stop closes the waiting launcher's window" "client survived"; else ok "stop closes the waiting launcher's window"; fi
assert_log "stop asks nothing of docker or the launcher while one is waiting" ""

# --- discard ---

reset
assert_status "discard exits 0" 0 "$CONTAINER" discard
assert_log "discard removes the stopped container" "docker rm omarchy-windows"
assert_status "discard exits 0 when there was nothing to remove" 0 env FAKE_RM=1 "$CONTAINER" discard

# --- clear-setgid ---

reset
chmod g+s "$HOME/Windows"
assert_status "clear-setgid exits 0" 0 "$CONTAINER" clear-setgid
if [[ -g $HOME/Windows ]]; then not_ok "clear-setgid clears the bit on the shared folder" "still set"; else ok "clear-setgid clears the bit on the shared folder"; fi
assert_status "clear-setgid exits 0 without a shared folder" 0 env HOME="$TMP/nowhere" "$CONTAINER" clear-setgid
assert_log "clear-setgid asks nothing of docker or the launcher" ""

assert_status "an unknown verb is a usage error" 2 "$CONTAINER" frobnicate
assert_status "no verb is a usage error" 2 "$CONTAINER"

((failed)) && exit 1
exit 0
