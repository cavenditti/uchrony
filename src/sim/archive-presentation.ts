/** Presentation helpers consume only the selected date's evidence. */
import type { ArchiveResult, ArchiveInstitution } from './world-archive'
import type { Command } from './types'
import type { Charter } from './institution-types'
export type HistoricalLayer = 'political' | 'population' | 'economy' | 'wars'
const intensityColor = (value: number, maximum: number) =>
  `hsl(155 22% ${25 + 45 * Math.sqrt(Math.max(0, value) / maximum)}%)`
/** The legend uses the same zero-based square-root scale as the map, including honest constant/empty states. */
export function historicalMapScale(result: ArchiveResult, layer: HistoricalLayer) {
  if (layer !== 'population' && layer !== 'economy') return undefined
  const values = result.nations.map((n) => Math.max(0, layer === 'population' ? n.population : n.gdp))
  const observedMax = Math.max(0, ...values),
    maximum = observedMax || 1
  const constant = values.length > 0 && values.every((v) => v === values[0])
  const ticks = !values.length ? [] : constant ? [observedMax] : [0, observedMax / 4, observedMax]
  return {
    label: layer === 'population' ? 'National population' : 'National economic output',
    unit: layer === 'population' ? 'people' : 'thousand crowns / month',
    maximum,
    constant,
    ticks: ticks.map((value) => ({ value, color: intensityColor(value, maximum) })),
  }
}
/** Precompute national intensity and war membership once, keeping each map redraw O(states + provinces). */
export function historicalMapColors(result: ArchiveResult, layer: HistoricalLayer) {
  const atWar = new Set(result.wars.flatMap((w) => [w.a, w.b]))
  const scale = historicalMapScale(result, layer)
  const colors = result.nations.map((n) => {
    if (layer === 'political') return n.color
    if (layer === 'wars') return atWar.has(n.id) ? '#b7776d' : '#526a70'
    return intensityColor(layer === 'population' ? n.population : n.gdp, scale!.maximum)
  })
  return result.provinces.map((p) => colors[p.nation] ?? '#5b6560')
}
/** Council participants exclude suspended members; applicants consent to their own admission. */
export function institutionProposal(
  o: ArchiveInstitution,
  actor: number,
  operation: Charter['operation'],
  name: string,
  target: number,
  charter: Charter,
  voters?: number[],
): Command {
  const eligible = o.members.filter((id) => !o.suspended.includes(id) && (!voters || voters.includes(id)))
  const parties =
    operation === 'withdraw' ? [actor] : [...new Set([...eligible, ...(operation === 'join' ? [actor] : [])])]
  return {
    type: 'charter-proposal',
    nation: actor,
    members: [...new Set([actor, ...parties])],
    name: name.trim() || o.name,
    target: operation === 'expel' || operation === 'reinstate' ? target : -1,
    charter: { ...charter, id: o.id, operation },
  }
}
