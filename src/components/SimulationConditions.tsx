import { useId } from 'react'
import { ParameterLabel } from './ParameterHelp'
import { configurationHelp } from '../sim/configuration-help'
import type { SimulationSettings } from '../sim/settings'

export function SimulationConditions({
  value,
  onChange,
}: {
  value: SimulationSettings
  onChange: (value: SimulationSettings) => void
}) {
  const prefix = useId()
  const change = (key: keyof SimulationSettings, number: number) => onChange({ ...value, [key]: number })
  return (
    <div className="simulation-conditions">
      <div className="select-label">
        <ParameterLabel htmlFor={`${prefix}-instability`} label="Destabilizing pressures">
          {configurationHelp('conditions.instability')}
        </ParameterLabel>
        <select
          id={`${prefix}-instability`}
          aria-describedby={`${prefix}-instability-help`}
          value={value.instability}
          onChange={(e) => change('instability', Number(e.target.value))}
        >
          <option value={0}>Quiet — no additional disturbances</option>
          <option value={0.5}>Occasional — about one per year</option>
          <option value={1}>Unsettled — about two per year</option>
          <option value={2}>Turbulent — about four per year</option>
          <option value={3}>Volatile — about six per year</option>
        </select>
        <small>
          World-wide averages, with irregular timing. Provincial, state, regional and international pressures
          can overlap. Existing effects run their course. Ordinary shortages, politics and climate still
          operate at Quiet.
        </small>
      </div>
      <div className="select-label">
        <ParameterLabel htmlFor={`${prefix}-abundance`} label="Resource abundance">
          {configurationHelp('conditions.abundance')}
        </ParameterLabel>
        <input
          id={`${prefix}-abundance`}
          aria-describedby={`${prefix}-abundance-help`}
          type="range"
          min={0.35}
          max={1.6}
          step={0.05}
          value={value.abundance}
          onChange={(e) => change('abundance', Number(e.target.value))}
        />
        <span>
          {value.abundance.toFixed(2)}× ·{' '}
          {value.abundance < 0.7 ? 'Scarce' : value.abundance <= 1 ? 'Constrained' : 'Abundant'}
        </span>
        <small>
          Scales harvests and raw extraction. Geography, productive capacity, household needs and transport
          determine who has enough. Changing this preserves existing stockpiles.
        </small>
      </div>
      <div className="select-label">
        <ParameterLabel htmlFor={`${prefix}-extremity`} label="Political extremes">
          {configurationHelp('conditions.extremity')}
        </ParameterLabel>
        <input
          id={`${prefix}-extremity`}
          aria-describedby={`${prefix}-extremity-help`}
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={value.extremity}
          onChange={(e) => change('extremity', Number(e.target.value))}
        />
        <span>
          {value.extremity.toFixed(1)} ·{' '}
          {value.extremity < 0.5 ? 'Restrained' : value.extremity < 1.5 ? 'Polarized' : 'Intense'}
        </span>
        <small>
          Amplifies political convictions and shapes future leaders. Existing ambitions persist; institutions,
          constituencies and material constraints still matter.
        </small>
      </div>
    </div>
  )
}
