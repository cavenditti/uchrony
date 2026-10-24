import { useState } from 'react'
import { Anchor } from 'lucide-react'
import type { Army, Command, World } from '../sim/types'
import { portAt, transportSeats } from '../sim/navy'
import { unitLoyalty } from '../sim/forces'

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
        Civilian food
        <select
          value={o.conduct}
          onChange={(e) =>
            command({
              type: 'army-orders',
              army: a.id,
              stance: o.stance,
              conduct: e.target.value as 'restrained' | 'requisition',
            })
          }
        >
          <option value="restrained">Protect civilian reserves</option>
          <option value="requisition">Requisition when provision fails</option>
        </select>
      </label>
      {o.conduct === 'requisition' && (
        <p className="panel-note">Taking household food increases local grievance and weakens cooperation.</p>
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
    [missions, setMissions] = useState<
      Record<number, 'patrol' | 'escort' | 'blockade' | 'transport' | 'return'>
    >({})
  const fleets = w.warfare?.fleets.filter((f) => f.nation === nation) ?? [],
    yard = owned.find((p) => p.id === port) ?? owned[0]
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
              ? `Underway toward ${f.target === null ? 'open water' : w.regions[f.target].name} · ${f.course.length} sea hexes remaining`
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
                  {r.name} · {w.nations[r.nation].shortName}
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
              <option value="transport">Transport and land troops</option>
              <option value="return">Return to an accessible port</option>
            </select>
          </label>
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
