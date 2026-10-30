/** Resource selection lives with its units and colour key, always visible on the map. */
import {
  MAPPED_RESOURCES,
  RESOURCE_KEYS,
  RESOURCE_ZERO_COLOR,
  RESOURCE_WATER_ZERO_COLOR,
  resourceQuantity,
  type MappedResource,
  type ResourceMapData,
} from '../map/natural-resources'

/** Empty geography, depletion and biological renewal describe different states. */
function resourceStatus(data: ResourceMapData) {
  const fish = data.good === 'fish'
  if (!data.maximum) return fish ? 'No coastal fish stocks in this world.' : 'No deposits in this world.'
  if (!data.available) return fish ? 'No remaining fish stocks.' : 'No remaining reserves.'
  if (fish) return 'Shared coastal stocks can recover; catches are limited.'
  return data.good === 'timber'
    ? 'Standing timber can regrow.'
    : 'Finite reserves · extraction depletes deposits.'
}

/** The map key stays operable above the canvas on desktop, touch and keyboard. */
export function ResourceLegend({
  data,
  onResource,
}: {
  data: ResourceMapData
  onResource: (good: MappedResource) => void
}) {
  return (
    <div className="quantitative-legend resource-legend" role="group" aria-label="Natural resource map key">
      <label>
        Natural resource
        <select
          aria-label="Natural resource"
          value={data.good}
          onChange={(e) => onResource(e.target.value as MappedResource)}
        >
          {MAPPED_RESOURCES.map((good) => (
            <option key={good} value={good}>
              {RESOURCE_KEYS[good].name}
            </option>
          ))}
        </select>
      </label>
      <span>
        {data.good === 'fish' ? 'Fish biomass (t) / water tile' : 'Remaining tonnes / terrain tile'} · log
        scale
      </span>
      <div
        className="legend-ramp"
        style={{
          background: `linear-gradient(to right, ${data.good === 'fish' ? RESOURCE_WATER_ZERO_COLOR : RESOURCE_ZERO_COLOR}, ${RESOURCE_KEYS[data.good].color})`,
        }}
      />
      <div className="legend-ticks">
        {[0, data.midpoint, data.maximum].map((value, i) => (
          <span key={i}>{resourceQuantity(value)}</span>
        ))}
      </div>
      <span>{resourceStatus(data)}</span>
    </div>
  )
}

/** A shared readout keeps clicked land and water tiles explicit about ownership:
 * fish biomass is a natural shared stock, not a market's owned cargo. */
export function ResourceTileDetails({
  data,
  tile,
}: {
  data: ResourceMapData
  tile: { cell: number; quantity: number }
}) {
  return (
    <div className="picked-cell">
      <strong>
        {RESOURCE_KEYS[data.good].name} · {resourceQuantity(tile.quantity)} remaining
      </strong>
      <span>
        {data.good === 'fish' ? 'Water' : 'Terrain'} tile {tile.cell} ·{' '}
        {data.good === 'fish'
          ? 'Shared coastal biomass'
          : data.good === 'timber'
            ? 'Standing timber'
            : 'Unextracted reserve'}
      </span>
    </div>
  )
}
