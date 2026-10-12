import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"

// Lifecycle.js is a QML library: `.pragma library` is not JavaScript, so drop
// the QML-only lines and evaluate the rest in a bare context.
const source = fs
  .readFileSync(new URL("../Lifecycle.js", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => !/^\s*\.(pragma|import)\b/.test(line))
  .join("\n")
const context = vm.createContext({})
vm.runInContext(source, context)
const L = context

const absentReading = { installed: false, running: false }
const offReading = { installed: true, running: false }
const upReading = { installed: true, running: true }

function inPhase(phase, now = 0) {
  let s = L.initial()
  s = L.observe(s, offReading)
  if (phase === "off") return s
  if (phase === "starting") return L.start(s, now).state
  s = L.observe(s, upReading)
  if (phase === "running") return s
  s = L.stop(s, now).state
  if (phase === "confirming") return s
  return L.stop(s, now).state
}

test("a fresh lifecycle is absent", () => {
  assert.equal(L.initial().phase, "absent")
})

test("a sample of a VM that is not installed is absent", () => {
  assert.equal(L.observe(L.initial(), absentReading).phase, "absent")
})

test("an installed VM that is not running is off", () => {
  assert.equal(L.observe(L.initial(), offReading).phase, "off")
})

test("a running VM is running, even if the sample says not installed", () => {
  assert.equal(L.observe(L.initial(), upReading).phase, "running")
  assert.equal(L.observe(L.initial(), { installed: false, running: true }).phase, "running")
})

test("Start from off begins starting and asks the panel to launch", () => {
  const r = L.start(inPhase("off", 1000), 1000)
  assert.equal(r.state.phase, "starting")
  assert.equal(r.effect, "start")
})

for (const phase of ["absent", "starting", "running", "confirming", "stopping"]) {
  test(`Start does nothing while ${phase}`, () => {
    const s = phase === "absent" ? L.initial() : inPhase(phase, 0)
    const r = L.start(s, 500)
    assert.equal(r.state.phase, phase)
    assert.equal(r.effect, null)
  })
}

test("starting is still starting one millisecond before its 180 s deadline", () => {
  const s = L.start(inPhase("off", 1000), 1000).state
  assert.equal(L.tick(s, 180999).phase, "starting")
})

test("starting falls back to off at 180 s (password prompt declined)", () => {
  const s = L.start(inPhase("off", 1000), 1000).state
  assert.equal(L.tick(s, 181000).phase, "off")
})

test("starting becomes running when a sample says running", () => {
  const s = inPhase("starting", 0)
  assert.equal(L.observe(s, upReading).phase, "running")
})

test("starting stays starting while samples say not running", () => {
  const s = inPhase("starting", 0)
  assert.equal(L.observe(s, offReading).phase, "starting")
})

test("starting ends as absent when the VM is no longer installed", () => {
  const s = inPhase("starting", 0)
  assert.equal(L.observe(s, absentReading).phase, "absent")
})

test("the first Stop press asks for confirmation and launches nothing", () => {
  const r = L.stop(inPhase("running", 0), 2000)
  assert.equal(r.state.phase, "confirming")
  assert.equal(r.effect, null)
})

test("a second Stop press within four seconds shuts the VM down", () => {
  const s = L.stop(inPhase("running", 0), 2000).state
  const r = L.stop(s, 5999)
  assert.equal(r.state.phase, "stopping")
  assert.equal(r.effect, "stop")
})

test("confirming is still confirming one millisecond before four seconds", () => {
  const s = L.stop(inPhase("running", 0), 2000).state
  assert.equal(L.tick(s, 5999).phase, "confirming")
})

test("confirming falls back to running after four seconds", () => {
  const s = L.stop(inPhase("running", 0), 2000).state
  assert.equal(L.tick(s, 6000).phase, "running")
})

test("a Stop press while stopping does nothing", () => {
  const r = L.stop(inPhase("stopping", 0), 10)
  assert.equal(r.state.phase, "stopping")
  assert.equal(r.effect, null)
})

test("stopping is still stopping one millisecond before 180 s", () => {
  const s = L.stop(L.stop(inPhase("running", 0), 0).state, 1000).state
  assert.equal(L.tick(s, 180999).phase, "stopping")
})

test("stopping falls back to running at 180 s (password prompt declined)", () => {
  const s = L.stop(L.stop(inPhase("running", 0), 0).state, 1000).state
  assert.equal(L.tick(s, 181000).phase, "running")
})

for (const phase of ["off", "absent"]) {
  test(`Stop does nothing while ${phase}`, () => {
    const s = phase === "absent" ? L.initial() : inPhase(phase, 0)
    const r = L.stop(s, 100)
    assert.equal(r.state.phase, phase)
    assert.equal(r.effect, null)
  })
}

test("Stop does nothing while starting", () => {
  const r = L.stop(inPhase("starting", 0), 100)
  assert.equal(r.state.phase, "starting")
  assert.equal(r.effect, null)
})

for (const phase of ["running", "confirming", "stopping"]) {
  test(`a not-running sample ends ${phase} as off`, () => {
    assert.equal(L.observe(inPhase(phase, 0), offReading).phase, "off")
  })
  test(`a not-installed, not-running sample ends ${phase} as absent`, () => {
    assert.equal(L.observe(inPhase(phase, 0), absentReading).phase, "absent")
  })
}

for (const phase of ["confirming", "stopping"]) {
  test(`a running sample keeps ${phase}`, () => {
    assert.equal(L.observe(inPhase(phase, 0), upReading).phase, phase)
  })
}

test("a running sample does not extend the confirming deadline", () => {
  const s = L.stop(inPhase("running", 0), 1000).state
  const s2 = L.observe(s, upReading)
  assert.equal(L.tick(s2, 5000).phase, "running")
})

test("off and absent accept a tick without changing", () => {
  assert.equal(L.tick(inPhase("off", 0), 1e9).phase, "off")
  assert.equal(L.tick(L.initial(), 1e9).phase, "absent")
})

test("a settled phase has no deadline", () => {
  assert.equal(inPhase("off", 0).deadline, 0)
  assert.equal(inPhase("running", 0).deadline, 0)
})

test("starting and stopping states carry their absolute deadline", () => {
  assert.equal(L.start(inPhase("off", 1000), 1000).state.deadline, 181000)
  assert.equal(L.stop(inPhase("running", 0), 2000).state.deadline, 6000)
})

// What each phase allows. Rows: phase, then the expected view.
const views = {
  absent: { visible: false, up: false, busy: false, canStart: false, canTune: false, canStop: false, canConnect: false },
  off: { visible: true, up: false, busy: false, canStart: true, canTune: true, canStop: false, canConnect: false },
  starting: { visible: true, up: false, busy: true, canStart: false, canTune: false, canStop: false, canConnect: false },
  running: { visible: true, up: true, busy: false, canStart: false, canTune: false, canStop: true, canConnect: true },
  confirming: { visible: true, up: true, busy: false, canStart: false, canTune: false, canStop: true, canConnect: true },
  stopping: { visible: true, up: true, busy: true, canStart: false, canTune: false, canStop: false, canConnect: false }
}
for (const [phase, want] of Object.entries(views)) {
  test(`what ${phase} allows`, () => {
    const s = phase === "absent" ? L.initial() : inPhase(phase, 0)
    const v = L.view(s)
    for (const [k, val] of Object.entries(want)) assert.equal(v[k], val, `${phase}.${k}`)
  })
}

const words = {
  absent: { tone: "off", status: "Off", tooltipWord: "off", startLabel: "Start", stopLabel: "Stop", stopWarns: false },
  off: { tone: "off", status: "Off", tooltipWord: "off", startLabel: "Start", stopLabel: "Stop", stopWarns: false },
  starting: { tone: "busy", status: "Starting…", tooltipWord: "starting", startLabel: "Starting", stopLabel: "Stop", stopWarns: false },
  running: { tone: "up", status: null, tooltipWord: null, startLabel: "Start", stopLabel: "Stop", stopWarns: false },
  confirming: { tone: "up", status: null, tooltipWord: null, startLabel: "Start", stopLabel: "Confirm", stopWarns: true },
  stopping: { tone: "busy", status: "Shutting down…", tooltipWord: "shutting down", startLabel: "Start", stopLabel: "Stopping", stopWarns: false }
}
for (const [phase, want] of Object.entries(words)) {
  test(`how ${phase} reads`, () => {
    const s = phase === "absent" ? L.initial() : inPhase(phase, 0)
    const v = L.view(s)
    for (const [k, val] of Object.entries(want)) assert.equal(v[k], val, `${phase}.${k}`)
  })
}

test("only starting and stopping spin their buttons", () => {
  assert.equal(L.view(inPhase("starting", 0)).startSpins, true)
  assert.equal(L.view(inPhase("stopping", 0)).stopSpins, true)
  assert.equal(L.view(inPhase("off", 0)).startSpins, false)
  assert.equal(L.view(inPhase("confirming", 0)).stopSpins, false)
})
