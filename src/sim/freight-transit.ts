import { inventory, type World, type Good, type RouteLeg } from './types'
import { cellPosition } from './physical-space'
import { recordGift, marketStore } from './national-accounts'

export function freightDays(w: World, legs: RouteLeg[]) {
  let days = 0
  for (const leg of legs)
    for (let i = 1; i < leg.cells.length; i++) {
      const a = cellPosition(w, leg.cells[i - 1]),
        b = cellPosition(w, leg.cells[i])
      const cell = w.cells[leg.cells[i]],
        region = w.regions[cell.region]
      const speed =
        leg.mode === 'sea'
          ? 6
          : (cell.terrain === 'mountains' ? 1.2 : 3) * (1 + (region?.infrastructure ?? 0))
      days += Math.hypot(a.x - b.x, a.y - b.y) / 1000 / speed / (leg.mode === 'sea' ? 18 : 8)
    }
  return days
}
/** Legal purchase settles once; physical availability waits for arrival when travel exceeds a month. */
export function deliverFreight(
  w: World,
  from: number,
  to: number,
  good: Good,
  amount: number,
  legs: RouteLeg[],
) {
  const days = w.adaptive ? freightDays(w, legs) : 0
  const buyer = w.localEconomy!.units[to]
  if (days <= 30 || !w.adaptive) {
    buyer.stocks[good] += amount
    return
  }
  const a = w.adaptive
  a.transit ??= []
  a.nextTransit ??= 0
  const id = a.nextTransit++
  a.transit.push({
    id,
    from,
    to,
    owner: `producer:${to}`,
    dispatched: w.month,
    arrives: w.month + Math.ceil(days / 30),
    goods: { ...inventory(), [good]: amount },
    legs,
  })
  recordGift(w, marketStore(to), `transit:${id}`, good, amount)
}
export function arriveFreight(w: World) {
  for (const shipment of w.adaptive?.transit ?? [])
    if (shipment.arrives <= w.month) {
      const buyer = w.localEconomy!.units[shipment.to]
      for (const [good, quantity] of Object.entries(shipment.goods) as [Good, number][])
        if (quantity) {
          recordGift(w, `transit:${shipment.id}`, marketStore(shipment.to), good, quantity)
          buyer.stocks[good] += quantity
          shipment.goods[good] = 0
        }
    }
}
