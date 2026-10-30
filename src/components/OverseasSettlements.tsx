/** Civilian commitments share the naval dossier: quotes before funding, actual
 * people and obstacles afterward. Sponsorship is deliberately distinct from rule. */
import { useMemo } from 'react'
import { overseasOptions } from '../sim/overseas'
import { activeExpedition } from '../sim/overseas-types'
import type { Command, World } from '../sim/types'

export function OverseasSettlements({
  world,
  nation,
  command,
}: {
  world: World
  nation: number
  command: (c: Command) => void
}) {
  const options = useMemo(
    () =>
      world.viewOnly
        ? world.viewOverseas?.nation === nation
          ? world.viewOverseas.options
          : []
        : overseasOptions(world, nation),
    [world, nation],
  )
  const expeditions = (world.overseas?.expeditions ?? []).filter((e) => e.nation === nation).slice(-3)
  return (
    <section aria-label="Overseas settlements">
      <h4>Overseas settlements</h4>
      <p className="panel-note">
        Send families with paid supplies and building materials. A landing establishes homes and a foothold;
        provincial ownership changes through local accession, diplomacy or annexation.
      </p>
      {expeditions.map((e) => (
        <div className="fleet-record" key={e.id}>
          <h4>
            {world.regions[e.arrival].name} · {e.stage}
          </h4>
          <p>
            {e.stage === 'assembling'
              ? `${e.settlers.toLocaleString()} settlers preparing at home`
              : activeExpedition(e)
                ? `${e.people.toLocaleString()} settlers aboard`
                : `Expedition ${e.stage}`}
          </p>
          {activeExpedition(e) && (
            <div className="data-row">
              <span>Food aboard</span>
              <b>{e.goods.food.toFixed(1)} t</b>
            </div>
          )}
          {e.obstacle && (
            <p className="panel-note" role="status">
              {e.obstacle}
            </p>
          )}
          {activeExpedition(e) && (
            <button
              className="button full"
              disabled={e.stage === 'returning'}
              onClick={() => command({ type: 'cancel-expedition', nation, expedition: e.id })}
            >
              {e.stage === 'assembling'
                ? 'Cancel expedition and refund funding'
                : e.stage === 'returning'
                  ? 'Returning home'
                  : 'Recall settlers home'}
            </button>
          )}
        </div>
      ))}
      {options.map((q) => (
        <div className="fleet-record" key={q.cell}>
          <h4>{q.name}</h4>
          <p>
            {q.people.toLocaleString()} settlers from {world.regions[q.departure].name} · about {q.months}{' '}
            {q.months === 1 ? 'month' : 'months'} at sea
          </p>
          <p className="panel-note">
            {q.goods.food.toFixed(1)} t food plus timber, stone and tools. Families leave once their reserved
            transport reaches port.
          </p>
          <button
            className="button full"
            onClick={() => command({ type: 'found-overseas', nation, cell: q.cell })}
          >
            Fund expedition · {q.cost.toFixed(1)}k crowns
          </button>
        </div>
      ))}
      {!options.length && !expeditions.some(activeExpedition) && (
        <p className="panel-note">
          No funded passage is currently available. Survey a coast with settlement rights, provide an idle
          transport, and retain people, supplies and funds at a home port.
        </p>
      )}
    </section>
  )
}
