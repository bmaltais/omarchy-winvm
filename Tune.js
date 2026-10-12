.pragma library

// The Tune section: what it offers, what it says about the shape picked, and
// (further down) the session the panel drives it through.
//
// `limits` is the line bin/winvm-tune prints: what the host has (hostCores,
// hostRamGb, freeGb) and what the VM has now (cores, ramGb, diskGb; 0 where it
// could not be read). A `shape` is { cores, ramGb, diskGb }. bin/winvm-tune
// checks all of this again before it writes anything; here it only decides
// what to draw.

var MIN_CORES = 2
var RAM_STEPS = [4, 8, 12, 16, 24, 32, 48, 64]
var DISK_STEPS = [32, 64, 96, 128, 192, 256, 512]

// The room the installer wants beside the disk, for the Windows image.
var RESERVE_GB = 10

function withCurrent(steps, current) {
  if (current > 0 && steps.indexOf(current) < 0) steps.push(current)
  return steps.sort(function(a, b) { return a - b })
}

// The sizes this machine has the RAM for. The VM's own size is always there,
// whatever it is, so the current shape can be picked again.
function ramChoices(limits) {
  var steps = RAM_STEPS.filter(function(gb) {
    return !limits.hostRamGb || gb <= limits.hostRamGb
  })
  return withCurrent(steps, limits.ramGb)
}

// The disk only grows, and only into room that exists.
function diskChoices(limits) {
  var steps = DISK_STEPS.filter(function(gb) {
    return gb > limits.diskGb && gb + RESERVE_GB <= limits.freeGb
  })
  return withCurrent(steps, limits.diskGb)
}

// Where the controls start: the shape the VM has, or the smallest Windows 11
// takes where that is unknown.
function seed(limits) {
  return {
    cores: Math.max(MIN_CORES, limits.cores),
    ramGb: limits.ramGb || ramChoices(limits)[0],
    diskGb: limits.diskGb || diskChoices(limits)[0] || 0
  }
}

function canAddCore(limits, shape) {
  return !limits.hostCores || shape.cores < limits.hostCores
}

function canDropCore(shape) {
  return shape.cores > MIN_CORES
}

function shapeText(shape) {
  return shape.cores + " cores · " + shape.ramGb + " GB RAM · " + shape.diskGb + " GB disk"
}

// { ok, warn, text }: whether Apply is offered, and the line under the controls.
function verdict(limits, shape) {
  if (!shape.diskGb) return { ok: false, warn: false, text: "No room for a disk here." }
  if (shape.cores === limits.cores && shape.ramGb === limits.ramGb && shape.diskGb === limits.diskGb) {
    return { ok: false, warn: false, text: "The shape the VM has now." }
  }

  var notes = []
  if (limits.hostCores && shape.cores >= limits.hostCores) notes.push("Windows gets every thread this machine has.")
  if (limits.hostRamGb && shape.ramGb * 2 > limits.hostRamGb) notes.push("That is more than half this machine's RAM.")
  var warn = notes.length > 0
  if (limits.diskGb && shape.diskGb > limits.diskGb) {
    notes.push("Extend C: in Windows' Disk Management afterwards.")
  }
  return { ok: true, warn: warn, text: ["Next start: " + shapeText(shape) + "."].concat(notes).join(" ") }
}

// The Tune section's session, as one value. Like Lifecycle.js, nothing here
// touches Qt or a process: each move returns { state, effect }, and the panel
// runs the effect ("limits": run `winvm-tune limits` and hand the output to
// loaded; "apply": run `winvm-tune apply` with view().args and hand the exit
// code and stderr to applied).
//
// Phases: closed, loading (limits asked for), editing, applying. `hidden` is
// an apply whose section went away under it (the panel closed, or the VM
// started): the write cannot be recalled, so the phase waits for its outcome
// while nothing is drawn. `message` is what the last Apply or a failed
// loading came back with, and `failed` whether that was bad news.
function session(phase, limits, shape, message, failed, hidden) {
  return { phase: phase, limits: limits, shape: shape, message: message, failed: failed, hidden: !!hidden }
}

// Nothing drawn but `message`.
function closed(message, failed) {
  return session("closed", null, null, message, failed)
}

function initial() {
  return closed("", false)
}

