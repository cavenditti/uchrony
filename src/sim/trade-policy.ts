/** Political terms are fixed during goods clearing. Both market resolutions use
 * the same preference/treaty table while retaining their physical routing rules. */
import { agreementTerms } from './agreements'
import type { World } from './types'

/** Index bilateral access once, avoiding a relation scan for every price comparison. */
export function tradePolicy(w: World) {
  const preferential = new Set<string>()
  for (const { term } of agreementTerms(w))
    if (term.kind === 'trade' || term.kind === 'alliance') {
      preferential.add(`${term.from}:${term.to}`)
      preferential.add(`${term.to}:${term.from}`)
    }
  for (const body of w.institutions?.organizations ?? [])
    if (body.status === 'active' && body.charter.powers.includes('trade'))
      for (const a of body.members) for (const b of body.members) preferential.add(`${a}:${b}`)
  const treaties = w.nations.map(() => new Map<number, string>())
  for (const rel of w.relations) {
    treaties[rel.a].set(rel.b, rel.treaty)
    treaties[rel.b].set(rel.a, rel.treaty)
  }
  const treaty = (a: number, b: number) => treaties[a]?.get(b)
  const count = w.nations.length,
    tariffs = new Float64Array(count * count)
  for (let a = 0; a < count; a++)
    for (let b = 0; b < count; b++)
      if (
        a !== b &&
        treaty(a, b) !== 'trade' &&
        treaty(a, b) !== 'alliance' &&
        !preferential.has(`${a}:${b}`)
      )
        tariffs[a * count + b] = w.nations[a].policies.tariff / 100
  return {
    treaty,
    tariff: (buyer: number, seller: number) =>
      buyer < 0 ? 0 : seller < 0 ? w.nations[buyer].policies.tariff / 100 : tariffs[buyer * count + seller],
  }
}
