// Observation only: no simulation, rendering, input or save behavior is replaced.
// Keep primitives and bounded counters; never retain a received world snapshot.
const runId = crypto.randomUUID()
const loadedAt = Date.now()
const errors = []
const counters = {
  snapshots: 0,
  saves: 0,
  saveErrors: 0,
  workerErrors: 0,
  contextLost: 0,
  contextRestored: 0,
  pointerDown: 0,
  pointerUp: 0,
  pointerMoves: 0,
  wheels: 0,
  frames: 0,
  over100ms: 0,
  over1000ms: 0,
  inspections: 0,
}
const world = { month: null, cells: 0, states: 0, regions: 0, routes: 0, cohorts: 0 }
const gpu = {}
const histogram = new Uint32Array(5001)
let startedAt = performance.now(),
  lastFrame = 0,
  maxFrameMs = 0,
  lastWorldAt = 0
let savedMonth = null,
  lastSaveAt = 0
const recordError = (kind, message) => {
  if (errors.length < 100)
    errors.push({ kind, message: String(message), elapsedMs: performance.now() - startedAt })
}
addEventListener('error', (e) => recordError('window', e.message))
addEventListener('unhandledrejection', (e) => recordError('promise', e.reason))
for (const name of ['webglcontextlost', 'webglcontextrestored']) {
  document.addEventListener(
    name,
    () => {
      counters[name === 'webglcontextlost' ? 'contextLost' : 'contextRestored']++
    },
    true,
  )
}
for (const [event, counter] of [
  ['pointerdown', 'pointerDown'],
  ['pointerup', 'pointerUp'],
  ['pointermove', 'pointerMoves'],
  ['wheel', 'wheels'],
]) {
  document.addEventListener(
    event,
    (e) => {
      if (e.target instanceof Element && e.target.matches('.world-canvas')) counters[counter]++
    },
    { capture: true, passive: true },
  )
}
const NativeWorker = window.Worker
window.Worker = class extends NativeWorker {
  savesPending = new Map()
  postMessage(data, ...rest) {
    if (data?.type === 'save' && data.world) this.savesPending.set(data.id, data.world.month)
    return super.postMessage(data, ...rest)
  }
  constructor(...args) {
    super(...args)
    this.addEventListener('error', (e) => {
      counters.workerErrors++
      recordError('worker', e.message)
    })
    this.addEventListener('message', ({ data }) => {
      if (data.type === 'world' && data.world) {
        counters.snapshots++
        world.month = data.world.month
        world.cells = data.world.cells?.length ?? world.cells
        world.states = data.world.nations?.length ?? world.states
        world.regions = data.world.regions?.length ?? world.regions
        world.routes = data.world.routes?.length ?? world.routes
        lastWorldAt = performance.now()
      } else if (data.type === 'error') recordError('simulation', data.message)
      if (data.type === 'inspection') counters.inspections++
      if (data.type === 'storage' && data.state === 'saved') {
        counters.saves++
        savedMonth = data.month
        lastSaveAt = performance.now()
        world.saveBytes = data.bytes
        world.replicas = data.replicas
        if (data.replicas?.length !== 2) {
          counters.saveErrors++
          recordError('storage', data.message ?? 'Degraded save replication')
        }
      }
      if (data.type === 'storage' && data.state === 'error') {
        counters.saveErrors++
        recordError('storage', data.message)
      }
      if (this.savesPending.has(data.id) && typeof data.result === 'string') {
        counters.saves++
        savedMonth = this.savesPending.get(data.id)
        lastSaveAt = performance.now()
      }
      this.savesPending.delete(data.id)
      if (data.error || data.result?.error) {
        counters.saveErrors++
        recordError('storage', data.error ?? data.result.error)
      }
    })
  }
}
for (const [create, remove, key] of [
  ['createTexture', 'deleteTexture', 'textures'],
  ['createBuffer', 'deleteBuffer', 'buffers'],
  ['createProgram', 'deleteProgram', 'programs'],
  ['createFramebuffer', 'deleteFramebuffer', 'framebuffers'],
]) {
  const proto = WebGL2RenderingContext.prototype
  const originalCreate = proto[create],
    originalDelete = proto[remove]
  const live = new WeakSet()
  gpu[key] = { created: 0, deleted: 0, live: 0, peak: 0 }
  proto[create] = function (...args) {
    const value = originalCreate.apply(this, args)
    if (value) {
      live.add(value)
      const count = gpu[key]
      count.created++
      count.live++
      count.peak = Math.max(count.peak, count.live)
    }
    return value
  }
  proto[remove] = function (value) {
    if (value && live.has(value)) {
      live.delete(value)
      gpu[key].deleted++
      gpu[key].live--
    }
    return originalDelete.call(this, value)
  }
}
function frame(now) {
  if (lastFrame) {
    const dt = now - lastFrame
    histogram[Math.min(5000, Math.round(dt))]++
    counters.frames++
    counters.over100ms += Number(dt > 100)
    counters.over1000ms += Number(dt > 1000)
    maxFrameMs = Math.max(maxFrameMs, dt)
  }
  lastFrame = now
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
function percentile(p) {
  const target = Math.ceil(counters.frames * p)
  let n = 0
  for (let i = 0; i < histogram.length; i++) {
    n += histogram[i]
    if (n >= target) return i
  }
  return null
}
window.__uchronySoak = {
  begin() {
    startedAt = performance.now()
    lastFrame = 0
    maxFrameMs = 0
    histogram.fill(0)
    for (const key of Object.keys(counters)) counters[key] = 0
    errors.length = 0
    return this.snapshot()
  },
  snapshot() {
    const now = performance.now()
    return {
      runId,
      loadedAt,
      elapsedMs: now - startedAt,
      timestamp: new Date().toISOString(),
      world: { ...world },
      counters: { ...counters },
      errors: [...errors],
      gpu: structuredClone(gpu),
      frameMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: maxFrameMs },
      heapMiB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
      lastWorldAgoMs: now - lastWorldAt,
      lastSaveAgoMs: now - lastSaveAt,
      savedMonth,
      mode: document.querySelector('.map-canvas-wrap')?.dataset.presentation,
      layer: document.querySelector('.map-canvas-wrap')?.dataset.layer,
      date: document.querySelector('.clock-date strong')?.textContent,
      running: !!document.querySelector('[aria-label="Pause simulation"]'),
      speed: document.querySelector('[aria-label="Simulation speed"] [aria-pressed="true"]')?.textContent,
      scale: document.querySelector('.map-scale small')?.textContent,
      visible: document.visibilityState,
      canvases: [...document.querySelectorAll('canvas')].map((c) => ({
        className: c.className,
        w: c.width,
        h: c.height,
      })),
    }
  },
}

