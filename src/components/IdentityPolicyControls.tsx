/** Presets write the same continuous fields as advanced controls. Keep the compact
 * inspector's established label/range pattern and commit once per interaction. */
import { useState } from 'react'
import {
  IDENTITY_POLICY_FIELDS,
  IDENTITY_POLICY_KEYS,
  IDENTITY_PRESETS,
  identityPresetName,
  resolveIdentityPolicy,
  type IdentityPolicyKey,
} from '../sim/identity-policy'
import type { Policies } from '../sim/types'

const PRESET_LABELS = {
  citizenship: {
    title: 'Cultural citizenship',
    civic: 'Civic citizenship',
    pluralist: 'Cultural pluralism',
    heritage: 'Heritage privileges',
  },
  languagePolicy: {
    title: 'Language policy',
    local: 'Local continuity',
    multilingual: 'Multilingual integration',
    common: 'Common-language uniformity',
  },
  beliefPolicy: {
    title: 'Freedom of belief',
    protected: 'Protect all traditions',
    favored: 'Favor the official faith',
    restricted: 'Restrict other faiths',
  },
} as const

function IdentitySlider({
  field,
  value,
  onChange,
}: {
  field: IdentityPolicyKey
  value: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const [label, description] = IDENTITY_POLICY_FIELDS[field]
  const commit = (value: number) => {
    onChange(value / 100)
    setDraft(null)
  }
  return (
    <label className="policy-slider">
      <span>
        <strong>{label}</strong>
        <b>{draft ?? Math.round(value * 100)}%</b>
      </span>
      <small>{description}</small>
      <input
        aria-label={label}
        type="range"
        min={0}
        max={100}
        value={draft ?? Math.round(value * 100)}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key))
            commit(Number(e.currentTarget.value))
        }}
        onBlur={() => {
          if (draft !== null) commit(draft)
        }}
      />
    </label>
  )
}

/** Percentages describe policy intensity, not a budget or a promised success rate. */
export function IdentityPolicyControls({
  policies,
  onChange,
}: {
  policies: Policies
  onChange: (key: keyof Policies, value: Policies[keyof Policies]) => void
}) {
  const resolved = resolveIdentityPolicy(policies)
  return (
    <>
      {(Object.keys(IDENTITY_PRESETS) as (keyof typeof IDENTITY_PRESETS)[]).map((axis) => {
        const labels = PRESET_LABELS[axis] as Record<string, string>
        return (
          <label className="select-label" key={axis}>
            {labels.title}
            <select
              value={identityPresetName(policies, axis)}
              onChange={(e) => onChange(axis, e.target.value as Policies[typeof axis])}
            >
              <option value="custom" disabled>
                Custom policy
              </option>
              {Object.keys(IDENTITY_PRESETS[axis]).map((name) => (
                <option key={name} value={name}>
                  {labels[name]}
                </option>
              ))}
            </select>
          </label>
        )
      })}
      <details className="community-records">
        <summary>Adjust identity policies</summary>
        <p className="panel-note">
          Intensity, not spending. Teaching shares existing school capacity; enforcement depends on local
          administration. Changes take time.
        </p>
        {IDENTITY_POLICY_KEYS.map((field) => (
          <IdentitySlider
            key={field}
            field={field}
            value={resolved[field]}
            onChange={(value) => onChange(field, value)}
          />
        ))}
      </details>
    </>
  )
}
