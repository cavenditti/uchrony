/** Resource selection lives with its units and colour key, always visible on the map. */
import { NATURAL_RESOURCES, type NaturalResource } from '../sim/landscape'
import {
  RESOURCE_KEYS,
  RESOURCE_ZERO_COLOR,
  resourceQuantity,
  type ResourceMapData,
} from '../map/natural-resources'

/** The map key stays operable above the canvas on desktop, touch and keyboard. */
export function ResourceLegend({
  data,
  onResource,
}: {
  data: ResourceMapData
  onResource: (good: NaturalResource) => void
}) {
  return (
    <div className="quantitative-legend resource-legend">
      <label>
        Natural resource
        <select
          aria-label="Natural resource"
          value={data.good}
          onChange={(e) => onResource(e.target.value as NaturalResource)}
        >
          {NATURAL_RESOURCES.map((good) => (
            <option key={good} value={good}>
              {RESOURCE_KEYS[good].name}
            </option>
          ))}
        </select>
      </label>
      <span>Remaining tonnes / terrain tile · log scale</span>
      <div
        className="legend-ramp"
        style={{
          background: `linear-gradient(to right, ${RESOURCE_ZERO_COLOR}, ${RESOURCE_KEYS[data.good].color})`,
        }}
      />
      <div className="legend-ticks">
        {[0, data.midpoint, data.maximum].map((value, i) => (
          <span key={i}>{resourceQuantity(value)}</span>
        ))}
      </div>
      <span>
        {data.maximum === 0
          ? 'No deposits in this world.'
          : !data.available
            ? 'No remaining reserves.'
            : data.good === 'timber'
              ? 'Standing timber can regrow.'
              : 'Finite reserves · extraction depletes deposits.'}
      </span>
    </div>
  )
}
