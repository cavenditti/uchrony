import type { World } from '../sim/types'
import type { Fleet } from '../sim/military-types'
import { stepDistance } from '../sim/grid'
export function fleetMapPosition(w: World, f: Fleet) {
  const origin = w.cells[f.cell],
    next = w.cells[f.course[0]],
    t = next ? (f.sailingProgress ?? 0) / stepDistance(origin, next) : 0
  return next ? { x: origin.x + (next.x - origin.x) * t, y: origin.y + (next.y - origin.y) * t } : origin
}
export function drawWarfare(ctx: CanvasRenderingContext2D, w: World, selected: number, markers = true) {
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#9ac6bc'
  ctx.lineWidth = 1.3
  ctx.setLineDash([3, 3])
  for (const d of w.warfare?.deliveries ?? []) {
    if (!w.armies.some((a) => a.id === d.army && a.nation === selected)) continue
    for (const leg of d.legs) {
      ctx.beginPath()
      leg.cells.forEach((id, i) => {
        const p = w.cells[id]
        if (i) ctx.lineTo(p.x, p.y)
        else ctx.moveTo(p.x, p.y)
      })
      ctx.stroke()
    }
  }
  ctx.setLineDash([])
  for (const f of w.warfare?.fleets ?? []) {
    const c = fleetMapPosition(w, f)
    if (markers) {
      ctx.fillStyle = '#24343a'
      ctx.strokeStyle = w.nations[f.nation].color
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(c.x - 10, c.y - 6)
      ctx.lineTo(c.x + 10, c.y - 6)
      ctx.lineTo(c.x + 6, c.y + 6)
      ctx.lineTo(c.x - 6, c.y + 6)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#f0e9d8'
      ctx.font = '8px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText(`${f.warships + f.transports}`, c.x, c.y + 2)
    }
    if (f.nation === selected && f.course.length) {
      ctx.strokeStyle = '#c8b582'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(c.x, c.y)
      for (const id of f.course) ctx.lineTo(w.cells[id].x, w.cells[id].y)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
  ctx.restore()
}
