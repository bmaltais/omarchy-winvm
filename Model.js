.pragma library

// Turning two raw samples from bin/winvm-sample into rates and fractions.
//
// Every counter the sampler emits is cumulative, so each figure here is a
// delta over the wall-clock time between samples. The first sample after the
// VM appears has nothing to diff against and reads as zero for one tick.

function clamp01(v) {
  if (!isFinite(v)) return 0
  return v < 0 ? 0 : (v > 1 ? 1 : v)
}

function rate(cur, prev, key, dt) {
  if (!prev || dt <= 0) return 0
  var d = (Number(cur[key]) || 0) - (Number(prev[key]) || 0)
  // A container restart resets the cgroup counters; a negative delta is that,
  // not traffic.
  return d > 0 ? d / dt : 0
}

// Disk I/O has no natural ceiling to measure against, so the meter is scaled
// to a rate at which a guest on this NVMe is clearly busy rather than to the
// drive's peak. 200 MB/s of sustained guest I/O is Windows Update territory.
var IO_BUSY = 200 * 1024 * 1024

function derive(sample, prev) {
  var out = {
    running: !!(sample && sample.running),
    installed: !!(sample && sample.installed) || !!(sample && sample.running),
    cpuCores: 0,     // host cores' worth of CPU the guest is burning
    cpu: 0,          // share of the guest's own vCPUs
    cpuHost: 0,      // share of the whole host
    mem: 0,
    memBytes: 0,
    ramBytes: 0,
    memHost: 0,
    ioRead: 0,
    ioWrite: 0,
    io: 0,
    netRx: 0,
    netTx: 0,
    vcpus: 0,
    hostCores: 1,
    uptime: 0,
    diskSize: 0,
    diskUsed: 0,
    rdp: false,
    container: ""
  }
  if (!out.running) return out

  // Diffing across a restart would compare two different containers.
  if (prev && (!prev.running || prev.container !== sample.container)) prev = null
  var dt = prev ? sample.__t - prev.__t : 0

  out.vcpus = Number(sample.vcpus) || 0
  out.hostCores = Number(sample.hostCores) || 1
  out.cpuCores = rate(sample, prev, "cpuUsec", dt) / 1e6
  out.cpu = clamp01(out.vcpus > 0 ? out.cpuCores / out.vcpus : 0)
  out.cpuHost = clamp01(out.cpuCores / out.hostCores)

  // memory.current is the whole container: guest RAM qemu has touched, plus
  // qemu itself and page cache. It can pass the allocation slightly; the
  // meter clamps, the number doesn't.
  out.memBytes = Number(sample.memBytes) || 0
  out.ramBytes = Number(sample.ramBytes) || 0
  out.mem = clamp01(out.ramBytes > 0 ? out.memBytes / out.ramBytes : 0)
  out.memHost = clamp01((Number(sample.hostMem) || 0) > 0 ? out.memBytes / sample.hostMem : 0)

  out.ioRead = rate(sample, prev, "ioRead", dt)
  out.ioWrite = rate(sample, prev, "ioWrite", dt)
  out.io = clamp01((out.ioRead + out.ioWrite) / IO_BUSY)

  out.netRx = rate(sample, prev, "netRx", dt)
  out.netTx = rate(sample, prev, "netTx", dt)

  out.uptime = Number(sample.uptime) || 0
  out.diskSize = Number(sample.diskSize) || 0
  out.diskUsed = Number(sample.diskUsed) || 0
  out.rdp = sample.rdp === true
  out.container = String(sample.container || "")
  return out
}

function bytes(n) {
  n = Number(n) || 0
  if (n < 1024) return Math.round(n) + " B"
  var units = ["kB", "MB", "GB", "TB"]
  var i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < units.length - 1)
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + " " + units[i]
}

function rateText(n) {
  return bytes(n) + "/s"
}

function percent(v) {
  return Math.round(clamp01(v) * 100) + "%"
}

function uptimeText(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds) || 0))
  var d = Math.floor(seconds / 86400)
  var h = Math.floor((seconds % 86400) / 3600)
  var m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return d + "d " + h + "h"
  if (h > 0) return h + "h " + m + "m"
  if (m > 0) return m + "m"
  return seconds + "s"
}
