import { useEffect, useState } from 'react'
import { X, RefreshCw, Play, Pause } from 'lucide-react'
import type { InspectionSnapshot } from '../sim/inspection'
import { UrbanCharacter } from './UrbanCharacter'

export function LocalInspection({
  snapshot,
  currentMonth,
  onClose,
  onRefresh,
}: {
  snapshot: InspectionSnapshot
  currentMonth: number
  onClose: () => void
  onRefresh: () => void
}) {
  const [hour, setHour] = useState(9),
    [selected, setSelected] = useState<string | null>(null),
    [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      if (!document.hidden) setHour((value) => (value + 1 / 60) % 24)
    }, 100)
    return () => clearInterval(timer)
  }, [playing])
  const routine = snapshot.routines.find((r) => r.id === selected) ?? snapshot.routines[0]
  const sites = new Map(snapshot.sites.map((s) => [s.id, s]))
  const b = snapshot.bounds,
    coordinate = (n: number, origin: number) => ((n - origin) / b.size) * 100
  const atTime = (r: InspectionSnapshot['routines'][number]) => {
    const journey = r.journeys?.find((j) => hour >= j.start && hour < j.end)
    if (!journey) return null
    const lengths = journey.points
      .slice(1)
      .map((p, i) => Math.hypot(p.x - journey.points[i].x, p.y - journey.points[i].y))
    let distance =
      (lengths.reduce((sum, value) => sum + value, 0) * (hour - journey.start)) /
      (journey.end - journey.start)
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i] && lengths[i] > 0) {
        const a = journey.points[i],
          z = journey.points[i + 1],
          fraction = distance / lengths[i]
        return { x: a.x + (z.x - a.x) * fraction, y: a.y + (z.y - a.y) * fraction }
      }
      distance -= lengths[i]
    }
    return journey.points.at(-1)
  }
  return (
    <aside className="local-inspection" aria-label="Local daily life">
      <div className="local-inspection-heading">
        <h2>Local daily life</h2>
        <button className="icon-button" aria-label="Close local inspection" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p>
        {Math.round(snapshot.population).toLocaleString()} residents ·{' '}
        {Math.round(snapshot.representedWorkers).toLocaleString()} enterprise jobs
      </p>
      <p>
        {snapshot.jurisdictions
          .filter((j) => j.level === 'municipality')
          .map((j) => j.name)
          .join(' · ')}
      </p>
      {snapshot.urban && <UrbanCharacter character={snapshot.urban} />}
      <svg
        className="local-inspection-map"
        viewBox="0 0 100 100"
        role="img"
        aria-label="Recorded homes, workplaces, and representative daily movements"
      >
        {snapshot.nodes.map((n) => (
          <rect
            key={n.id}
            x={coordinate(n.bounds.x, b.x)}
            y={coordinate(n.bounds.y, b.y)}
            width={(n.bounds.size / b.size) * 100}
            height={(n.bounds.size / b.size) * 100}
            fill="none"
            stroke="currentColor"
            opacity={0.12}
            strokeWidth={0.2}
          />
        ))}
        {snapshot.sites.map((s) => (
          <rect
            key={s.id}
            x={coordinate(s.x, b.x) - (s.kind === 'establishment' ? 1.25 : 0.7)}
            y={coordinate(s.y, b.y) - (s.kind === 'establishment' ? 1.25 : 0.7)}
            width={s.kind === 'establishment' ? 2.5 : 1.4}
            height={s.kind === 'establishment' ? 2.5 : 1.4}
            fill={s.kind === 'establishment' ? 'var(--accent)' : 'currentColor'}
            opacity={0.7}
          >
            <title>
              {s.kind} · {Math.round(s.capacity)} capacity · {Math.round(s.jobs)} jobs
            </title>
          </rect>
        ))}
        {routine?.journeys?.slice(0, 1).map((journey) => (
          <polyline
            key={routine.id}
            points={journey.points.map((p) => `${coordinate(p.x, b.x)},${coordinate(p.y, b.y)}`).join(' ')}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="0.5"
            opacity="0.6"
          />
        ))}
        {snapshot.routines.map((r) => {
          const activity = [...r.activities].reverse().find((a) => a.hour <= hour) ?? r.activities[0]
          const site = atTime(r) ?? sites.get(activity.site) ?? sites.get(r.home)
          return (
            site && (
              <circle
                key={r.id}
                cx={coordinate(site.x, b.x)}
                cy={coordinate(site.y, b.y)}
                r={r.id === routine?.id ? 1.3 : 0.6}
                fill="var(--accent)"
              >
                <title>
                  {activity.label} · represents {Math.round(r.weight)} people
                </title>
              </circle>
            )
          )
        })}
      </svg>
      <label>
        Representative day · {String(Math.floor(hour)).padStart(2, '0')}:
        {String(Math.floor((hour % 1) * 60 + 1e-6)).padStart(2, '0')}
        <input
          type="range"
          min="0"
          max={24 - 1 / 60}
          step={1 / 60}
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
        />
      </label>
      <button onClick={() => setPlaying((value) => !value)}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
        {playing ? 'Pause this day' : 'Play this day'}
      </button>
      <label>
        Representative resident
        <select value={routine?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
          {snapshot.routines.map((r, i) => (
            <option key={r.id} value={r.id}>
              {i + 1}. {r.stratum} · {r.workplace ? 'employed' : 'other daily activity'} ·{' '}
              {Math.round(r.weight)} people
            </option>
          ))}
        </select>
      </label>
      {routine && (
        <>
          <p>
            {routine.age} years · {routine.sex} · represents {Math.round(routine.weight).toLocaleString()}{' '}
            people
          </p>
          <ol>
            {routine.activities.map((a, i) => (
              <li key={i}>
                {String(Math.floor(a.hour)).padStart(2, '0')}:
                {String(Math.floor((a.hour % 1) * 60 + 1e-6)).padStart(2, '0')} — {a.label}
              </li>
            ))}
          </ol>
        </>
      )}
      <p>
        Conditional examples from month {snapshot.month}. These are representative residents, not persistent
        individuals. Inspecting this day does not advance the economy.
      </p>
      {snapshot.sampled && (
        <p>
          Site geometry is sampled; routine destinations may extend outside this area. Population and job
          totals include every site in the area.
        </p>
      )}
      {snapshot.routines.reduce((sum, r) => sum + r.weight, 0) < snapshot.population - 1 && (
        <p>Daily routines cover a sample of homes. Area totals include the remaining residents.</p>
      )}
      <button aria-label="Refresh local inspection" onClick={onRefresh}>
        <RefreshCw size={15} />
        {currentMonth !== snapshot.month ? `Refresh to month ${currentMonth}` : 'Refresh this area'}
      </button>
    </aside>
  )
}
