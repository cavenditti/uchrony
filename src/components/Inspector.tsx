import { DistrictEconomies } from './DistrictEconomies'
import { spatialState } from '../sim/spatial'
import { MacroAccounts } from './EconomicAccounts'
import { StateAdvisor } from './StateAdvisor'
import { StateSecurity } from './StateSecurity'
import { IntelligenceOffice } from './IntelligenceOffice'
import { useState } from 'react'
import {
  ArrowUpRight,
  ArrowRight,
  Wheat,
  Factory,
  Landmark,
  BookOpen,
  Heart,
  Shield,
  Coins,
  Users,
  Route,
  FlaskConical,
  Compass,
  MapPin,
  Swords,
  Handshake,
  ChevronRight,
  X,
  Sprout,
  Pickaxe,
  TreePine,
  Gem,
  Hammer,
  Shirt,
  Flame,
  Flag,
  Building2,
  SlidersHorizontal,
  Activity,
  ScrollText,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  type World,
  type Command,
  type Nation,
  type Region,
  type Research,
  type Policies,
  type Good,
  FIELDS,
  GOODS,
  population,
  relation,
  dateLabel,
} from '../sim/types'
import { routeDistance } from '../map/trade'
import { TECH_NAMES, researchCost } from '../sim/engine'
import { DiplomaticChancery } from './DiplomaticChancery'
import type { AgentServiceStatus } from '../sim/statecraft-types'
import { HistoricalForces, HistoricalConsequences } from './HistoricalForces'
import { PopulationIdentities } from './PopulationIdentities'
import { StateCharacter } from './StateCharacter'
import { ArmyLogistics, NavalForces } from './MilitaryOperations'
import { militaryPeople } from '../sim/forces'

export type Tab =
  'atlas' | 'population' | 'economy' | 'diplomacy' | 'military' | 'research' | 'government' | 'chronicle'
export const TAB_INFO: { id: Tab; name: string; icon: LucideIcon }[] = [
  { id: 'atlas', name: 'Atlas', icon: Compass },
  { id: 'population', name: 'Population', icon: Users },
  { id: 'economy', name: 'Economy', icon: Coins },
  { id: 'diplomacy', name: 'Diplomacy', icon: Handshake },
  { id: 'military', name: 'Military', icon: Swords },
  { id: 'research', name: 'Research', icon: FlaskConical },
  { id: 'government', name: 'Government', icon: Landmark },
  { id: 'chronicle', name: 'Chronicle', icon: ScrollText },
]
const goodIcons: Record<Good, LucideIcon> = {
  food: Wheat,
  timber: TreePine,
  stone: Gem,
  iron: Pickaxe,
  coal: Flame,
  tools: Hammer,
  textiles: Shirt,
  arms: Swords,
}
export const compact = (v: number, digits = 1) =>
  Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: digits }).format(v)
export const money = (v: number) => compact(v * 1000)
const percent = (v: number) => `${Math.round(v * 100)}%`
const title = (v: string) => v[0].toUpperCase() + v.slice(1)
const signed = (v: number) => `${v >= 0 ? '+' : ''}${compact(v)}`

export function FlagMark({ nation, small = false }: { nation: Nation; small?: boolean }) {
  return (
    <span
      className={`flag-mark ${small ? 'small' : ''}`}
      style={{ '--flag': nation.color } as React.CSSProperties}
    >
      <svg viewBox="0 0 30 36" aria-hidden="true">
        <path d="M3 3h24v17c0 7-12 13-12 13S3 27 3 20Z" fill="currentColor" />
        <path
          d={
            nation.id % 3 === 0
              ? 'M15 8v17M8 16h14M10 10l10 14M20 10L10 24'
              : nation.id % 3 === 1
                ? 'M8 12l7 12 7-12M8 19h14'
                : 'M8 11h14v13H8zM15 7v21'
          }
          fill="none"
          stroke="#233139"
          strokeWidth="1.8"
        />
      </svg>
    </span>
  )
}
export function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="metric">
      <div>
        <Icon size={14} />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}
