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
