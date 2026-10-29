import { useId, useRef, useState } from 'react'
import { ChevronRight, Download, RotateCcw, Search, Upload } from 'lucide-react'
import { DEFAULT_CONFIGURATION_VALUES, type ConfigurationValues } from '../sim/configuration-defaults'
import {
  CONFIGURATION_FIELDS,
  CONFIGURATION_GROUPS,
  configurationLabel,
  configurationValue,
  setConfigurationValue,
  type ConfigurationField,
} from '../sim/configuration-schema'
import { validateConfigurationValues } from '../sim/configuration'
import { BIOMES, MOISTURE_BANDS, TEMPERATURE_BANDS } from '../sim/climate-types'
import { configurationHelp } from '../sim/configuration-help'
import { ParameterHelp } from './ParameterHelp'

export function ConfigurationEditor({
  value,
  onChange,
  live = false,
  baseline,
}: {
  value: ConfigurationValues
  onChange: (value: ConfigurationValues) => void
  live?: boolean
  baseline?: ConfigurationValues
}) {
  const [search, setSearch] = useState('')
  const [importError, setImportError] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const prefix = useId()
  const query = search.trim().toLowerCase()
  const changed = CONFIGURATION_FIELDS.filter(
    (field) =>
      JSON.stringify(configurationValue(value, field.path)) !==
      JSON.stringify(configurationValue(baseline ?? DEFAULT_CONFIGURATION_VALUES, field.path)),
  ).length
  const edit = (path: string, next: unknown) => onChange(setConfigurationValue(value, path, next))
  const reset = (fields: ConfigurationField[]) => {
    let next = value
    for (const field of fields)
      if (!live || !field.creationOnly)
        next = setConfigurationValue(
          next,
          field.path,
          configurationValue(DEFAULT_CONFIGURATION_VALUES, field.path),
        )
    onChange(next)
  }
  const control = (field: ConfigurationField) => {
    const current = configurationValue(value, field.path)
    const disabled = live && field.creationOnly
    const id = `${prefix}-${field.path}`
    const help = `${id}-help`
    const limits = `${id}-limits`
    const common = { id, disabled, 'aria-describedby': `${help} ${limits}` }
    return (
      <div className={`configuration-field ${disabled ? 'creation-only' : ''}`} key={field.path}>
        <div className="configuration-field-heading">
          <label htmlFor={id}>{field.label}</label>
          <ParameterHelp id={help} label={field.label}>
            {field.description}
          </ParameterHelp>
          {disabled && <span className="configuration-lock">Creation only</span>}
        </div>
        {field.kind === 'boolean' ? (
          <select
            {...common}
            value={String(current)}
            onChange={(event) => edit(field.path, event.target.value === 'true')}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        ) : field.kind === 'select' ? (
          <select
            {...common}
            value={String(current)}
            onChange={(event) => edit(field.path, event.target.value)}
          >
            {field.options!.map((option) => (
              <option key={option} value={option}>
                {configurationLabel(option)}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...common}
            type="number"
            required
            min={field.min}
            max={field.max}
            step={field.integer ? 1 : 'any'}
            value={Number.isFinite(current) ? Number(current) : ''}
            onChange={(event) => edit(field.path, event.target.valueAsNumber)}
          />
        )}
        <small id={limits}>
          {field.kind === 'number'
            ? `${field.min}–${field.max}${field.unit ? ` ${field.unit}` : ''}${field.integer ? ' · whole numbers' : ''}`
            : 'Saved with this world.'}
        </small>
      </div>
    )
  }
  const visibleGroups = Object.entries(CONFIGURATION_GROUPS).filter(
    ([key, group]) =>
      (!live || (key !== 'geography' && key !== 'starting')) &&
      (!query ||
        `${group.label} ${group.description}`.toLowerCase().includes(query) ||
        CONFIGURATION_FIELDS.some(
          (field) => field.group === key && `${field.label} ${field.path}`.toLowerCase().includes(query),
        )),
  )
  return (
    <section
      className="configuration-editor"
      aria-label={live ? 'Live simulation parameters' : 'Advanced world parameters'}
    >
      <div className="configuration-toolbar">
        <label className="configuration-search">
          <Search size={16} aria-hidden="true" />
          <span className="visually-hidden">Find a parameter</span>
          <input
            type="search"
            placeholder="Find a parameter…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button type="button" className="button secondary" onClick={() => reset(CONFIGURATION_FIELDS)}>
          <RotateCcw size={14} />
          Defaults
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Export parameter preset"
          title="Export parameter preset"
          onClick={() => {
            try {
              const values = validateConfigurationValues(value)
              const url = URL.createObjectURL(
                new Blob([JSON.stringify({ version: 1, values }, null, 2)], { type: 'application/json' }),
              )
              const link = document.createElement('a')
              link.href = url
              link.download = 'uchrony-parameters.json'
              link.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
              setImportError('')
            } catch (error) {
              setImportError((error as Error).message)
            }
          }}
        >
          <Download size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Import parameter preset"
          title="Import parameter preset"
          onClick={() => file.current?.click()}
        >
          <Upload size={16} />
        </button>
        <input
          ref={file}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          aria-label="Parameter preset file"
          onChange={async (event) => {
            const selected = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!selected) return
            try {
              if (selected.size > 100000) throw new Error('Choose a parameter preset smaller than 100 KB.')
              const preset = JSON.parse(await selected.text())
              if (preset.version !== 1 || !preset.values)
                throw new Error('Choose an Uchrony version 1 parameter preset.')
              let next = validateConfigurationValues(preset.values)
              if (live)
                for (const field of CONFIGURATION_FIELDS)
                  if (field.creationOnly)
                    next = setConfigurationValue(next, field.path, configurationValue(value, field.path))
              onChange(next)
              setImportError('')
            } catch (error) {
              setImportError((error as Error).message)
            }
          }}
        />
      </div>
      <p className="configuration-summary" role="status">
        {changed
          ? `${changed} ${live ? 'pending' : 'custom'} ${changed === 1 ? 'parameter' : 'parameters'}`
          : live
            ? 'No pending changes'
            : 'Default parameters'}{' '}
        ·{' '}
        {live
          ? 'Edits take effect together when applied.'
          : 'All settings are saved with the generated world.'}
      </p>
      {importError && (
        <p className="configuration-error" role="alert">
          {importError}
        </p>
      )}
      {!visibleGroups.length && (
        <p className="empty-state">No parameters match “{search}”. Try climate, population or trade.</p>
      )}
      {visibleGroups.map(([key, group]) => {
        const startingOrder = [
          'starting.treasury',
          'starting.settledTreasury',
          'starting.debt',
          'starting.year',
          'starting.capitalPopulation',
          'starting.populationScale',
        ]
        const fields = CONFIGURATION_FIELDS.filter((field) => field.group === key)
        if (key === 'starting')
          fields.sort((a, b) => {
            const rank = (path: string) => {
              const index = startingOrder.indexOf(path)
              return index < 0 ? startingOrder.length : index
            }
            return rank(a.path) - rank(b.path)
          })
        const showAll = !query || `${group.label} ${group.description}`.toLowerCase().includes(query)
        const visible = fields.filter(
          (field) => showAll || `${field.label} ${field.path}`.toLowerCase().includes(query),
        )
        const matrix = key === 'climate' && (showAll || query.includes('matrix') || query.includes('biome'))
        const ordinary = matrix
          ? visible.filter(
              (field) =>
                !field.path.startsWith('climate.matrix.') &&
                !field.path.startsWith('climate.terrainOverrides.'),
            )
          : visible
        const count = fields.filter(
          (field) =>
            JSON.stringify(configurationValue(value, field.path)) !==
            JSON.stringify(configurationValue(baseline ?? DEFAULT_CONFIGURATION_VALUES, field.path)),
        ).length
        return (
          <details
            className="configuration-group"
            key={`${key}-${Boolean(query)}`}
            open={query || (!live && key === 'starting') ? true : undefined}
          >
            <summary>
              <ChevronRight size={15} aria-hidden="true" />
              <span>{group.label}</span>
              <small>{count ? `${count} changed` : `${fields.length} parameters`}</small>
            </summary>
            <div className="configuration-group-body">
              <div className="configuration-group-heading">
                <p>{group.description}</p>
                <button className="text-button" type="button" onClick={() => reset(fields)}>
                  Reset section
                </button>
              </div>
              <div className="configuration-grid">{ordinary.map(control)}</div>
              {matrix && (
                <>
                  <h3 className="configuration-subheading">Biome matrix</h3>
                  <p className="configuration-note">
                    Temperature bands form the rows; moisture bands form the columns. Every combination has an
                    explicit biome.
                  </p>
                  <p className="configuration-note configuration-matrix-hint">
                    Scroll the table sideways to see all moisture bands.
                  </p>
                  <div
                    className="configuration-matrix-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="Biome matrix table"
                  >
                    <table className="configuration-matrix">
                      <thead>
                        <tr>
                          <th scope="col">Temperature / moisture</th>
                          {MOISTURE_BANDS.map((band) => (
                            <th scope="col" key={band}>
                              {configurationLabel(band)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {TEMPERATURE_BANDS.map((thermal) => (
                          <tr key={thermal}>
                            <th scope="row">{configurationLabel(thermal)}</th>
                            {MOISTURE_BANDS.map((wetness) => (
                              <td key={wetness}>
                                <div className="configuration-matrix-control">
                                  <select
                                    aria-label={`${configurationLabel(thermal)} / ${wetness} biome`}
                                    aria-describedby={`${prefix}-${thermal}-${wetness}-help`}
                                    value={value.climate.matrix[thermal][wetness]}
                                    onChange={(event) =>
                                      edit(`climate.matrix.${thermal}.${wetness}`, event.target.value)
                                    }
                                  >
                                    {BIOMES.map((biome) => (
                                      <option key={biome} value={biome}>
                                        {configurationLabel(biome)}
                                      </option>
                                    ))}
                                  </select>
                                  <ParameterHelp
                                    id={`${prefix}-${thermal}-${wetness}-help`}
                                    label={`${thermal} / ${wetness} biome`}
                                  >
                                    {configurationHelp(`climate.matrix.${thermal}.${wetness}`)}
                                  </ParameterHelp>
                                </div>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h3 className="configuration-subheading">Terrain overrides</h3>
                  <p className="configuration-note">
                    Desert and tundra use these explicit temperature-band outcomes, regardless of moisture.
                  </p>
                  <div className="configuration-grid">
                    {fields
                      .filter((field) => field.path.startsWith('climate.terrainOverrides.'))
                      .map(control)}
                  </div>
                </>
              )}
            </div>
          </details>
        )
      })}
    </section>
  )
}