function Meter({
  label,
  value,
  text,
  color,
}: {
  label: string
  value: number
  text?: string
  color?: string
}) {
  return (
    <div className="meter">
      <div>
        <span>{label}</span>
        <strong>{text ?? percent(value)}</strong>
      </div>
      <div className="meter-track">
        <span style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }} />
      </div>
    </div>
  )
}
function Chart({
  world,
  nation,
  metric = 'population',
}: {
  world: World
  nation: number
  metric?: 'population' | 'gdp'
}) {
  const history = world.history.slice(-60),
    points = history.map((p) => ({
      month: p.month,
      value: p.nations.find((n) => n.id === nation)?.[metric] ?? 0,
    }))
  if (points.length < 2)
    return (
      <div className="chart-empty">
        <Activity size={18} />
        <span>Advance time to trace this state’s history.</span>
      </div>
    )
  const values = points.map((p) => p.value),
    min = Math.min(...values) * 0.99,
    max = Math.max(...values) * 1.01
  const coordinates = points.map(
    (p, i) =>
      `${8 + (i / (points.length - 1)) * 254},${79 - ((p.value - min) / Math.max(1, max - min)) * 62}`,
  )
  return (
    <div className="history-chart">
      <svg
        viewBox="0 0 270 100"
        role="img"
        aria-label={`${metric} history: ${compact(values[0])} to ${compact(values[values.length - 1])}`}
      >
        <path d="M8 18H262M8 48H262M8 79H262" fill="none" stroke="currentColor" opacity=".1" />
        <path d={`M${coordinates.join('L')}L262 80L8 80Z`} fill="var(--accent)" opacity=".08" />
        <path d={`M${coordinates.join('L')}`} fill="none" stroke="var(--accent)" strokeWidth="1.7" />
        <text x="8" y="96">
          {dateLabel({ month: points[0].month, startYear: world.startYear })}
        </text>
        <text x="262" y="96" textAnchor="end">
          {dateLabel(world)}
        </text>
        <text x="8" y="11">
          {metric === 'gdp' ? money(max) : compact(max)}
        </text>
      </svg>
    </div>
  )
}
function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="section-heading">
      <h3>{children}</h3>
      {aside}
    </div>
  )
}
function PolicySlider({
  name,
  description,
  value,
  min = 0,
  max = 80,
  suffix = '%',
  onChange,
}: {
  name: string
  description: string
  value: number
  min?: number
  max?: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  return (
    <label className="policy-slider">
      <span>
        <strong>{name}</strong>
        <b>
          {draft ?? value}
          {suffix}
        </b>
      </span>
      <small>{description}</small>
      <input
        aria-label={name}
        type="range"
        min={min}
        max={max}
        value={draft ?? value}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={(e) => {
          onChange(Number(e.currentTarget.value))
          setDraft(null)
        }}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            onChange(Number(e.currentTarget.value))
            setDraft(null)
          }
        }}
      />
    </label>
  )
}

interface InspectorProps {
  onAdvise?: (nation: number, text: string) => void
  onWithdrawAdvice?: (nation: number, id: number) => void
  agentStatus: AgentServiceStatus
  onStrategy: (nation: number) => void
  onEventDetails: (event: number) => void
  pendingDetails: number[]
  world: World
  nationId: number
  regionId: number | null
  tab: Tab
  onTab: (tab: Tab) => void
  onCommand: (command: Command) => void
  onFocus: (region: number) => void
  onRegion: (region: number | null) => void
  onNation: (nation: number) => void
  onArmy: (army: number | null) => void
  orderedArmy: number | null
}

