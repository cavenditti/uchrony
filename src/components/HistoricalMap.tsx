/** The historical map draws only archived provinces and values over immutable geography. */
import { useMemo, useState } from 'react'
import { Plus, Minus, Maximize2 } from 'lucide-react'
import { buildGeometry } from '../map/geometry'
import { CELL_SIZE } from '../sim/grid'
import type { World } from '../sim/types'
import type { ArchiveResult } from '../sim/world-archive'
import { historicalMapColors, historicalMapScale, type HistoricalLayer } from '../sim/archive-presentation'
export function HistoricalMap({
  world,
  result,
  layer,
  selected,
  members,
  comparison,
  onSelect,
}: {
  world: World
  result: ArchiveResult
  layer: HistoricalLayer
  selected: number | null
  members?: number[]
  comparison?: ArchiveResult
  onSelect: (id: number) => void
}) {
  const geometry = useMemo(
    () => buildGeometry(world.cells, world.width, world.height, world.regions.length),
    [world.cells, world.width, world.height, world.regions.length],
  )
  const paths = useMemo(
    () =>
      geometry.provinces.map((rings) =>
        rings.map((ring) => ring.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + 'Z').join(' '),
      ),
    [geometry],
  )
  const colors = useMemo(() => historicalMapColors(result, layer), [result, layer])
  const scale = useMemo(() => historicalMapScale(result, layer), [result, layer])
  const [zoom, setZoom] = useState(1)
  const width = world.width * CELL_SIZE,
    height = world.height * CELL_SIZE
  const center = selected === null ? undefined : world.cells[world.regions[selected]?.center]
  const x = center?.x ?? width / 2,
    y = center?.y ?? height / 2
  return (
    <div className="historical-map">
      <svg
        role="group"
        aria-label="Historical political map. Select a province to inspect its state."
        viewBox={`${x - width / zoom / 2} ${y - height / zoom / 2} ${width / zoom} ${height / zoom}`}
      >
        {result.provinces.map((p) => {
          const n = result.nations[p.nation],
            changed = comparison && comparison.provinces[p.id]?.nation !== p.nation
          return (
            <path
              key={p.id}
              d={paths[p.id]}
              fill={colors[p.id]}
              fillRule="evenodd"
              stroke={selected === p.id ? '#e6e7dd' : changed ? '#d7b77a' : '#354449'}
              strokeWidth={selected === p.id || changed ? 2 : 0.65}
              vectorEffect="non-scaling-stroke"
              opacity={members && !members.includes(p.nation) ? 0.25 : 1}
              role="button"
              tabIndex={0}
              aria-label={`${p.name}, ${n?.name ?? 'unclaimed land'}${changed ? ', changed sovereignty' : ''}`}
              aria-pressed={selected === p.id}
              onClick={() => onSelect(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(p.id)
                }
              }}
            >
              <title>
                {p.name} · {n?.name ?? 'Unclaimed land'}
              </title>
            </path>
          )
        })}
      </svg>
      <div className="historical-map-controls">
        <button
          className="icon-button"
          aria-label="Zoom historical map in"
          disabled={zoom >= 8}
          onClick={() => setZoom((z) => Math.min(8, z * 1.5))}
        >
          <Plus size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="Zoom historical map out"
          disabled={zoom <= 1}
          onClick={() => setZoom((z) => Math.max(1, z / 1.5))}
        >
          <Minus size={18} />
        </button>
        <button className="icon-button" aria-label="Fit historical map" onClick={() => setZoom(1)}>
          <Maximize2 size={18} />
        </button>
      </div>
      <div className="historical-map-key">
        {layer === 'political'
          ? 'Colors identify sovereign states.'
          : layer === 'wars'
            ? 'Clay: states at war. Slate: states at peace.'
            : `National ${layer} · lighter means more.`}
        {members && ' Institution members highlighted.'}
        {comparison && ' Brass borders mark changed sovereignty.'}
        {scale && (
          <div className="historical-map-scale" role="group" aria-label={`${scale.label} legend`}>
            <span>{scale.unit}</span>
            {!scale.ticks.length ? (
              <span>No observations at this date.</span>
            ) : (
              <>
                <div
                  className="historical-map-ramp"
                  aria-hidden="true"
                  style={{
                    background: scale.constant
                      ? scale.ticks[0].color
                      : `linear-gradient(to right, ${scale.ticks.map((t) => t.color).join(', ')})`,
                  }}
                />
                <div className="historical-map-ticks">
                  {scale.ticks.map((tick, i) => (
                    <span key={i}>
                      {tick.value.toLocaleString(undefined, {
                        maximumFractionDigits: layer === 'population' ? 0 : 2,
                      })}
                    </span>
                  ))}
                </div>
                {scale.constant && <span>Same recorded value for every state.</span>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
