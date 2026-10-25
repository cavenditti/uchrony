// Load with agent-browser eval --stdin after the map is ready. Hold the mouse
// down on .world-canvas, call await __uchronyDragProbe.run(), then release it.
// This measures browser allocations/uploads, without depending on React internals.
;(() => {
  const metrics = {
    canvasResizes: 0,
    redundantResizes: 0,
    textureUploads: 0,
    textureBytes: 0,
    frames: [],
    errors: [],
  }
  const restores = []
  for (const name of ['width', 'height']) {
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name)
    Object.defineProperty(HTMLCanvasElement.prototype, name, {
      ...original,
      set(value) {
        metrics.canvasResizes++
        if (original.get.call(this) === value) metrics.redundantResizes++
        original.set.call(this, value)
      },
    })
    restores.push(() => Object.defineProperty(HTMLCanvasElement.prototype, name, original))
  }
  for (const name of ['texImage2D', 'texSubImage2D']) {
    const original = WebGL2RenderingContext.prototype[name]
    WebGL2RenderingContext.prototype[name] = function (...args) {
      const source = args.find((value) => value instanceof HTMLCanvasElement)
      if (source) {
        metrics.textureUploads++
        metrics.textureBytes += source.width * source.height * 4
      }
      return original.apply(this, args)
    }
    restores.push(() => {
      WebGL2RenderingContext.prototype[name] = original
    })
  }
  const onError = (event) => metrics.errors.push(event.message)
  addEventListener('error', onError)
  window.__uchronyDragProbe = {
    async run(count = 180, maxDurationMs = 15000) {
      metrics.frames.length = 0
      metrics.canvasResizes = metrics.redundantResizes = metrics.textureUploads = metrics.textureBytes = 0
      const canvas = document.querySelector('.world-canvas'),
        bounds = canvas.getBoundingClientRect()
      const heapBefore = performance.memory?.usedJSHeapSize
      const started = performance.now()
      let last = started
      for (let i = 0; i < count; i++) {
        await new Promise(requestAnimationFrame)
        const now = performance.now()
        if (now - started > maxDurationMs) break
        metrics.frames.push(now - last)
        last = now
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            pointerId: 1,
            buttons: 1,
            clientX: bounds.left + bounds.width / 2 + Math.sin(i * 0.07) * 180,
            clientY: bounds.top + bounds.height / 2 + Math.cos(i * 0.07) * 90,
          }),
        )
      }
      await new Promise(requestAnimationFrame)
      const frames = metrics.frames.slice(5).sort((a, b) => a - b)
      return {
        frames: metrics.frames.length,
        elapsedMs: performance.now() - started,
        requestedFrames: count,
        medianFrameMs: frames[Math.floor(frames.length / 2)],
        p95FrameMs: frames[Math.floor(frames.length * 0.95)],
        canvasResizes: metrics.canvasResizes,
        redundantResizes: metrics.redundantResizes,
        textureUploads: metrics.textureUploads,
        textureMiB: metrics.textureBytes / 1048576,
        heapBeforeMiB: heapBefore / 1048576,
        heapAfterMiB: performance.memory?.usedJSHeapSize / 1048576,
        errors: metrics.errors,
        mode: document.querySelector('.map-canvas-wrap').dataset.presentation,
      }
    },
    dispose() {
      restores.forEach((restore) => restore())
      removeEventListener('error', onError)
      delete window.__uchronyDragProbe
    },
  }
  return 'Map drag probe ready'
})()
