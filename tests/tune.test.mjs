import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"

// Tune.js is a QML library; see lifecycle.test.mjs for why the pragma goes.
const source = fs
  .readFileSync(new URL("../Tune.js", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => !/^\s*\.(pragma|import)\b/.test(line))
  .join("\n")
const context = vm.createContext({})
vm.runInContext(source, context)
const T = context

// Arrays made inside the vm context have another realm's prototype.
const plain = (value) => JSON.parse(JSON.stringify(value))

const limits = { hostCores: 12, hostRamGb: 78, freeGb: 150, cores: 4, ramGb: 8, diskGb: 64 }
const now = { cores: 4, ramGb: 8, diskGb: 64 }

test("RAM choices stop at what the host has", () => {
  assert.deepEqual(plain(T.ramChoices(limits)), [4, 8, 12, 16, 24, 32, 48, 64])
  assert.deepEqual(plain(T.ramChoices({ ...limits, hostRamGb: 15 })), [4, 8, 12])
})

test("the VM's own RAM size is offered even when it is not a step", () => {
  assert.deepEqual(plain(T.ramChoices({ ...limits, hostRamGb: 15, ramGb: 6 })), [4, 6, 8, 12])
})

test("disk choices only grow, and only into room that exists", () => {
  // 150 GB free: 96 and 128 fit beside the 10 GB reserve, 192 does not.
  assert.deepEqual(plain(T.diskChoices(limits)), [64, 96, 128])
  assert.deepEqual(plain(T.diskChoices({ ...limits, freeGb: 20 })), [64])
})

test("the controls start at the shape the VM has", () => {
  assert.deepEqual(plain(T.seed(limits)), now)
})

test("an unreadable shape starts at the smallest Windows 11 takes", () => {
  assert.deepEqual(plain(T.seed({ ...limits, cores: 0, ramGb: 0 })), { cores: 2, ramGb: 4, diskGb: 64 })
})

test("cores stay between two and the host's threads", () => {
  assert.equal(T.canDropCore({ ...now, cores: 2 }), false)
  assert.equal(T.canDropCore({ ...now, cores: 3 }), true)
  assert.equal(T.canAddCore(limits, { ...now, cores: 11 }), true)
  assert.equal(T.canAddCore(limits, { ...now, cores: 12 }), false)
})

test("the current shape is nothing to apply", () => {
  assert.equal(T.verdict(limits, now).ok, false)
})

test("a changed shape can be applied and is spelled out", () => {
  const v = T.verdict(limits, { cores: 6, ramGb: 16, diskGb: 64 })
  assert.equal(v.ok, true)
  assert.equal(v.warn, false)
  assert.equal(v.text, "Next start: 6 cores · 16 GB RAM · 64 GB disk.")
})

test("an unreadable shape can always be applied", () => {
  assert.equal(T.verdict({ ...limits, cores: 0, ramGb: 0 }, { cores: 2, ramGb: 4, diskGb: 64 }).ok, true)
})

test("giving Windows every thread or most of the RAM warns", () => {
  assert.equal(T.verdict(limits, { ...now, cores: 12 }).warn, true)
  assert.equal(T.verdict(limits, { ...now, ramGb: 48 }).warn, true)
})

test("a grown disk says what is left to do in Windows, without warning", () => {
  const v = T.verdict(limits, { ...now, diskGb: 96 })
  assert.equal(v.warn, false)
  assert.match(v.text, /Extend C:/)
})

test("no disk size at all cannot be applied", () => {
  assert.equal(T.verdict(limits, { ...now, diskGb: 0 }).ok, false)
})

// The session: what the Tune section is doing, as the panel drives it.

const limitsLine = JSON.stringify(limits)

function editing() {
  return T.loaded(T.toggle(T.initial(), true).state, limitsLine)
}

test("a fresh session is closed and says nothing", () => {
  const v = T.view(T.initial())
  assert.equal(v.selected, false)
  assert.equal(v.open, false)
  assert.equal(v.message, "")
})

test("opening asks for the limits and draws nothing until they arrive", () => {
  const r = T.toggle(T.initial(), true)
  assert.equal(r.effect, "limits")
  assert.equal(T.view(r.state).selected, true)
  assert.equal(T.view(r.state).open, false)
})

test("it does not open unless the VM can be tuned", () => {
  const r = T.toggle(T.initial(), false)
  assert.equal(r.effect, null)
  assert.equal(T.view(r.state).selected, false)
})

test("the limits open the controls on the shape the VM has", () => {
  const v = T.view(editing())
  assert.equal(v.open, true)
  assert.deepEqual(plain(v.shape), now)
  assert.equal(v.hostCores, 12)
  assert.deepEqual(plain(v.ramChoices), [4, 8, 12, 16, 24, 32, 48, 64])
  assert.deepEqual(plain(v.diskChoices), [64, 96, 128])
  assert.equal(v.canApply, false)
  assert.equal(v.note, "The shape the VM has now.")
})

test("limits that cannot be read close the section and say so", () => {
  for (const line of ["", "not json", "null", "[]"]) {
    const v = T.view(T.loaded(T.toggle(T.initial(), true).state, line))
    assert.equal(v.selected, false, line)
    assert.equal(v.open, false, line)
    assert.equal(v.message, "The VM's configuration could not be read.", line)
    assert.equal(v.failed, true, line)
  }
})

test("limits that arrive after the section closed are dropped", () => {
  const s = T.loaded(T.initial(), limitsLine)
  assert.equal(T.view(s).open, false)
  assert.equal(T.view(s).selected, false)
})

test("the button closes an open section, and opens it afresh", () => {
  const closed = T.toggle(editing(), true)
  assert.equal(closed.effect, null)
  assert.equal(T.view(closed.state).selected, false)
  assert.equal(T.toggle(closed.state, true).effect, "limits")
})

test("picking a size changes the shape and what Apply would do", () => {
  let s = T.pick(editing(), "cores", 6)
  s = T.pick(s, "ramGb", 16)
  const v = T.view(s)
  assert.deepEqual(plain(v.shape), { cores: 6, ramGb: 16, diskGb: 64 })
  assert.equal(v.canApply, true)
  assert.equal(v.warns, false)
  assert.equal(v.note, "Next start: 6 cores · 16 GB RAM · 64 GB disk.")
})

test("the note warns when Windows would get every thread", () => {
  assert.equal(T.view(T.pick(editing(), "cores", 12)).warns, true)
})

test("the core buttons stop at two and at the host's threads", () => {
  assert.equal(T.view(T.pick(editing(), "cores", 2)).canDropCore, false)
  assert.equal(T.view(T.pick(editing(), "cores", 3)).canDropCore, true)
  assert.equal(T.view(T.pick(editing(), "cores", 11)).canAddCore, true)
  assert.equal(T.view(T.pick(editing(), "cores", 12)).canAddCore, false)
})

test("nothing can be picked before the limits arrive", () => {
  const loading = T.toggle(T.initial(), true).state
  assert.equal(T.view(T.pick(loading, "cores", 6)).open, false)
})

test("Apply on the shape the VM already has does nothing", () => {
  const r = T.apply(editing())
  assert.equal(r.effect, null)
  assert.equal(T.view(r.state).busy, false)
})

test("Apply on a new shape hands the panel the numbers and locks the controls", () => {
  const r = T.apply(T.pick(T.pick(editing(), "cores", 6), "diskGb", 96))
  const v = T.view(r.state)
  assert.equal(r.effect, "apply")
  assert.deepEqual(plain(v.args), ["apply", "6", "8", "96"])
  assert.equal(v.open, true)
  assert.equal(v.busy, true)
  assert.equal(v.canApply, false)
  assert.equal(v.canAddCore, false)
  assert.equal(v.canDropCore, false)
  assert.equal(v.applyLabel, "Applying")
})

test("while applying, the shape and the button are fixed", () => {
  const applying = T.apply(T.pick(editing(), "cores", 6)).state
  assert.equal(T.view(T.pick(applying, "cores", 8)).shape.cores, 6)
  assert.equal(T.apply(applying).effect, null)
  const r = T.toggle(applying, true)
  assert.equal(r.effect, null)
  assert.equal(T.view(r.state).busy, true)
})

function applying() {
  return T.apply(T.pick(T.pick(editing(), "cores", 6), "diskGb", 96)).state
}

test("a shape that was written closes the section and says what comes next", () => {
  const v = T.view(T.applied(applying(), 0, ""))
  assert.equal(v.selected, false)
  assert.equal(v.open, false)
  assert.equal(v.failed, false)
  assert.equal(
    v.message,
    "Saved. Next start: 6 cores · 8 GB RAM · 96 GB disk. Extend C: in Windows' Disk Management afterwards."
  )
})

test("a dismissed password prompt goes back to the controls, with nothing said", () => {
  const v = T.view(T.applied(applying(), 126, "Error executing command as another user: Request dismissed\n"))
  assert.equal(v.open, true)
  assert.equal(v.busy, false)
  assert.equal(v.shape.cores, 6)
  assert.equal(v.message, "")
  assert.equal(v.failed, false)
})

test("a refused shape goes back to the controls with the script's last line", () => {
  const v = T.view(T.applied(applying(), 2, "some noise\nthe disk cannot shrink: it is already 128 GB\n"))
  assert.equal(v.open, true)
  assert.equal(v.busy, false)
  assert.equal(v.message, "the disk cannot shrink: it is already 128 GB")
  assert.equal(v.failed, true)
})

test("a failure that says nothing still says something", () => {
  const v = T.view(T.applied(applying(), 1, ""))
  assert.equal(v.message, "The VM's configuration could not be written.")
  assert.equal(v.failed, true)
})

test("an exit nobody was waiting for changes nothing", () => {
  assert.equal(T.view(T.applied(editing(), 0, "")).open, true)
  assert.equal(T.view(T.applied(editing(), 0, "")).message, "")
})

test("closing the panel closes the section and clears what it said", () => {
  const failedOnce = T.applied(applying(), 2, "one core is refused")
  const v = T.view(T.close(failedOnce))
  assert.equal(v.selected, false)
  assert.equal(v.open, false)
  assert.equal(v.message, "")
})

test("the VM leaving off closes the section but keeps what it said", () => {
  const saved = T.applied(applying(), 0, "")
  assert.equal(T.view(T.vmLeftOff(saved)).message, T.view(saved).message)
  const v = T.view(T.vmLeftOff(editing()))
  assert.equal(v.selected, false)
  assert.equal(v.open, false)
})

// The password prompt can take the panel away while the write is under way.
for (const [name, leave] of [["the panel closing", (s) => T.close(s)], ["the VM leaving off", (s) => T.vmLeftOff(s)]]) {
  test(`${name} mid-apply hides the section, and the outcome is still reported`, () => {
    const hidden = leave(applying())
    assert.equal(T.view(hidden).open, false)
    assert.equal(T.view(hidden).selected, false)
    assert.equal(T.view(hidden).busy, true)
    assert.deepEqual(plain(T.view(hidden).args), ["apply", "6", "8", "96"])
    assert.equal(T.toggle(hidden, true).effect, null)

    assert.match(T.view(T.applied(hidden, 0, "")).message, /^Saved\. Next start: 6 cores/)

    const refused = T.view(T.applied(hidden, 2, "not enough room"))
    assert.equal(refused.open, false)
    assert.equal(refused.message, "not enough room")
    assert.equal(refused.failed, true)

    const dismissed = T.view(T.applied(hidden, 126, "Request dismissed"))
    assert.equal(dismissed.open, false)
    assert.equal(dismissed.message, "")
  })
}
