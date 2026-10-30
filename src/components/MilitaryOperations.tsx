import { useState } from 'react'
import { Anchor } from 'lucide-react'
import type { Army, Command, World } from '../sim/types'
import { portAt, transportSeats } from '../sim/navy'
import { censusUnitLoyalty as unitLoyalty } from '../sim/view-snapshot'
import { annexationObstacle } from '../sim/military-control'
import type { Fleet } from '../sim/military-types'
import { portBlockadeView } from '../sim/naval-control'

const count = (v: number) => Math.round(v).toLocaleString()
const pct = (v: number) => `${Math.round(v * 100)}%`
export function ArmyLogistics({
  world,
  army: a,
  command,
}: {
  world: World
  army: Army
  command: (c: Command) => void
}) {
  const o = a.operations
  if (!o) return null
  const fleet = world.warfare?.fleets.find((f) => f.id === o.embarkedOn)
  const held = world.regions[a.region].control?.nation === a.nation
  const destruction = held ? world.regions[a.region].control?.destruction : undefined
  const annexation = held ? annexationObstacle(world, a.nation, a.region) : ''
  const available =
    world.warfare?.fleets.filter(
      (f) =>
        f.nation === a.nation &&
        f.cell === portAt(world, a.region)?.water &&
        transportSeats(f) >=
          a.soldiers +
            world.armies.filter((a) => f.embarked.includes(a.id)).reduce((sum, a) => sum + a.soldiers, 0),
    ) ?? []
  return (
    <div className="army-logistics">
      {fleet && (
        <p className="panel-note">
          Embarked aboard {fleet.name}. Its position and destination are controlled through the fleet.
        </p>
      )}
      <div className="data-row">
        <span>Standing establishment</span>
        <b>
          {count(a.soldiers)} / {count(a.establishment ?? a.soldiers)}
        </b>
      </div>
      <div className="data-row">
        <span>Replacements this month</span>
        <b>{count(a.replacements ?? 0)}</b>
      </div>
      <div className="data-row">
        <span>Carried provisions</span>
        <b>{Math.round((o.food / Math.max(0.001, a.soldiers * 0.034)) * 30)} days</b>
      </div>
      <div className="data-row">
        <span>Cohesion / loyalty</span>
        <b>
          {pct(o.cohesion)} / {pct(o.loyalty)}
        </b>
      </div>
      <div className="data-row">
        <span>Fatigue / entrenchment</span>
        <b>
          {pct(o.fatigue)} / {pct(o.entrenchment)}
        </b>
      </div>
      <div className="data-row">
        <span>Supply source</span>
        <b>
          {o.source === null
            ? o.isolated
              ? `Isolated ${o.isolated} mo`
              : 'Awaiting delivery'
            : world.regions[o.source].name}
        </b>
      </div>
      <label className="select-label">
        Standing orders
        <select
          value={o.stance}
          onChange={(e) =>
            command({
              type: 'army-orders',
              army: a.id,
              stance: e.target.value as 'march' | 'hold' | 'entrench',
              conduct: o.conduct,
            })
          }
        >
          <option value="march">Advance toward the objective</option>
          <option value="hold">Hold and recover</option>
          <option value="entrench">Prepare defensive positions</option>
        </select>
      </label>
      <label className="select-label">
        Civilian and trade conduct
        <select
          value={o.conduct}
          onChange={(e) =>
            command({
              type: 'army-orders',
              army: a.id,
              stance: o.stance,
              conduct: e.target.value as NonNullable<Army['operations']>['conduct'],
            })
          }
        >
          <option value="restrained">Protect civilian reserves</option>
          <option value="requisition">Requisition when provision fails</option>
          <option value="pillage">Pillage occupied enemy territory</option>
          <option value="raid">Sack hostile trade routes nearby</option>
          <option value="raze">Raid cities, roads and production facilities</option>
        </select>
      </label>
      {o.conduct === 'requisition' && (
        <p className="panel-note">Taking household food increases local grievance and weakens cooperation.</p>
      )}
      {o.conduct === 'raid' && (
        <p className="panel-note">
          Intercept hostile cargo crossing this province. Capture provisions and ammunition within carrying
          limits; destroy other intercepted goods. Enemy guards reduce the raid.
        </p>
      )}
      {o.conduct === 'raze' && (
        <p className="panel-note">
          Hold or entrench in a securely occupied enemy province to destroy housing, productive capital and
          roads over successive months. Requires supply and ammunition. Construction is lost; residents lose
          housing and local opposition rises.
        </p>
      )}
      {destruction && (
        <p className="panel-note">
          Last destructive raid (month {destruction.month}): {count(destruction.housing)} housing spaces lost,{' '}
          {destruction.capital.toFixed(3)} productive capital lost; {destruction.buildings} buildings and{' '}
          {destruction.roads} road segments demolished.
        </p>
      )}
      {o.foreignStay && (
        <p className="panel-note">
          Temporary foreign deployment: {o.foreignStay.months} months. After three months, basing rights are
          required to remain.
        </p>
      )}
      <RaidReport world={world} force={a.id} />
      {o.conduct === 'pillage' && (
        <p className="panel-note">
          Seize local wealth for your treasury. Pillage damages production and increases fear and opposition;
          it requires a secure enemy occupation.
        </p>
      )}
      {held && (
        <>
          <p className="panel-note">
            Military control of {world.regions[a.region].name}; sovereignty still belongs to{' '}
            {world.nations[world.regions[a.region].nation].shortName}.
          </p>
          <button
            className="button full"
            disabled={!!annexation}
            title={annexation || 'Declare annexation and pay administration costs'}
            onClick={() => command({ type: 'annex', nation: a.nation, region: a.region })}
          >
            Annex this province
          </button>
          {annexation && <p className="panel-note">{annexation}</p>}
        </>
      )}
      {!fleet &&
        available.map((f) => (
          <button
            className="button full"
            key={f.id}
            onClick={() => command({ type: 'embark', army: a.id, fleet: f.id })}
          >
            <Anchor size={14} />
            Embark on {f.name}
          </button>
        ))}
    </div>
  )
}

