.pragma library

// What the Tune section offers, and what it says about the shape picked.
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
