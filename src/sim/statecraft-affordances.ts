import { borderPolicy } from './border-policy'
/** Action menus are individually executable quotes, never promises that an
 * entire list can be purchased together. Execution revalidates changed worlds. */
import { cabinetCrown, capitulationOptions } from './sovereign-strategy'
import { diplomaticInfluence, dependencyOf } from './state-dependencies'
import { withWorldConfiguration } from './configuration'
import { foundingOptions } from './founding'
import { PUBLIC_WORKS, publicWorkQuote, publicWorkValue } from './public-works'
import { recruitmentQuote } from './recruitment'
import type { World } from './types'

/** Foreign secrets are excluded: menus use home accounts, charted frontier land,
 * bilateral wars and occupations already reported to the owning government. */
export function statecraftAffordances(w: World, nation: number) {
  return withWorldConfiguration(w, () => {
    const n = w.nations[nation],
      own = w.regions.filter((r) => r.nation === nation && !r.control)
    return {
      quotedMonth: w.month,
      borderPolicies: w.relations
        .filter((r) => r.a === nation || r.b === nation)
        .map((r) => {
          const other = r.a === nation ? r.b : r.a
          return {
            nation: other,
            war: r.treaty === 'war',
            own: borderPolicy(r, nation),
            counterpart: borderPolicy(r, other),
          }
        }),
      accessNotice:
        'Host policies override treaties. Transit permits a three-month visit; resupply also allows provisions; basing permits permanent deployment. Wars close formal commerce and peaceful access. Restricted trade permits 20% route capacity, no arms and normal tariffs plus 25 points. Embargoes close all formal bilateral trade and transit.',

      crown: cabinetCrown(w, nation),
      dependency: dependencyOf(w, nation),
      capitulations: w.relations
        .filter((r) => r.treaty === 'war' && [r.a, r.b].includes(nation))
        .flatMap((r) => {
          const target = r.a === nation ? r.b : r.a
          const options = capitulationOptions(w, nation, target)
          const outcomes = options.filter((option) => option.available).map((option) => option.outcome)
          return outcomes.length
            ? [
                {
                  nation: target,
                  outcomes,
                  options,
                  notice:
                    'Complete military defeat permits the victor to impose these terms without the defeated government’s signature.',
                },
              ]
            : []
        }),
      royalTies: (w.dynasties?.marriages ?? [])
        .filter((m) => [m.a, m.b].includes(nation))
        .map((m) => {
          const other = m.a === nation ? m.b : m.a
          return { nation: other, since: m.since, influence: diplomaticInfluence(w, nation, other) }
        }),
      notice:
        'Each option is affordable separately. Orders execute in sequence and are checked again; founding targets are cell IDs, other targets are province IDs.',
      canRecruitIn: own
        .flatMap((r) => {
          const q = recruitmentQuote(w, n, r)
          return q.obstacle ? [] : [{ id: r.id, name: r.name, soldiers: q.soldiers, cost: q.cost }]
        })
        .sort((a, b) => b.soldiers - a.soldiers || a.id - b.id)
        .slice(0, 8),
      canBuildIn: own
        .flatMap((r) =>
          PUBLIC_WORKS.flatMap((kind) => {
            const q = publicWorkQuote(w, r.id, kind)
            return q.obstacle
              ? []
              : [
                  {
                    id: r.id,
                    name: r.name,
                    building: kind,
                    cost: q.cost,
                    score: publicWorkValue(w, r.id, kind, q.cost),
                  },
                ]
          }),
        )
        .sort((a, b) => b.score - a.score || a.id - b.id)
        .slice(0, 12),
      canFoundTargets: foundingOptions(w, nation),
      peaceCandidates: w.relations
        .filter((r) => r.treaty === 'war' && (r.a === nation || r.b === nation))
        .map((r) => ({
          nation: r.a === nation ? r.b : r.a,
          exhaustion: r.warExhaustion,
          heldProvinces: w.regions
            .filter((p) => p.nation === (r.a === nation ? r.b : r.a) && p.control?.nation === nation)
            .map((p) => p.id),
          lostProvinces: w.regions
            .filter((p) => p.nation === nation && p.control?.nation === (r.a === nation ? r.b : r.a))
            .map((p) => p.id),
          notice: 'Peace requires each government’s consent to the recorded terms.',
        })),
    }
  })
}