export function NavalForces({
  world: w,
  nation,
  command,
}: {
  world: World
  nation: number
  command: (c: Command) => void
}) {
  const ports = w.regions.filter((r) => portAt(w, r.id)),
    owned = ports.filter((r) => r.nation === nation)
  const [port, setPort] = useState<number | null>(null),
    [destinations, setDestinations] = useState<Record<number, number>>({}),
    [missions, setMissions] = useState<Record<number, Fleet['mission']>>({})
  const fleets = w.warfare?.fleets.filter((f) => f.nation === nation) ?? [],
    yard = owned.find((p) => p.id === port) ?? owned[0]
  const blockade = portBlockadeView(w)
  return (
    <section className="naval-forces" aria-label="Navy">
      <h3>Naval forces</h3>
      <p className="panel-note">
        Warships contest nearby sea lanes. Transports carry troops and support supply convoys. Fleets need
        provisions, crews, ammunition, and access to ports for repair.
      </p>
      {!fleets.length && <p className="empty-state">This state has no fleet in service.</p>}
      {fleets.map((f) => (
        <div className="fleet-record" key={f.id}>
          <h4>
            <Anchor size={15} />
            {f.name}
          </h4>
          <p>
            {f.warships} warships · {f.transports} transports · {count(f.soldiers)} crew
          </p>
          <div className="data-row">
            <span>Hull / provision</span>
            <b>
              {pct(f.hull)} / {pct(f.supply)}
            </b>
          </div>
          <div className="data-row">
            <span>Morale / loyalty</span>
            <b>
              {pct(f.morale)} / {pct(unitLoyalty(w, f).loyalty)}
            </b>
          </div>
          <div className="data-row">
            <span>Transport berths</span>
            <b>{count(transportSeats(f))}</b>
          </div>
          <div className="data-row">
            <span>Embarked troops</span>
            <b>
              {count(
                w.armies.filter((a) => f.embarked.includes(a.id)).reduce((sum, a) => sum + a.soldiers, 0),
              )}
            </b>
          </div>
          <p className="panel-note">
            {f.course.length
              ? `Underway toward ${f.target === null ? 'open water' : w.regions[f.target].name} · ${f.course.length} sea cells remaining`
              : `Off ${w.regions[f.region].name}`}{' '}
            · {f.mission}
          </p>
          <label className="select-label">
            Destination coast
            <select
              value={destinations[f.id] ?? f.target ?? f.home}
              onChange={(e) => setDestinations({ ...destinations, [f.id]: Number(e.target.value) })}
            >
              {ports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {w.nations[r.nation]?.shortName ?? 'Unclaimed'}
                </option>
              ))}
            </select>
          </label>
          <label className="select-label">
            Naval mission
            <select
              value={missions[f.id] ?? f.mission}
              onChange={(e) => setMissions({ ...missions, [f.id]: e.target.value as typeof f.mission })}
            >
              <option value="escort">Escort trade and convoys</option>
              <option value="patrol">Patrol the coast</option>
              <option value="blockade">Blockade an enemy port</option>
              <option value="raid">Sack hostile sea trade routes</option>
              <option value="transport">Transport and land troops</option>
              <option value="return">Return to an accessible port</option>
            </select>
          </label>
          {(missions[f.id] ?? f.mission) === 'blockade' && (
            <p className="panel-note">
              Nearby supplied warships close the target port to all trade and troop landings, including
              neutral traffic. Escorts can contest the cordon.
            </p>
          )}
          {f.mission === 'blockade' && f.target !== null && (
            <p className="panel-note">
              {blockade(w.regions[f.target].nation, f.target) === 0
                ? `${w.regions[f.target].name}: port closed by blockade.`
                : 'The target port is not fully closed; position and naval strength determine access.'}
            </p>
          )}
          {(missions[f.id] ?? f.mission) === 'raid' && (
            <p className="panel-note">
              Raid hostile cargo within four water-cell spans of the fleet. Neutral-only trade is spared;
              escorts reduce interception.
            </p>
          )}
          <RaidReport world={w} force={f.id} />
          <button
            className="button full"
            onClick={() =>
              command({
                type: 'fleet-order',
                fleet: f.id,
                target: destinations[f.id] ?? f.target ?? f.home,
                mission: missions[f.id] ?? f.mission,
              })
            }
          >
            Issue naval orders
          </button>
        </div>
      ))}
      {yard ? (
        <>
          <h4>Commission ships</h4>
          <label className="select-label">
            Shipbuilding port
            <select value={yard.id} onChange={(e) => setPort(Number(e.target.value))}>
              {owned.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div className="action-grid">
            <button
              className="button"
              onClick={() =>
                command({ type: 'commission', nation, region: yard.id, warships: 1, transports: 0 })
              }
            >
              1 warship · 650k
            </button>
            <button
              className="button"
              onClick={() =>
                command({ type: 'commission', nation, region: yard.id, warships: 0, transports: 4 })
              }
            >
              4 transports · 1.4m
            </button>
          </div>
          <p className="panel-note">
            Each warship also needs 55 t timber, 18 t iron, 10 t arms, 4 t tools and 90 crew. Each transport
            needs 40 t timber, 8 t iron, 4 t tools and 30 crew. Transport berths hold 800 troops per intact
            ship.
          </p>
        </>
      ) : (
        <p className="panel-note">A coastal port is required to commission ships.</p>
      )}
    </section>
  )
}

/** Reports count intercepted consignments rather than potential loot. */
function RaidReport({ world, force }: { world: World; force: number }) {
  const raids = world.warfare?.raids?.filter((r) => r.force === force && r.month === world.month) ?? []
  if (!raids.length) return null
  return (
    <p className="panel-note">
      Cargo sacked this month: {raids.reduce((sum, r) => sum + r.captured, 0).toFixed(1)} t captured;{' '}
      {raids.reduce((sum, r) => sum + r.destroyed, 0).toFixed(1)} t destroyed.
    </p>
  )
}
