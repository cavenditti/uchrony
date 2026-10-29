import { useId, useRef, useState } from 'react'
import { ChevronRight, Download, RotateCcw, Search, Upload } from 'lucide-react'
import { DEFAULT_CONFIGURATION_VALUES, type ConfigurationValues } from '../sim/configuration-defaults'
import {
  CONFIGURATION_FIELDS,
  CONFIGURATION_FIELDS_BY_GROUP,
  CONFIGURATION_GROUPS,
  configurationLabel,
  configurationValue,
  countChangedFields,
  resetConfigurationFields,
  setConfigurationValue,
  type ConfigurationField,
} from '../sim/configuration-schema'
import { validateConfigurationValues } from '../sim/configuration'
import { BIOMES, MOISTURE_BANDS, TEMPERATURE_BANDS } from '../sim/climate-types'
import { configurationHelp } from '../sim/configuration-help'
import { ParameterHelp } from './ParameterHelp'

const GROUP_ENTRIES = Object.entries(CONFIGURATION_GROUPS) as [
  keyof ConfigurationValues,
  (typeof CONFIGURATION_GROUPS)[keyof ConfigurationValues],
][]

// All 20 `climate.matrix.*` cells and 10 `climate.terrainOverrides.*` fields are
// registered in `CONFIGURATION_FIELDS` so they participate in validation, preset
// import/export, search, and change counting. In the editor UI, however, matrix
// cells are rendered as a 2D temperature × moisture table rather than 20 flat
// dropdown cards, with terrain overrides grouped in their own subsection below.
const CLIMATE_ORDINARY_FIELDS = CONFIGURATION_FIELDS_BY_GROUP.climate.filter(
  (field) => !field.path.startsWith('climate.matrix.') && !field.path.startsWith('climate.terrainOverrides.'),
)

const CLIMATE_TERRAIN_OVERRIDE_FIELDS = CONFIGURATION_FIELDS_BY_GROUP.climate.filter((field) =>
  field.path.startsWith('climate.terrainOverrides.'),
)

