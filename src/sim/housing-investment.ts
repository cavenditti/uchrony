import { simulationMonths } from './simulation-period'
import { constructionMaterials } from './construction-materials'
import { habitableLand } from './terrain-access'
import type { World } from './types'
import type { PhysicalSite, PointMeters } from './adaptive-types'
import { compactResidence, findResidentialParcel } from './residential-sites'
import { residentialFootprint, footprintConnection, localWalkingConnection } from './residential-geometry'
import { cellPolygon, polygonArea } from './physical-space'
import { settlementAccess } from './settlement-access'

/** Marginal rebuilding costs rise with floor space per unit of land. A new
 * serviced plot also needs actual access works, even for a tiny first building.
 * Coefficients are declared physical inputs, not a target number of towns.
 */
export function housingInputs(capacity: number, opening: number, landArea: number, accessMeters?: number) {
  const groundCapacity = Math.max(1, landArea / 40)
  const scale = 1 + (0.18 * (opening ** 2 + opening * capacity + capacity ** 2 / 3)) / groundCapacity ** 2
  const fixed = accessMeters === undefined ? 0 : 1
  return {
    timber: 0.08 * capacity * scale + fixed * (4 + (accessMeters ?? 0) * 0.005),
    stone: 0.05 * capacity * scale + fixed * (8 + (accessMeters ?? 0) * 0.04),
    labor: 0.1 * capacity * scale + fixed * (2 + (accessMeters ?? 0) * 0.02),
  }
}

export function planHousingInvestment(
  w: World,
  target: PhysicalSite,
  need: number,
  homes: PhysicalSite[],
  availableLabor: number,
  access: ReturnType<typeof settlementAccess>,
  pending: ReadonlySet<string> = new Set(w.adaptive!.construction?.map((p) => p.site)),
  catchmentMeters = 1000,
  surveyExpansion = true,
  locationPreference?: (point: PointMeters) => number,
) {
  const unit = w.localEconomy!.units[target.pool],
    sponsor = w.economy!.producers[target.pool]
  type Plot = NonNullable<ReturnType<typeof findResidentialParcel>>
  const choices: {
    site: PhysicalSite
    plot?: Plot
    spaces: number
    inputs: ReturnType<typeof housingInputs> & { bricks: number }
    cost: number
  }[] = []
  const choose = () =>
    choices
      .sort(
        (a, b) =>
          a.cost - b.cost || Number(!!a.plot) - Number(!!b.plot) || a.site.id.localeCompare(b.site.id),
      )
      .slice(0, 8)
      .map((choice) => ({
        choice,
        adjusted:
          choice.cost /
          (1 + 0.3 * Math.max(0, Math.min(1, locationPreference?.(choice.plot?.point ?? choice.site) ?? 0))),
      }))
      .sort((a, b) => a.adjusted - b.adjusted || a.choice.site.id.localeCompare(b.choice.site.id))[0]?.choice
  const consider = (site: PhysicalSite, plot?: Plot, accessMeters?: number) => {
    const area = plot
      ? plot.building
        ? polygonArea(plot.building)
        : plot.parcel.size ** 2
      : compactResidence(site)
        ? polygonArea(residentialFootprint(w, site))
        : polygonArea(cellPolygon(w, site.cell))
    if (!habitableLand(w.cells[plot?.cell ?? site.cell])) return
    const opening = plot ? 0 : site.capacity
    const inputsFor = (q: number) => {
      const base =
        w.adaptive!.residentialVersion === 1
          ? housingInputs(q, opening, area, accessMeters)
          : { timber: q * 0.08, stone: q * 0.05, labor: q * 0.1 }
      const materials = constructionMaterials(unit, { timber: base.timber, stone: base.stone })
      return {
        timber: base.timber,
        stone: materials.stone ?? 0,
        bricks: materials.bricks ?? 0,
        labor: base.labor,
      }
    }
    const affordable = (q: number) => {
      const inputs = inputsFor(q)
      return (
        inputs.timber <= unit.stocks.timber &&
        inputs.stone <= unit.stocks.stone &&
        inputs.bricks <= unit.stocks.bricks &&
        inputs.labor <= availableLabor &&
        inputs.labor * (sponsor.wage / simulationMonths()) <= sponsor.cash
      )
    }
    let lo = 0,
      hi = plot
        ? Math.min(need, area / 40)
        : site.building
          ? Math.min(need, Math.max(0, area / 10 - opening))
          : need
    if (!affordable(0)) return
    if (affordable(hi)) lo = hi
    else
      for (let i = 0; i < 48; i++) {
        const mid = (lo + hi) / 2
        if (affordable(mid)) lo = mid
        else hi = mid
      }
    if (lo <= 1e-6) return
    const inputs = inputsFor(lo),
      cost =
        inputs.timber * unit.prices.timber +
        inputs.stone * unit.prices.stone +
        inputs.bricks * unit.prices.bricks +
        inputs.labor * (sponsor.wage / simulationMonths())
    choices.push({ site, plot, spaces: lo, inputs, cost: cost / lo })
  }
  // Reuse vacant/partly developed plots near the demanded location before
  // comparing the full servicing cost of another outward expansion.
  const targetAccess = access.baseUtility(target)
  for (const home of homes)
    if (
      (w.adaptive?.buildingVersion !== 1 || !!home.building) &&
      !pending.has(home.id) &&
      Math.hypot(home.x - target.x, home.y - target.y) <= catchmentMeters &&
      access.baseUtility(home) >= targetAccess - 0.08 &&
      (!compactResidence(target) || compactResidence(home))
    )
      consider(home)
  if (surveyExpansion && w.adaptive!.residentialVersion === 1 && target.parcel) {
    // Even a free, adjacent plot pays setup costs. Skip its survey when the
    // cheapest infill is already below this strict new-plot cost lower bound.
    const minimum = housingInputs(need, 0, Infinity, 0)
    const minimumMaterials = constructionMaterials(unit, minimum)
    const lowerBound =
      (minimum.timber * unit.prices.timber +
        (minimumMaterials.stone ?? 0) * unit.prices.stone +
        (minimumMaterials.bricks ?? 0) * unit.prices.bricks +
        minimum.labor * (sponsor.wage / simulationMonths())) /
      need
    if (choices.some((c) => c.cost <= lowerBound)) return choose()
    const plot = findResidentialParcel(w, target, homes)
    if (plot) {
      const footprint = [
        plot.parcel,
        { x: plot.parcel.x + plot.parcel.size, y: plot.parcel.y },
        { x: plot.parcel.x + plot.parcel.size, y: plot.parcel.y + plot.parcel.size },
        { x: plot.parcel.x, y: plot.parcel.y + plot.parcel.size },
      ]
      const edges = homes
        .filter((s) => s.capacity > 0)
        .map((s) => footprintConnection(residentialFootprint(w, s), footprint))
        .sort((a, b) => a.distance - b.distance)
      const connection = edges.find((c) => localWalkingConnection(w, c.from, c.to, unit.nation))
      if (connection) consider(target, plot, connection.distance)
    }
  }
  return choose()
}
