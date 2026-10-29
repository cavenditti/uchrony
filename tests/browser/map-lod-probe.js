// Run via agent-browser eval --stdin on map-stress.html?landscape after loading.
// Same prepared World and CSS-pixel scale for every repeat; no simulation ticks.
;(async () => {
  const world = window.mapStressWorld
  if (!world?.viewMesh) throw new Error('Wait for the prepared stress fixture')
  const q = await import('/src/map/quadtree.ts')
  const { drawQuadtree } = await import('/src/map/quadtree-renderer.ts')
  const { drawGroundRoads, groundRoads } = await import('/src/map/ground-roads.ts')
  const scale = 1000 / (world.width * 12),
    meters = world.adaptive.metersPerMapUnit
  const bounds = { x: 0, y: 0, width: world.width * 1024, height: world.height * 1024 }
  const canvas = document.createElement('canvas')
  canvas.width = 1000
  canvas.height = 700
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  const land = new Path2D()
  land.rect(0, 0, world.width * 12, world.height * 12)
  const result = {
    cells: world.cells.length,
    leaves: world.viewMesh.addresses.length,
    homes: world.viewHomes.length,
    roads: groundRoads(world).length,
    scale,
  }
  for (const [key, run] of Object.entries({
    display: () => q.visibleRenderCells?.(world, bounds, scale) ?? q.visibleMapLeaves(world, bounds),
    plots: () => q.visibleUrbanPlots(world, bounds, scale),
    roads: () =>
      drawGroundRoads(
        ctx,
        world,
        scale,
        { x: 0, y: 0, width: bounds.width / meters, height: bounds.height / meters },
        land,
      ),
    draw: () => drawQuadtree(ctx, world, 'terrain', scale, bounds, land),
  })) {
    const times = []
    let count
    for (let i = 0; i < 12; i++) {
      const t = performance.now()
      const value = run()
      times.push(performance.now() - t)
      count = value?.length
    }
    times.sort((a, b) => a - b)
    result[key + 'MedianMs'] = times[6]
    if (count !== undefined) result[key + 'Count'] = count
  }
  // Flush the canvas command queue separately from JS traversal/submission.
  const submitted = performance.now()
  ctx.getImageData(0, 0, canvas.width, canvas.height)
  result.flushMs = performance.now() - submitted
  canvas.width = canvas.height = 1
  return result
})()