function exportPresetFile(value: ConfigurationValues) {
  const values = validateConfigurationValues(value)
  const blob = new Blob([JSON.stringify({ version: 1, values }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'uchrony-parameters.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Parses and validates an imported JSON parameter preset.
 *
 * When importing a preset into a running world (`live === true`), any creation-only
 * parameters in the preset (such as `starting.*`, `geography.*`, or `model.bankCount`)
 * are overwritten with the running world's current values so that a full preset
 * exported at world-creation time can still be imported during live play to apply
 * its live-tunable parameters without failing `applyConfiguration`'s creationOnly check.
 */
async function parsePresetFile(
  selected: File,
  current: ConfigurationValues,
  live: boolean,
): Promise<ConfigurationValues> {
  if (selected.size > 100000) throw new Error('Choose a parameter preset smaller than 100 KB.')
  const preset = JSON.parse(await selected.text())
  if (preset.version !== 1 || !preset.values) throw new Error('Choose an Uchrony version 1 parameter preset.')
  const validated = validateConfigurationValues(preset.values)
  if (!live) return validated
  const creationOnlyFields = CONFIGURATION_FIELDS.filter((field) => field.creationOnly)
  return resetConfigurationFields(validated, creationOnlyFields, current, false)
}

function matchesFieldQuery(field: ConfigurationField, query: string): boolean {
  return `${field.label} ${field.path}`.toLowerCase().includes(query)
}

function ConfigurationFieldControl({
  field,
  prefix,
  value,
  live,
  onEdit,
}: {
  field: ConfigurationField
  prefix: string
  value: ConfigurationValues
  live: boolean
  onEdit: (field: ConfigurationField, next: unknown) => void
}) {
  const current = configurationValue(value, field)
  const disabled = live && field.creationOnly
  const id = `${prefix}-${field.path}`
  const help = `${id}-help`
  const limits = `${id}-limits`
  const common = { id, disabled, 'aria-describedby': `${help} ${limits}` }

  return (
    <div className={`configuration-field ${disabled ? 'creation-only' : ''}`}>
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
          onChange={(event) => onEdit(field, event.target.value === 'true')}
        >
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      ) : field.kind === 'select' ? (
        <select {...common} value={String(current)} onChange={(event) => onEdit(field, event.target.value)}>
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
          onChange={(event) => onEdit(field, event.target.valueAsNumber)}
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

function ClimateMatrixSection({
  prefix,
  value,
  live,
  onEditPath,
  onEditField,
}: {
  prefix: string
  value: ConfigurationValues
  live: boolean
  onEditPath: (path: string, next: unknown) => void
  onEditField: (field: ConfigurationField, next: unknown) => void
}) {
  return (
    <>
      <h3 className="configuration-subheading">Biome matrix</h3>
      <p className="configuration-note">
        Temperature bands form the rows; moisture bands form the columns. Every combination has an explicit
        biome.
      </p>
      <p className="configuration-note configuration-matrix-hint">
        Scroll the table sideways to see all moisture bands.
      </p>
      <div className="configuration-matrix-scroll" tabIndex={0} role="region" aria-label="Biome matrix table">
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
                {MOISTURE_BANDS.map((wetness) => {
                  const path = `climate.matrix.${thermal}.${wetness}`
                  const helpId = `${prefix}-${thermal}-${wetness}-help`
                  return (
                    <td key={wetness}>
                      <div className="configuration-matrix-control">
                        <select
                          aria-label={`${configurationLabel(thermal)} / ${wetness} biome`}
                          aria-describedby={helpId}
                          value={value.climate.matrix[thermal][wetness]}
                          onChange={(event) => onEditPath(path, event.target.value)}
                        >
                          {BIOMES.map((biome) => (
                            <option key={biome} value={biome}>
                              {configurationLabel(biome)}
                            </option>
                          ))}
                        </select>
                        <ParameterHelp id={helpId} label={`${thermal} / ${wetness} biome`}>
                          {configurationHelp(path)}
                        </ParameterHelp>
                      </div>
                    </td>
                  )
                })}
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
        {CLIMATE_TERRAIN_OVERRIDE_FIELDS.map((field) => (
          <ConfigurationFieldControl
            key={field.path}
            field={field}
            prefix={prefix}
            value={value}
            live={live}
            onEdit={onEditField}
          />
        ))}
      </div>
    </>
  )
}

export function ConfigurationEditor({
  value,
  onChange,
  live = false,
  baseline = DEFAULT_CONFIGURATION_VALUES,
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

  const changed = countChangedFields(CONFIGURATION_FIELDS, value, baseline)
  const editField = (field: ConfigurationField, next: unknown) =>
    onChange(setConfigurationValue(value, field, next))
  const editPath = (path: string, next: unknown) => onChange(setConfigurationValue(value, path, next))
  const reset = (fields: readonly ConfigurationField[]) =>
    onChange(resetConfigurationFields(value, fields, DEFAULT_CONFIGURATION_VALUES, live))

  const visibleGroups = GROUP_ENTRIES.filter(([key, group]) => {
    if (live && (key === 'geography' || key === 'starting')) return false
    if (!query) return true
    if (`${group.label} ${group.description}`.toLowerCase().includes(query)) return true
    return CONFIGURATION_FIELDS_BY_GROUP[key].some((field) => matchesFieldQuery(field, query))
  })

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
              exportPresetFile(value)
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
              onChange(await parsePresetFile(selected, value, live))
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
        const fields = CONFIGURATION_FIELDS_BY_GROUP[key]
        const showAll = !query || `${group.label} ${group.description}`.toLowerCase().includes(query)
        const showMatrix =
          key === 'climate' && (showAll || query.includes('matrix') || query.includes('biome'))
        const candidateFields = showMatrix ? CLIMATE_ORDINARY_FIELDS : fields
        const ordinary = showAll
          ? candidateFields
          : candidateFields.filter((field) => matchesFieldQuery(field, query))
        const count = countChangedFields(fields, value, baseline)

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
              <div className="configuration-grid">
                {ordinary.map((field) => (
                  <ConfigurationFieldControl
                    key={field.path}
                    field={field}
                    prefix={prefix}
                    value={value}
                    live={live}
                    onEdit={editField}
                  />
                ))}
              </div>
              {showMatrix && (
                <ClimateMatrixSection
                  prefix={prefix}
                  value={value}
                  live={live}
                  onEditPath={editPath}
                  onEditField={editField}
                />
              )}
            </div>
          </details>
        )
      })}
    </section>
  )
}