// The Tune VM button. `canTune` is Lifecycle's: the VM is off. The limits are
// read again on every opening: the host's free space and the VM's shape may
// both have moved since the last one.
function toggle(state, canTune) {
  if (state.phase === "applying") return { state: state, effect: null }
  if (state.phase !== "closed") {
    return { state: closed(state.message, state.failed), effect: null }
  }
  if (!canTune) return { state: state, effect: null }
  return { state: session("loading", null, null, "", false), effect: "limits" }
}

var LIMIT_KEYS = ["hostCores", "hostRamGb", "freeGb", "cores", "ramGb", "diskGb"]

function isLimits(value) {
  if (!value || typeof value !== "object") return false
  return LIMIT_KEYS.every(function(key) { return typeof value[key] === "number" })
}

// What `winvm-tune limits` printed. Anything but its one JSON object leaves
// nothing to draw controls from, so the section closes and says why.
function loaded(state, text) {
  if (state.phase !== "loading") return state
  var limits = null
  try {
    limits = JSON.parse(String(text || "").trim())
  } catch (e) {
    limits = null
  }
  if (!isLimits(limits)) {
    return closed("The VM's configuration could not be read.", true)
  }
  return session("editing", limits, seed(limits), "", false)
}

// One control: `key` is cores, ramGb or diskGb.
function pick(state, key, value) {
  if (state.phase !== "editing") return state
  var shape = { cores: state.shape.cores, ramGb: state.shape.ramGb, diskGb: state.shape.diskGb }
  shape[key] = value
  return session("editing", state.limits, shape, state.message, state.failed)
}

// bin/winvm-tune asks for authorization, every time: it rewrites the
// root-owned compose through Omarchy's own writer.
function apply(state) {
  if (state.phase !== "editing" || !verdict(state.limits, state.shape).ok) {
    return { state: state, effect: null }
  }
  return { state: session("applying", state.limits, state.shape, "", false), effect: "apply" }
}

// How `winvm-tune apply` ended: its exit code and what it wrote to stderr,
// whose last line is the reason for a refusal. A written shape closes the
// section; anything else goes back to the controls, unless they are hidden.
function applied(state, code, stderr) {
  if (state.phase !== "applying") return state
  if (code === 0) {
    return closed("Saved. " + verdict(state.limits, state.shape).text, false)
  }
  var lines = String(stderr || "").trim().split("\n")
  var said = lines[lines.length - 1]
  // The password prompt was closed: nothing was written.
  var dismissed = /dismissed/i.test(said)
  var message = dismissed ? "" : (said || "The VM's configuration could not be written.")
  if (state.hidden) return closed(message, !dismissed)
  return session("editing", state.limits, state.shape, message, !dismissed)
}

function hide(state, message, failed) {
  if (state.phase === "applying") {
    return session("applying", state.limits, state.shape, message, failed, true)
  }
  return closed(message, failed)
}

// The panel closed: the section goes, and so does what it said.
function close(state) {
  return hide(state, "", false)
}

// Tune is for a VM that is off; a start closes the section. What the last
// Apply said stays, for as long as the panel has somewhere to show it.
function vmLeftOff(state) {
  if (state.phase === "closed" || state.hidden) return state
  return hide(state, state.message, state.failed)
}

// What the panel draws. The limits-dependent fields are empty until the
// section is open; while applying, every control is locked.
function view(state) {
  var busy = state.phase === "applying"
  var open = (busy || state.phase === "editing") && !state.hidden
  var limits = open ? state.limits : null
  var shape = open ? state.shape : { cores: 0, ramGb: 0, diskGb: 0 }
  var v = limits ? verdict(limits, shape) : { ok: false, warn: false, text: "" }
  return {
    selected: state.phase !== "closed" && !state.hidden,
    open: open,
    busy: busy,
    shape: shape,
    args: state.shape
      ? ["apply", String(state.shape.cores), String(state.shape.ramGb), String(state.shape.diskGb)]
      : [],
    hostCores: limits ? limits.hostCores : 0,
    ramChoices: limits ? ramChoices(limits) : [],
    diskChoices: limits ? diskChoices(limits) : [],
    canAddCore: !!limits && !busy && canAddCore(limits, shape),
    canDropCore: !!limits && !busy && canDropCore(shape),
    canApply: v.ok && !busy,
    applyLabel: busy ? "Applying" : "Apply",
    note: v.text,
    warns: v.warn,
    message: state.message,
    failed: state.failed
  }
}