export function Inspector({
  onAdvise,
  onWithdrawAdvice,
  agentStatus,
  onStrategy,
  onEventDetails,
  pendingDetails,
  world: w,
  nationId,
  regionId,
  tab,
  onTab,
  onCommand: command,
  onFocus,
  onRegion,
  onNation,
  onArmy,
  orderedArmy,
}: InspectorProps) {
  const n = w.nations[nationId] ?? w.nations[0],
    regions = w.regions.filter((r) => r.nation === n.id),
    r = regionId !== null ? w.regions[regionId] : null
  const [diplomat, setDiplomat] = useState<number | null>(null),
    [eventFilter, setEventFilter] = useState('all')
  const avg = (
    key: 'literacy' | 'health' | 'happiness' | 'foodCoverage' | 'infrastructure' | 'materialCoverage',
  ) =>
    regions.reduce((s, r) => s + (r[key] ?? 1) * population(r), 0) /
    Math.max(
      1,
      regions.reduce((s, r) => s + population(r), 0),
    )
  const people = {
    children: regions.reduce((s, r) => s + r.population.children, 0),
    adults: regions.reduce((s, r) => s + r.population.adults, 0) + militaryPeople(w, n.id),
    elders: regions.reduce((s, r) => s + r.population.elders, 0),
  }
  const armies = w.armies.filter((a) => a.nation === n.id),
    soldiers = armies.reduce((s, a) => s + a.soldiers, 0)
  const tech = n.researchFocus,
    level = n.technologies[tech],
    progress = level >= 6 ? 1 : n.researchProgress[tech] / researchCost(level)
  const rels = w.relations.filter((rel) => rel.a === n.id || rel.b === n.id)
  const policy = (key: keyof Policies, value: Policies[keyof Policies]) =>
    command({ type: 'policy', nation: n.id, key, value })
  const target = diplomat !== null && diplomat !== n.id ? w.nations[diplomat] : null
  const targetRel = target ? relation(w, n.id, target.id) : null

  return (
    <aside className="inspector" aria-label={`${n.name} inspector`}>
      <div className="inspector-country">
        <FlagMark nation={n} />
        <div>
          <h2>{n.name}</h2>
          <p>
            {n.government}
            <span>·</span>
            {n.ai ? 'Autonomous' : 'Player governed'}
            <span>·</span>
            <span className={n.stability < 45 ? 'negative' : ''}>
              {n.stability > 65 ? 'Stable' : n.stability > 45 ? 'Uneasy' : 'Unrest'}
            </span>
          </p>
        </div>
        <button
          className="icon-button"
          title="Focus capital"
          aria-label={`Focus ${n.shortName} capital`}
          onClick={() => onFocus(n.capital)}
        >
          <MapPin size={17} />
        </button>
      </div>
      <StateCharacter world={w} nation={n} compact />
      <div className="inspector-body" key={`${tab}-${n.id}`}>
        {onAdvise && onWithdrawAdvice && (
          <StateAdvisor key={n.id} world={w} nation={n.id} onSend={onAdvise} onWithdraw={onWithdrawAdvice} />
        )}

        {tab === 'atlas' && (
          <>
            {r ? (
              <Province
                region={r}
                world={w}
                command={command}
                onClose={() => onRegion(null)}
                onFocus={onFocus}
              />
            ) : (
              <>
                <div className="metrics-grid">
                  <Metric
                    icon={Users}
                    label="Population"
                    value={compact(n.population)}
                    detail={`${regions.length} provinces`}
                  />
                  <Metric icon={Coins} label="Treasury" value={money(n.treasury)} detail="crowns" />
                  <Metric icon={Factory} label="Monthly GDP" value={money(n.gdp)} detail="crowns / month" />
                  <Metric
                    icon={Shield}
                    label="Armed forces"
                    value={compact(soldiers)}
                    detail={`${armies.length} field corps`}
                  />
                </div>
                <SectionTitle
                  aside={<span className="subtle">Last {Math.min(60, w.history.length)} months</span>}
                >
                  Population over time
                </SectionTitle>
                <Chart world={w} nation={n.id} />
                <SectionTitle>The state of the nation</SectionTitle>
                <Meter label="Food needs met" value={avg('foodCoverage')} />
                <Meter label="Other needs met" value={avg('materialCoverage')} />
                <Meter label="Public contentment" value={avg('happiness')} />
                <Meter label="Literacy" value={avg('literacy')} color="#8aa8b6" />
                <button className="research-summary" onClick={() => onTab('research')}>
                  <FlaskConical size={20} />
                  <span>
                    <small>Current research</small>
                    <strong>{TECH_NAMES[tech][level] ?? 'Field complete'}</strong>
                  </span>
                  <ChevronRight size={16} />
                  <div className="research-mini-track">
                    <i style={{ width: `${progress * 100}%` }} />
                  </div>
                </button>
                <button className="button primary full" onClick={() => onTab('government')}>
                  <Landmark size={15} />
                  Open government
                  <ArrowRight size={15} />
                </button>
                <p className="panel-note">
                  Select a province on the map to inspect its people, resources, and development.
                </p>
              </>
            )}
          </>
        )}
        {tab === 'population' && (
          <>
            <div className="panel-lead">
              <Users size={22} />
              <div>
                <strong>{compact(n.population)}</strong>
                <span>people in {n.shortName}</span>
              </div>
            </div>
            <div className="cohort-bar">
              {Object.entries(people).map(([key, value], i) => (
                <span
                  key={key}
                  style={{
                    width: `${(value / Math.max(1, n.population)) * 100}%`,
                    background: ['#a9bb8e', '#d5b777', '#879bad'][i],
                  }}
                />
              ))}
            </div>
            <div className="cohort-labels">
              {Object.entries(people).map(([key, value], i) => (
                <div key={key}>
                  <span style={{ background: ['#a9bb8e', '#d5b777', '#879bad'][i] }} />
                  <small>{title(key)}</small>
                  <strong>{compact(value)}</strong>
                </div>
              ))}
            </div>
            <SectionTitle>This month</SectionTitle>
            <div className="data-row">
              <span>Births</span>
              <b className="positive">+{compact(regions.reduce((s, r) => s + r.births, 0))}</b>
            </div>
            <div className="data-row">
              <span>Civilian deaths</span>
              <b>{compact(regions.reduce((s, r) => s + r.deaths, 0))}</b>
            </div>
            <div className="data-row">
              <span>Net migration</span>
              <b>{signed(regions.reduce((s, r) => s + r.migration, 0))}</b>
            </div>
            <SectionTitle>Living conditions</SectionTitle>
            <Meter label="Health" value={avg('health')} />
            <Meter label="Literacy" value={avg('literacy')} />
            <Meter label="Food needs met" value={avg('foodCoverage')} />
            <Meter label="Other needs met" value={avg('materialCoverage')} />
            <PopulationIdentities world={w} nation={n.id} />
            <SectionTitle>Population history</SectionTitle>
            <Chart world={w} nation={n.id} />
            <SectionTitle>Largest provinces</SectionTitle>
            {[...regions]
              .sort((a, b) => population(b) - population(a))
              .slice(0, 7)
              .map((r) => (
                <button
                  className="province-row"
                  key={r.id}
                  onClick={() => {
                    onRegion(r.id)
                    onFocus(r.id)
                    onTab('atlas')
                  }}
                >
                  <MapPin size={13} />
                  <span>{r.name}</span>
                  <strong>{compact(population(r))}</strong>
                  <ChevronRight size={13} />
                </button>
              ))}
            <p className="panel-note">
              Births, aging, and mortality respond to each community's living conditions. Migration follows
              opportunity, safety, diaspora networks, and shipping links. Soldiers remain in the census.
            </p>
          </>
        )}
        {tab === 'economy' && (
          <>
            <div className="metrics-grid">
              <Metric icon={Factory} label="Monthly GDP" value={money(n.gdp)} />
              <Metric icon={Coins} label="Treasury" value={money(n.treasury)} />
            </div>
            <div className="data-row">
              <span>Tax revenue / month</span>
              <b className="positive">+{money(n.income)}</b>
            </div>
            <div className="data-row">
              <span>Spending / month</span>
              <b>−{money(n.spending)}</b>
            </div>
            <div className="data-row">
              <span>Public debt</span>
              <b className={n.debt > 0 ? 'negative' : ''}>{money(n.debt)}</b>
            </div>
            <MacroAccounts world={w} nation={n.id} />
            <SectionTitle aside={<span className="subtle">tonnes / month</span>}>Goods ledger</SectionTitle>
            <table className="goods-table">
              <thead>
                <tr>
                  <th>Good</th>
                  <th>Made</th>
                  <th>Used</th>
                  <th>Stored</th>
                </tr>
              </thead>
              <tbody>
                {GOODS.map((g) => {
                  const Icon = goodIcons[g]
                  return (
                    <tr key={g}>
                      <th>
                        <Icon size={12} />
                        {title(g)}
                      </th>
                      <td>{compact(regions.reduce((s, r) => s + r.production[g], 0))}</td>
                      <td>{compact(regions.reduce((s, r) => s + r.consumption[g], 0))}</td>
                      <td>{compact(regions.reduce((s, r) => s + r.stocks[g], 0))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <SectionTitle>Production priority</SectionTitle>
            <select
              aria-label="Production priority"
              value={n.policies.priority}
              onChange={(e) => policy('priority', e.target.value as Policies['priority'])}
            >
              <option value="balanced">Balanced economy</option>
              <option value="agriculture">Agriculture and food security</option>
              <option value="industry">Industrial production</option>
              <option value="military">Military equipment</option>
            </select>
            <SectionTitle aside={<Route size={14} />}>Shipments this month</SectionTitle>
            {w.routes
              .filter((route) => w.regions[route.from].nation === n.id || w.regions[route.to].nation === n.id)
              .sort((a, b) => b.volume - a.volume)
              .slice(0, 8)
              .map((route) => {
                const distance = routeDistance(w, route),
                  harbors = route.legs
                    ?.filter((leg) => leg.mode === 'sea')
                    .flatMap((leg) =>
                      [leg.cells[0], leg.cells[leg.cells.length - 1]].map(
                        (id) => w.regions[w.cells[id].region].name,
                      ),
                    ),
                  cargo = GOODS.filter((g) => route.goods[g] > 0).sort(
                    (a, b) => route.goods[b] - route.goods[a],
                  )
                return (
                  <div className="route-row" key={route.id}>
                    <div>
                      <span>{w.regions[route.from].name}</span>
                      <ArrowRight size={11} />
                      <span>{w.regions[route.to].name}</span>
                    </div>
                    <small>
                      {route.sea
                        ? route.legs?.some((leg) => leg.mode === 'land')
                          ? 'Road + sea'
                          : 'Sea'
                        : 'Road'}{' '}
                      ·{' '}
                      {distance === undefined
                        ? 'Route refresh pending'
                        : `${Math.round(distance).toLocaleString()} km`}{' '}
                      · {route.international ? 'International' : 'Domestic'}
                    </small>
                    <small className="route-cargo">
                      {cargo.map((g) => `${g} ${compact(route.goods[g])} t`).join(' · ')}
                    </small>
                    {!!harbors?.length && <small>Harbors: {[...new Set(harbors)].join(' → ')}</small>}
                    <b>{compact(route.volume)} t</b>
                  </div>
                )
              })}
            {!w.routes.some(
              (route) => w.regions[route.from].nation === n.id || w.regions[route.to].nation === n.id,
            ) && (
              <p className="empty-state">
                No shipments this month. Trade begins when reachable provinces have complementary surpluses
                and shortages.
              </p>
            )}
            <p className="panel-note">
              Successful deliveries draw trade into shared corridors. Terrain and congestion limit their
              advantage; unused paths gradually fade. Adopted tile paths hold for at least a year, and better
              suppliers gain traffic slowly. War, unavailable supply, and urgent food needs override supplier
              inertia. Select a province to highlight its imports and exports.
            </p>
          </>
        )}
        {tab === 'government' && (
          <>
            <div className="government-status">
              <Landmark size={19} />
              <div>
                <strong>{n.ai ? 'Autonomous government' : 'Your government'}</strong>
                <span>
                  {n.ai ? 'The state chooses its own priorities.' : 'Policies stay under your control.'}
                </span>
              </div>
            </div>
            <button
              className="button full"
              onClick={() => command({ type: 'control', nation: n.ai ? n.id : null })}
            >
              {n.ai ? 'Take control of this state' : 'Return all states to autonomy'}
              <ArrowUpRight size={14} />
            </button>
            <StateCharacter world={w} nation={n} />
            <StateSecurity world={w} nation={n.id} onFocus={onFocus} />
            <SectionTitle>Taxation & borders</SectionTitle>
            <PolicySlider
              name="Tax rate"
              description="Higher revenue reduces household contentment."
              value={n.policies.tax}
              min={5}
              max={55}
              onChange={(v) => policy('tax', v)}
            />
            <PolicySlider
              name="Import tariff"
              description="Trade agreements waive tariff friction."
              value={n.policies.tariff}
              max={40}
              onChange={(v) => policy('tariff', v)}
            />
            <label className="select-label">
              Migration policy
              <select
                value={n.policies.migration}
                onChange={(e) => policy('migration', e.target.value as Policies['migration'])}
              >
                <option value="open">Open borders</option>
                <option value="controlled">Controlled migration</option>
                <option value="closed">Closed borders</option>
              </select>
            </label>
            <SectionTitle>Citizenship, language &amp; belief</SectionTitle>
            <label className="select-label">
              Citizenship
              <select
                value={n.policies.citizenship ?? 'civic'}
                onChange={(e) => policy('citizenship', e.target.value as Policies['citizenship'])}
              >
                <option value="civic">Shared civic citizenship</option>
                <option value="pluralist">Protected cultural pluralism</option>
                <option value="heritage">Heritage privileges</option>
              </select>
            </label>
            <label className="select-label">
              Language in public education
              <select
                value={n.policies.languagePolicy ?? 'multilingual'}
                onChange={(e) => policy('languagePolicy', e.target.value as Policies['languagePolicy'])}
              >
                <option value="multilingual">Multilingual education</option>
                <option value="local">Local language continuity</option>
                <option value="common">Common state language</option>
              </select>
            </label>
            <label className="select-label">
              Freedom of belief
              <select
                value={n.policies.beliefPolicy ?? 'protected'}
                onChange={(e) => policy('beliefPolicy', e.target.value as Policies['beliefPolicy'])}
              >
                <option value="protected">Protect all traditions</option>
                <option value="favored">Favor the state tradition</option>
                <option value="restricted">Restrict other traditions</option>
              </select>
            </label>
            {(['culture', 'language', 'belief'] as const).map((key) => (
              <label className="select-label" key={key}>
                {key === 'culture'
                  ? 'Recognized cultural tradition'
                  : key === 'language'
                    ? 'Shared state language'
                    : 'Recognized belief tradition'}
                <select
                  value={n.identity?.[key] ?? ''}
                  onChange={(e) =>
                    command({ type: 'identity-policy', nation: n.id, key, identity: Number(e.target.value) })
                  }
                >
                  {(w.demography?.identities ?? [])
                    .filter((identity) => identity.kind === key)
                    .map((identity) => (
                      <option key={identity.id} value={identity.id}>
                        {identity.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            <p className="panel-note">
              Recognition changes institutions. Adoption takes time. Exclusion affects access to services,
              loyalty, and migration; a shared language can spread without replacing people's mother tongue.
            </p>
            <SectionTitle>Allocate the public budget</SectionTitle>
            <p className="panel-note">
              Weights divide the available budget. Administration and infrastructure retain fixed weights of
              12 and 18.
            </p>
            {(['welfare', 'education', 'military', 'research'] as const).map((k) => (
              <PolicySlider
                key={k}
                name={title(k)}
                description={`${money(n.budget[k])} crowns allocated this month`}
                value={n.policies[k]}
                suffix=" wt"
                onChange={(v) => policy(k, v)}
              />
            ))}
            <PolicySlider
              name="Conscription"
              description="Expands recruitment, with a cost to public contentment."
              value={n.policies.conscription}
              max={5}
              onChange={(v) => policy('conscription', v)}
            />
            <p className="panel-note">
              Changing a policy switches this state to manual government. Effects are applied on the next
              monthly tick.
            </p>
          </>
        )}
        {tab === 'research' && (
          <>
            <div className="panel-intro">
              <FlaskConical size={23} />
              <p>Ideas change what a society can produce, sustain, and defend.</p>
            </div>
            <div className="data-row">
              <span>Research spending</span>
              <b>{money(n.budget.research)} / mo</b>
            </div>
            <div className="data-row">
              <span>Population literacy</span>
              <b>{percent(avg('literacy'))}</b>
            </div>
            <SectionTitle>Choose a research focus</SectionTitle>
            {FIELDS.map((field) => (
              <ResearchRow
                key={field}
                field={field}
                nation={n}
                onChoose={() => command({ type: 'research', nation: n.id, field })}
              />
            ))}
            <p className="panel-note">
              Research uses public funding and literacy. Each field contains six discoveries. Completed levels
              improve actual model coefficients; changing focus preserves accumulated work.
            </p>
          </>
        )}
        {tab === 'diplomacy' && (
          <>
            <IntelligenceOffice key={n.id} world={w} nation={n.id} onCommand={command} />
            <DiplomaticChancery world={w} nation={n.id} status={agentStatus} onReview={onStrategy} />
            <p className="panel-note">
              Commerce builds trust. Expansionist governments weigh border opportunities; prolonged wars
              create pressure for peace.
            </p>
            <div className="diplomacy-list">
              {rels.map((rel) => {
                const other = w.nations[rel.a === n.id ? rel.b : rel.a]
                if (!other.population) return null
                return (
                  <button
                    key={other.id}
                    className={`diplomacy-row ${target?.id === other.id ? 'active' : ''}`}
                    onClick={() => setDiplomat(other.id)}
                  >
                    <FlagMark nation={other} small />
                    <span>
                      <strong>{other.shortName}</strong>
                      <small>{title(rel.treaty)}</small>
                    </span>
                    <b className={rel.opinion > 0 ? 'positive' : rel.opinion < -20 ? 'negative' : ''}>
                      {rel.opinion >= 0 ? '+' : ''}
                      {Math.round(rel.opinion)}
                    </b>
                    <ChevronRight size={13} />
                  </button>
                )
              })}
            </div>
            {target && targetRel ? (
              <div className="diplomacy-actions">
                <SectionTitle>{target.shortName}</SectionTitle>
                <div className="data-row">
                  <span>Relations</span>
                  <b>{Math.round(targetRel.opinion)}</b>
                </div>
                {targetRel.treaty === 'war' && (
                  <div className="data-row">
                    <span>War exhaustion</span>
                    <b>{Math.round(targetRel.warExhaustion)}</b>
                  </div>
                )}
                <button
                  className="button full"
                  onClick={() =>
                    command({ type: 'diplomacy', nation: n.id, target: target.id, action: 'improve' })
                  }
                >
                  <Handshake size={14} />
                  Diplomatic mission<span>150k</span>
                </button>
                <div className="action-grid">
                  <button
                    className="button"
                    onClick={() =>
                      command({ type: 'diplomacy', nation: n.id, target: target.id, action: 'trade' })
                    }
                  >
                    Propose trade
                  </button>
                  <button
                    className="button"
                    onClick={() =>
                      command({ type: 'diplomacy', nation: n.id, target: target.id, action: 'alliance' })
                    }
                  >
                    Propose alliance
                  </button>
                </div>
                <button
                  className={`button full ${targetRel.treaty !== 'war' ? 'danger' : ''}`}
                  onClick={() =>
                    command({
                      type: 'diplomacy',
                      nation: n.id,
                      target: target.id,
                      action: targetRel.treaty === 'war' ? 'peace' : 'war',
                    })
                  }
                >
                  <Swords size={14} />
                  {targetRel.treaty === 'war' ? 'Propose an armistice' : 'Declare war'}
                </button>
                {['trade', 'alliance'].includes(targetRel.treaty) && (
                  <button
                    className="text-button"
                    onClick={() =>
                      command({ type: 'diplomacy', nation: n.id, target: target.id, action: 'embargo' })
                    }
                  >
                    Revoke preferential access
                  </button>
                )}
                <button className="text-button" onClick={() => onNation(target.id)}>
                  Inspect {target.shortName}
                  <ArrowUpRight size={12} />
                </button>
              </div>
            ) : (
              <div className="empty-state">
                <Handshake size={21} />
                <p>Select a state to send envoys, negotiate agreements, or declare war.</p>
              </div>
            )}
            <p className="panel-note">
              Trade accords require +10 relations; alliances require +45. Alliances grant military access.
              Armistices prevent renewed war for five years.
            </p>
          </>
        )}
        {tab === 'military' && (
          <>
            <div className="metrics-grid">
              <Metric icon={Shield} label="Active soldiers" value={compact(soldiers)} />
              <Metric icon={Users} label="Recruitable pool" value={compact(n.manpower)} />
            </div>
            <div className="data-row">
              <span>Total military casualties</span>
              <b>{compact(n.casualties)}</b>
            </div>
            {orderedArmy !== null && (
              <div className="order-prompt">
                <MapPin size={16} />
                <p>Select a province on the map to issue a march order.</p>
                <button aria-label="Cancel march order" className="icon-button" onClick={() => onArmy(null)}>
                  <X size={15} />
                </button>
              </div>
            )}
            <StateSecurity world={w} nation={n.id} onFocus={onFocus} />
            <SectionTitle>Field armies</SectionTitle>
            {armies.map((a) => (
              <div className="army-row" key={a.id}>
                <div>
                  <Shield size={16} />
                  <strong>{a.name}</strong>
                  <b>{compact(a.soldiers)}</b>
                </div>
                <button className="text-button" onClick={() => onFocus(a.region)}>
                  <MapPin size={11} />
                  {w.regions[a.region].name}
                  {a.target !== null && ` → ${w.regions[a.target].name}`}
                </button>
                <Meter label="Supply" value={a.supply} />
                <Meter label="Morale" value={a.morale} color="#8ea6b5" />
                <ArmyLogistics world={w} army={a} command={command} />
                <button
                  className={`button full ${orderedArmy === a.id ? 'primary' : ''}`}
                  disabled={a.operations?.embarkedOn != null}
                  onClick={() => onArmy(orderedArmy === a.id ? null : a.id)}
                >
                  <Flag size={13} />
                  Issue march order
                  <ArrowRight size={13} />
                </button>
              </div>
            ))}
            {!armies.length && (
              <p className="empty-state">No field armies. Recruit a corps to defend this state.</p>
            )}
            <button
              className="button primary full"
              onClick={() =>
                command({ type: 'recruit', nation: n.id, region: r?.nation === n.id ? r.id : n.capital })
              }
            >
              <Shield size={14} />
              Recruit a corps
            </button>
            <p className="panel-note">
              Up to 3,000 adults are recruited locally. Each recruit costs 200 crowns and 12 kg of arms.
              Armies consume food and equipment; terrain, supply, morale, and technology determine battles.
            </p>
            <NavalForces world={w} nation={n.id} command={command} />
          </>
        )}
        {tab === 'chronicle' && (
          <>
            <HistoricalForces world={w} nation={n.id} />
            <div className="chronicle-filter">
              <button className={eventFilter === 'all' ? 'active' : ''} onClick={() => setEventFilter('all')}>
                World
              </button>
              <button
                className={eventFilter === 'state' ? 'active' : ''}
                onClick={() => setEventFilter('state')}
              >
                {n.shortName}
              </button>
            </div>
            {w.events
              .filter((e) => eventFilter === 'all' || e.nation === n.id)
              .map((e) => (
                <article className={`chronicle-entry ${e.type}`} key={e.id} id={`history-event-${e.id}`}>
                  <div>
                    <span className="event-mark" />
                    <time>{dateLabel({ month: e.month, startYear: w.startYear })}</time>
                    <span>{title(e.historical?.category ?? e.type)}</span>
                  </div>
                  <h4>{e.title}</h4>
                  <p>
                    {e.historical && e.detail.length > 520
                      ? `${e.detail.slice(0, 500).replace(/\s+\S*$/, '')}…`
                      : e.detail}
                  </p>
                  <HistoricalConsequences
                    event={e}
                    world={w}
                    onExpand={onEventDetails}
                    pending={pendingDetails.includes(e.id)}
                  />
                  {e.region !== undefined && (
                    <button
                      className="text-button"
                      onClick={() => {
                        onFocus(e.region!)
                        onRegion(e.region!)
                        onTab('atlas')
                      }}
                    >
                      Go to province
                      <ArrowUpRight size={11} />
                    </button>
                  )}
                </article>
              ))}
            {!w.events.some((e) => eventFilter === 'all' || e.nation === n.id) && (
              <p className="empty-state">No events recorded for this state yet.</p>
            )}
          </>
        )}
      </div>
      <div className="inspector-footer">
        <span className="status-dot" />
        <span>Monthly simulation</span>
        <span>Seeded & reproducible</span>
      </div>
    </aside>
  )
}

function ResearchRow({
  field,
  nation: n,
  onChoose,
}: {
  field: Research
  nation: Nation
  onChoose: () => void
}) {
  const icons = {
      agriculture: Sprout,
      industry: Factory,
      medicine: Heart,
      logistics: Route,
      military: Shield,
      governance: Landmark,
    },
    Icon = icons[field]
  const level = n.technologies[field],
    active = n.researchFocus === field,
    fraction = level >= 6 ? 1 : n.researchProgress[field] / researchCost(level)
  const effects = {
    agriculture: '+19% farm productivity per level',
    industry: '+13% production efficiency per level',
    medicine: '+5 points to health target per level',
    logistics: '+25% road capacity per level',
    military: '+16% combat effectiveness per level',
    governance: 'Better tax collection, education, and research',
  }
  return (
    <button className={`research-row ${active ? 'active' : ''}`} onClick={onChoose} disabled={level >= 6}>
      <Icon size={19} />
      <span>
        <small>
          {title(field)}
          <b>Level {level} / 6</b>
        </small>
        <strong>{TECH_NAMES[field][level] ?? 'All discoveries complete'}</strong>
        <em>{effects[field]}</em>
        <span className="meter-track">
          <span style={{ width: `${fraction * 100}%` }} />
        </span>
        <small>
          {level >= 6
            ? 'Complete'
            : `${Math.round(n.researchProgress[field])} / ${Math.round(researchCost(level))} knowledge`}
          {active && level < 6 ? <b>Researching</b> : null}
        </small>
      </span>
    </button>
  )
}

function Province({
  region: r,
  world,
  command,
  onClose,
  onFocus,
}: {
  region: Region
  world: World
  command: (c: Command) => void
  onClose: () => void
  onFocus: (id: number) => void
}) {
  return (
    <>
      <div className="province-title">
        <div>
          <h3>{r.name}</h3>
          <span>
            {title(r.terrain)}
            {r.coastal ? ' · Coastal area' : ' · Inland area'}
          </span>
        </div>
        <button className="icon-button" aria-label="Close province details" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div className="metrics-grid">
        <Metric icon={Users} label="Population" value={compact(population(r))} />
        <Metric icon={Factory} label="Output / month" value={money(r.gdp)} />
      </div>
      <div className="data-row">
        <span>Settlements</span>
        <b>
          {spatialState(world).settlements.filter((s) => s.region === r.id).length || 'Dispersed countryside'}
        </b>
      </div>
      <div className="data-row">
        <span>Local markets</span>
        <b>{spatialState(world).districts.filter((d) => d.region === r.id).length}</b>
      </div>
      {world.adaptive && <details className="district-economies">
        <summary>Current administration</summary>
        <p className="panel-note">Municipal and provincial borders evolve independently. The figures below describe this established statistical area.</p>
        {Object.values(world.adaptive.jurisdictions).filter((j) => j.retired === undefined && j.cells.some((c) => r.cells.includes(c))).map((j) => <div className="data-row" key={j.id}><span>{j.level === 'municipality' ? 'Municipality' : 'Province'}</span><b>{j.name}</b></div>)}
      </details>}
      <DistrictEconomies world={world} province={r.id} />
      <Meter label="Food needs met" value={r.foodCoverage} />
      <Meter label="Other needs met" value={r.materialCoverage ?? 1} />
      <Meter label="Public health" value={r.health} />
      <Meter label="Literacy" value={r.literacy} />
      <Meter label="Infrastructure" value={r.infrastructure / 1.5} text={percent(r.infrastructure)} />
      <Meter label="Unrest" value={r.unrest / 100} text={`${Math.round(r.unrest)} / 100`} color="#b78376" />
      <div className="data-row">
        <span>Net migration / month</span>
        <b>{signed(r.migration)}</b>
      </div>
      <div className="data-row">
        <span>{world.localEconomy ? 'Administrative depot food' : 'Food reserves'}</span>
        <b>{(r.stocks.food / Math.max(1, population(r) * 0.025)).toFixed(1)} months</b>
      </div>
      <PopulationIdentities world={world} nation={r.nation} region={r.id} />
      <SectionTitle>Develop this province</SectionTitle>
      <div className="development-list">
        {(
          [
            { id: 'farm', label: 'Improve farmland', cost: '450k', icon: Wheat },
            { id: 'industry', label: 'Expand industry', cost: '900k', icon: Factory },
            { id: 'road', label: 'Build roads', cost: '600k', icon: Building2 },
            { id: 'school', label: 'Fund a school', cost: '500k', icon: BookOpen },
          ] as const
        ).map((item) => (
          <button key={item.id} onClick={() => command({ type: 'build', region: r.id, building: item.id })}>
            <item.icon size={15} />
            <span>{item.label}</span>
            <b>{item.cost}</b>
            <ChevronRight size={12} />
          </button>
        ))}
      </div>
      <p className="panel-note">
        Each investment also uses 50 t of timber and 70 t of stone from local reserves.
      </p>
      <details className="sandbox-tools">
        <summary>
          <SlidersHorizontal size={14} />
          Sandbox interventions
        </summary>
        <p>Introduce a local shock and observe its consequences.</p>
        <div className="action-grid">
          <button
            className="button"
            onClick={() => command({ type: 'disaster', region: r.id, disaster: 'drought' })}
          >
            Drought
          </button>
          <button
            className="button"
            onClick={() => command({ type: 'disaster', region: r.id, disaster: 'epidemic' })}
          >
            Epidemic
          </button>
        </div>
        <button
          className="button full"
          onClick={() => command({ type: 'disaster', region: r.id, disaster: 'abundance' })}
        >
          Bumper harvest
        </button>
      </details>
      <button className="text-button" onClick={() => onFocus(r.id)}>
        <MapPin size={13} />
        Center on {r.name}
      </button>
    </>
  )
}
