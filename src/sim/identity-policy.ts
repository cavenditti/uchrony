/** Continuous identity policy is canonical. Legacy choices are presets and save fallbacks;
 * all consumers share this resolver so a custom slider cannot leave hidden enum effects. */
import { clamp, type Policies } from './types'

export const IDENTITY_POLICY_FIELDS = {
  languageEducation: [
    'Common-language teaching',
    'Share of language education directed to the common language.',
  ],
  localLanguageSupport: ['Local-language support', 'School and service support for local languages.'],
  languageAssimilation: [
    'Language uniformity',
    'Pressure to replace local speech with the official language.',
  ],
  languageExclusion: ['Language-based exclusion', 'Restrictions on people who lack the common language.'],
  culturalAssimilation: ['Cultural assimilation', 'Pressure to adopt the official cultural identity.'],
  culturalExclusion: ['Cultural privileges', 'Advantages reserved for the official cultural group.'],
  stateFaithSupport: ['Official-faith support', 'Public recognition and support for the official faith.'],
  faithRestrictions: [
    'Restrictions on other faiths',
    'Limits on practice and opportunities for other faiths.',
  ],
} as const
export type IdentityPolicyKey = keyof typeof IDENTITY_POLICY_FIELDS
export type IdentityPolicy = Record<IdentityPolicyKey, number>
export const IDENTITY_POLICY_KEYS = Object.keys(IDENTITY_POLICY_FIELDS) as IdentityPolicyKey[]
export const ZERO_IDENTITY_POLICY: Readonly<IdentityPolicy> = Object.freeze(
  Object.fromEntries(IDENTITY_POLICY_KEYS.map((key) => [key, 0])) as IdentityPolicy,
)
export const IDENTITY_PRESETS = {
  citizenship: {
    civic: { culturalAssimilation: 0.35, culturalExclusion: 0 },
    pluralist: { culturalAssimilation: 0.05, culturalExclusion: 0 },
    heritage: { culturalAssimilation: 0.6, culturalExclusion: 1 },
  },
  languagePolicy: {
    local: {
      languageEducation: 0.2,
      localLanguageSupport: 0.8,
      languageAssimilation: 0,
      languageExclusion: 0,
    },
    multilingual: {
      languageEducation: 0.7,
      localLanguageSupport: 0.7,
      languageAssimilation: 0.1,
      languageExclusion: 0,
    },
    common: {
      languageEducation: 0.8,
      localLanguageSupport: 0.1,
      languageAssimilation: 0.8,
      languageExclusion: 1,
    },
  },
  beliefPolicy: {
    protected: { stateFaithSupport: 0, faithRestrictions: 0 },
    favored: { stateFaithSupport: 0.6, faithRestrictions: 0.3 },
    restricted: { stateFaithSupport: 1, faithRestrictions: 1 },
  },
} as const
export type IdentityPresetAxis = keyof typeof IDENTITY_PRESETS
/** Reverse index lets an explicit preset reserve its continuous settings together. */
export const IDENTITY_POLICY_AXIS = Object.fromEntries(
  Object.entries(IDENTITY_PRESETS).flatMap(([axis, presets]) =>
    Object.keys(Object.values(presets)[0]).map((key) => [key, axis]),
  ),
) as Record<IdentityPolicyKey, IdentityPresetAxis>

/** Missing continuous fields retain old saves' chosen political direction. */
export function resolveIdentityPolicy(policies: Partial<Policies>): IdentityPolicy {
  const defaults: IdentityPolicy = {
    ...IDENTITY_PRESETS.citizenship[policies.citizenship ?? 'civic'],
    ...IDENTITY_PRESETS.languagePolicy[policies.languagePolicy ?? 'multilingual'],
    ...IDENTITY_PRESETS.beliefPolicy[policies.beliefPolicy ?? 'protected'],
  }
  for (const key of IDENTITY_POLICY_KEYS) defaults[key] = policies[key] ?? defaults[key]
  return defaults
}

/** Enum commands apply their values atomically; later slider edits retain other axes. */
export function applyIdentityPreset(policies: Policies, axis: IdentityPresetAxis) {
  const presets = IDENTITY_PRESETS[axis] as Record<string, Partial<IdentityPolicy>>
  Object.assign(policies, presets[policies[axis]!])
}

/** A preset is a view of actual values, never an additional policy state. */
export function identityPresetName(policies: Policies, axis: IdentityPresetAxis) {
  const resolved = resolveIdentityPolicy(policies)
  for (const [name, values] of Object.entries(IDENTITY_PRESETS[axis]))
    if (
      Object.entries(values).every(
        ([key, value]) => Math.abs(resolved[key as IdentityPolicyKey] - (value as number)) < 1e-9,
      )
    )
      return name
  return 'custom'
}

/** School capacity is shared between common/local provision rather than multiplied
 * by two sliders. Enforcement requires actual local administrative presence. */
export function policyCapacityTargets(
  policy: IdentityPolicy,
  education: number,
  administration: number,
): IdentityPolicy {
  const targets = { ...policy }
  const teachingTotal = Math.max(1, policy.languageEducation + policy.localLanguageSupport)
  targets.languageEducation *= clamp(education) / teachingTotal
  targets.localLanguageSupport *= clamp(education) / teachingTotal
  for (const key of IDENTITY_POLICY_KEYS)
    if (key !== 'languageEducation' && key !== 'localLanguageSupport') targets[key] *= clamp(administration)
  return targets
}
