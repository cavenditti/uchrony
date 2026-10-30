/** Local investment choices stay in the existing ruled province dossier.
 * Quotes describe construction; they never promise production or a return. */
import { useState } from 'react'
import { Factory } from 'lucide-react'
import { facilityQuote } from '../sim/facility-investment'
import { FACILITY_DEFINITIONS, FACILITY_KINDS, type FacilityKind } from '../sim/facility-types'
import { economicRegions, provinceId } from '../sim/local-units'
import { facilityDistrictActivity } from '../sim/productive-facilities'
import { population, type Command, type World } from '../sim/types'

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 })

export function FacilityDevelopment({
  world,
  province,
  command,
}: {
  world: World
  province: number
  command: (command: Command) => void
}) {
  const [district, setDistrict] = useState<number | null>(null),
    [chosen, setChosen] = useState<FacilityKind | null>(null)
  const units = economicRegions(world)
    .filter((r) => provinceId(r) === province && population(r) > 0)
    .sort((a, b) => population(b) - population(a) || a.id - b.id)
  const unit = units.find((r) => r.id === district) ?? units[0]
  if (!unit) return null
  if (world.viewOnly && world.viewNation !== undefined && world.viewNation !== world.regions[province].nation)
    return (
      <p className="panel-note" role="status">
        Loading district investment conditions…
      </p>
    )
  const quotes = FACILITY_KINDS.map((kind) => facilityQuote(world, unit, kind)),
    recommended = [...quotes].filter((q) => !q.obstacle).sort((a, b) => b.score - a.score)[0],
    kind = chosen ?? recommended?.kind ?? 'market',
    quote = quotes.find((q) => q.kind === kind)!,
    specialization = facilityDistrictActivity(world, unit) ?? 'mixed'
  const pending = world.facilities?.projects.filter((p) => unit.cells.includes(p.cell)) ?? []
  const built = quotes.filter((q) => q.installed > 0)
  return (
    <section aria-label="District productive facilities">
      <h3>District facilities</h3>
      <label className="district-selector">
        Investment location
        <select value={unit.id} onChange={(e) => setDistrict(Number(e.target.value))}>
          {units.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {number(population(r))} residents
            </option>
          ))}
        </select>
      </label>
      <div className="data-row">
        <span>Installed specialization</span>
        <b>{specialization}</b>
      </div>
      <label className="district-selector">
        Facility to build
        <select value={kind} onChange={(e) => setChosen(e.target.value as FacilityKind)}>
          {FACILITY_KINDS.map((id) => (
            <option key={id} value={id}>
              {FACILITY_DEFINITIONS[id].name}
            </option>
          ))}
        </select>
      </label>
      <div className="data-row">
        <span>Next site's tier / technology limit</span>
        <b>
          {quote.level} / {quote.limit}
        </b>
      </div>
      {quote.cost > 0 && (
        <>
          <div className="data-row">
            <span>Construction cost</span>
            <b>{number(quote.cost * 1000)} crowns</b>
          </div>
          <div className="data-row">
            <span>Construction labor / duration</span>
            <b>
              {number(quote.workerMonths)} worker-months · {quote.duration} months
            </b>
          </div>
        </>
      )}
      <p className="panel-note" role={quote.obstacle ? 'status' : undefined}>
        {quote.obstacle || quote.reason}
      </p>
      <button
        className="button secondary"
        disabled={!!quote.obstacle}
        onClick={() =>
          command({
            type: 'build-facility',
            region: province,
            district: unit.id,
            facility: kind,
            ...(quote.cell === undefined ? {} : { cell: quote.cell }),
          })
        }
      >
        <Factory size={14} />
        {quote.level > 0 ? 'Upgrade' : 'Build'} {FACILITY_DEFINITIONS[kind].name.toLowerCase()}
      </button>
      {recommended && recommended.kind !== kind && (
        <p className="panel-note">
          Best current prospect: {FACILITY_DEFINITIONS[recommended.kind].name}. {recommended.reason}
        </p>
      )}
      {(built.length > 0 || pending.length > 0) && (
        <dl className="stratum-accounts">
          {built.map((q) => (
            <div key={q.kind}>
              <dt>{FACILITY_DEFINITIONS[q.kind].name}</dt>
              <dd>
                {number(q.installed)} completed {q.installed === 1 ? 'tier' : 'tiers'}
              </dd>
            </div>
          ))}
          {pending.map((p) => (
            <div key={p.cell}>
              <dt>
                {FACILITY_DEFINITIONS[p.kind].name} · tier {p.level}
              </dt>
              <dd>{Math.max(0, p.completes - world.month)} months remaining</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="panel-note">
        Mines and quarries need natural deposits. Workshops need workers, raw inputs and customers. Markets
        reduce handling costs and storage losses. All facilities share six tier slots per terrain tile;
        further research unlocks upgrades.
      </p>
    </section>
  )
}
