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
// Starting outlives a not-running one, for as long as the VM is installed.
function observe(state, readings) {
  var p = state.phase
  if (readings.running) {
    return p === "confirming" || p === "stopping" ? state : make("running", 0)
  }
  if (!readings.installed) return make("absent", 0)
  return p === "starting" ? state : make("off", 0)
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

// What each phase means for the panel. `status` and `tooltipWord` are null
// where the panel has to say it itself (running or confirming: connected or
// not, uptime). `tone` is "off", "busy" (amber) or "up"; the panel owns the
// actual colours. A field left out is false, and the labels default to the
// idle ones.
var VIEWS = {
  absent: { tone: "off", status: "Off", tooltipWord: "off" },
  off: { visible: true, tone: "off", canStart: true, status: "Off", tooltipWord: "off" },
  starting: { visible: true, tone: "busy", startLabel: "Starting", status: "Starting…", tooltipWord: "starting" },
  running: { visible: true, up: true, tone: "up", canStop: true, canConnect: true },
  confirming: { visible: true, up: true, tone: "up", canStop: true, canConnect: true, stopLabel: "Confirm", stopWarns: true },
  stopping: { visible: true, up: true, tone: "busy", stopLabel: "Stopping", status: "Shutting down…", tooltipWord: "shutting down" }
}

function view(state) {
  var v = VIEWS[state.phase]
  return {
    visible: !!v.visible,
    up: !!v.up,
    busy: v.tone === "busy",
    tone: v.tone,
    canStart: !!v.canStart,
    canStop: !!v.canStop,
    canConnect: !!v.canConnect,
    startLabel: v.startLabel || "Start",
    startSpins: state.phase === "starting",
    stopLabel: v.stopLabel || "Stop",
    stopSpins: state.phase === "stopping",
    stopWarns: !!v.stopWarns,
    status: v.status || null,
    tooltipWord: v.tooltipWord || null
  }
}
