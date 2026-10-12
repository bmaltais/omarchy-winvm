.pragma library

// The Windows VM's phase, and the moves between phases.
//
// Panel.qml used to rebuild this from booleans and three timers. Here it is
// one value: { phase, deadline }. Nothing in this file touches Qt, timers or
// the clock; the caller passes `now` in milliseconds and runs the effects.
//
// Phases: absent (not installed, widget hidden), off, starting, running,
// confirming (Stop pressed once), stopping. Whether an RDP session is open is
// not a phase: it comes and goes while the VM runs, and lives in Model.derive.
//
// `deadline` is the `now` at which a timed phase gives up, or 0 for a phase
// that waits for a sample instead.

// Starting and stopping each hand off to a password prompt and then to
// Windows, which gets an ACPI shutdown and up to a couple of minutes to act.
// If the prompt was declined nothing ever changes, so give up after this long.
var TRANSITION_MS = 180000

// Shutting Windows down from a bar popup is too easy to do by accident on the
// way to Connect, so the second press has to follow the first quickly.
var CONFIRM_MS = 4000

function make(phase, deadline) {
  return { phase: phase, deadline: deadline }
}

function initial() {
  return make("absent", 0)
}

// Apply a sample (what Model.derive returns). A running VM counts as
// installed. Confirming and stopping outlive a running sample: the VM is
// still up while we wait for the second press or for Windows to finish.
function observe(state, readings, now) {
  if (readings.running) {
    var p = state.phase
    if (p === "confirming" || p === "stopping") return state
    return make("running", 0)
  }
  if (state.phase === "starting") return state
  return make(readings.installed ? "off" : "absent", 0)
}

function start(state, now) {
  if (state.phase !== "off") return { state: state, effect: null }
  return { state: make("starting", now + TRANSITION_MS), effect: "start" }
}

function stop(state, now) {
  if (state.phase === "running") {
    return { state: make("confirming", now + CONFIRM_MS), effect: null }
  }
  if (state.phase === "confirming") {
    return { state: make("stopping", now + TRANSITION_MS), effect: "stop" }
  }
  return { state: state, effect: null }
}

// A phase that outlives its deadline reverts to the settled phase it came
// from: a declined start left the VM off, a declined stop left it running.
function tick(state, now) {
  if (!state.deadline || now < state.deadline) return state
  return make(state.phase === "starting" ? "off" : "running", 0)
}

// What the phase means for the panel. `status` and `word` are null when the
// panel has to say it itself (running or confirming: connected or not, uptime).
// `tone` is "off", "busy" (amber) or "up"; the panel owns the actual colours.
function view(state) {
  var p = state.phase
  var up = p === "running" || p === "confirming" || p === "stopping"
  return {
    visible: p !== "absent",
    up: up,
    busy: p === "starting" || p === "stopping",
    tone: p === "starting" || p === "stopping" ? "busy" : (up ? "up" : "off"),
    canStart: p === "off",
    canStop: p === "running" || p === "confirming",
    canConnect: p === "running" || p === "confirming",
    startLabel: p === "starting" ? "Starting" : "Start",
    startSpins: p === "starting",
    stopLabel: p === "stopping" ? "Stopping" : (p === "confirming" ? "Confirm" : "Stop"),
    stopSpins: p === "stopping",
    stopWarns: p === "confirming",
    status: p === "starting" ? "Starting…" : (p === "stopping" ? "Shutting down…" : (up ? null : "Off")),
    word: p === "starting" ? "starting" : (p === "stopping" ? "shutting down" : (up ? null : "off"))
  }
}
