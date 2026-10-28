import { intelligenceService } from './intelligence'
import { expansionParameters } from './expansion-parameters'
import { clamp, population, type Nation, type World } from './types'

/** Competition uses received economic reports and dated charts. An undiscovered
 * rival's treasury, production or armies must never leak into a cabinet's choice. */
export function competitivePressure(w: World, nation: Nation) {
  const own = w.regions.filter((r) => r.nation === nation.id)
  const service = intelligenceService(w, nation.id)
  const borders = new Set(own.flatMap((r) => r.neighbors))
  const peers = service.dossiers
    .map((dossier) => {
      const chart = service.chart.filter((p) => p.nation === dossier.nation)
      const adjacent = chart.some((p) => borders.has(p.id))
      const confidence = dossier.economy
        ? dossier.economy.confidence * Math.exp(-Math.max(0, w.month - dossier.economy.month) / 36)
        : 0
      const output = dossier.economy?.values.output?.estimate ?? 0
      const people = dossier.economy?.values.population?.estimate ?? 0
      const productivity = people > 0 ? output / people : 0
      const domestic = nation.gdp / Math.max(1, nation.population)
      const prosperityGap = confidence * clamp(productivity / Math.max(0.0001, domestic) - 1)
      const territory = chart.reduce((sum, p) => sum + Math.exp(-Math.max(0, w.month - p.month) / 120), 0)
      const territorialGap = clamp(territory / Math.max(1, own.length) - 1)
      const advance = clamp(dossier.expansion / 3)
      const pressure = (prosperityGap * 0.45 + territorialGap * 0.35 + advance * 0.2) * (adjacent ? 1 : 0.5)
      return { nation: dossier.nation, adjacent, prosperityGap, territorialGap, advance, pressure }
    })
    .sort((a, b) => b.pressure - a.pressure || a.nation - b.nation)
  const peer = Math.max(0, ...peers.map((p) => p.pressure))
  const resourceShortage = Math.max(
    0,
    ...(['timber', 'stone', 'iron', 'coal', 'tools'] as const).map((good) => {
      const demand = own.reduce((sum, r) => sum + r.consumption[good], 0)
      const output = own.reduce((sum, r) => sum + r.production[good], 0)
      return demand > 0 ? clamp(1 - output / demand) : 0
    }),
  )
  const food = clamp((1 - nation.foodCoverage) * 3)
  const density =
    own.reduce((sum, r) => sum + population(r), 0) /
    Math.max(
      1,
      own.reduce((sum, r) => sum + r.cells.length, 0),
    )
  const economic = clamp(food * 0.5 + resourceShortage * 0.35 + Math.min(1, density / 120) * 0.15)
  const drives = nation.character?.leader.politics?.drives
  const urgency = clamp(
    (0.2 + economic * 0.5 + peer * expansionParameters().peerWeight) *
      (0.65 + (drives?.ambition ?? 0.5) * 0.35),
  )
  return { economic, peer, urgency, peers: peers.slice(0, 4) }
}