// Optional, visible fixture diagnostics for browser providers that expose DOM
// observations but deliberately disallow inspection of application globals.
if (new URLSearchParams(location.search).has('metrics')) {
  const panel = document.createElement('div')
  panel.style =
    'position:fixed;left:270px;top:58px;z-index:10000;max-width:680px;background:#19252b;color:#e6e7dd;padding:4px;font:10px system-ui'
  const reset = document.createElement('button')
  reset.textContent = 'Reset endurance counters'
  reset.onclick = () => window.__uchronySoak.begin()
  const status = document.createElement('output')
  status.setAttribute('aria-label', 'Endurance test status')
  status.style = 'display:block;overflow-wrap:anywhere'
  panel.append(reset, status)
  document.body.append(panel)
  setInterval(() => {
    const s = window.__uchronySoak.snapshot()
    status.textContent = JSON.stringify({
      runId: s.runId,
      seconds: Math.round(s.elapsedMs / 1000),
      month: s.world.month,
      cells: s.world.cells,
      running: s.running,
      mode: s.mode,
      savedMonth: s.savedMonth,
      saveMiB: Math.round((s.world.saveBytes ?? 0) / 1048576),
      replicas: s.world.replicas,
      drags: Math.min(s.counters.pointerDown, s.counters.pointerUp),
      wheels: s.counters.wheels,
      saves: s.counters.saves,
      lastWorldAgo: Math.round(s.lastWorldAgoMs / 1000),
      lastSaveAgo: Math.round(s.lastSaveAgoMs / 1000),
      errors: s.errors,
      contextLost: s.counters.contextLost,
      frameMs: s.frameMs,
      heapMiB: Math.round(s.heapMiB ?? 0),
    })
  }, 2000)
}
