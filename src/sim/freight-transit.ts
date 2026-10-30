import { simulationMonths } from './simulation-period'
import { inventory, type World, type Good, type RouteLeg } from './types'
import { cellPosition } from './physical-space'
import { recordGift, marketStore } from './national-accounts'
import { tradePolicy } from './trade-policy'
import { seaPassageView } from './naval-control'
import { tradeRaidView } from './trade-raids'

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
  acquisitionValue?: number,
  raid = tradeRaidView(w),
) {
  const days = w.adaptive ? freightDays(w, legs) : 0
  const buyer = w.localEconomy!.units[to]
  if (days <= 30 * simulationMonths() || !w.adaptive) {
    buyer.stocks[good] += amount
    return raid(from, to, good, amount, legs)
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
    dispatched: w.month - (simulationMonths() > 1 ? simulationMonths() : 0),
    arrives: w.month - (simulationMonths() > 1 ? simulationMonths() : 0) + Math.ceil(days / 30),
    goods: { ...inventory(), [good]: amount },
    legs,
  })
  // Settlement temporarily booked this particular lot at the destination. Remove
  // its acquisition value, not the blended cost of goods already in that market.
  recordGift(w, marketStore(to), `transit:${id}`, good, amount, acquisitionValue)
  return amount
}
export function arriveFreight(w: World) {
  if (!w.adaptive?.transit?.some((s) => s.arrives <= w.month)) return
  const policy = tradePolicy(w),
    passage = seaPassageView(w),
    raid = tradeRaidView(w)
  for (const shipment of w.adaptive?.transit ?? [])
    if (shipment.arrives <= w.month) {
      const buyer = w.localEconomy!.units[shipment.to]
      const seller = w.localEconomy!.units[shipment.from]
      // Paid cargo waits in its conserved transit store when war, an embargo or
      // a port cordon closes its route. Reopening releases it without charging twice.
      if (
        !seller ||
        !buyer ||
        !policy.routeAllowed(seller.nation, buyer.nation, shipment.legs) ||
        !passage(seller.nation, shipment.legs) ||
        !passage(buyer.nation, shipment.legs)
      )
        continue
      for (const [good, quantity] of Object.entries(shipment.goods) as [Good, number][])
        if (quantity && policy.routeAllowed(seller.nation, buyer.nation, shipment.legs, good)) {
          recordGift(w, `transit:${shipment.id}`, marketStore(shipment.to), good, quantity)
          buyer.stocks[good] += quantity
          raid(shipment.from, shipment.to, good, quantity, shipment.legs)
          shipment.goods[good] = 0
        }
    }
}
