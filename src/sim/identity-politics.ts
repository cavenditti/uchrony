/** Identity evaluation has no census mutations: migration, frontier accession and
 * domestic consent consume the same reasons. Scores are synthetic, not calibrated. */
import { clamp, type Nation, type Region } from './types'
import type { PopulationCommunity, IdentityDefinition } from './population-types'
import { resolveIdentityPolicy, type IdentityPolicy } from './identity-policy'

export const POLITICAL_FIELDS = [
  'pluralism',
  'groupIdentification',
  'authority',
  'localAutonomy',
  'publicReligion',
] as const
export const COMMUNITY_POLITICAL_FIELDS = [
  ...POLITICAL_FIELDS,
  'governmentSupport',
  'languageTransmission',
] as const
export type PoliticalOrientation = Record<(typeof POLITICAL_FIELDS)[number], number>
const ORIENTATIONS: Record<IdentityDefinition['orientation'], PoliticalOrientation> = {
  neutral: {
    pluralism: 0.5,
    groupIdentification: 0.5,
    authority: 0.5,
    localAutonomy: 0.5,
    publicReligion: 0.5,
  },
  reform: {
    pluralism: 0.8,
    groupIdentification: 0.35,
    authority: 0.25,
    localAutonomy: 0.5,
    publicReligion: 0.3,
  },
  local: {
    pluralism: 0.45,
    groupIdentification: 0.8,
    authority: 0.35,
    localAutonomy: 0.9,
    publicReligion: 0.5,
  },
  institutional: {
    pluralism: 0.35,
    groupIdentification: 0.6,
    authority: 0.85,
    localAutonomy: 0.2,
    publicReligion: 0.65,
  },
  commerce: {
    pluralism: 0.7,
    groupIdentification: 0.3,
    authority: 0.45,
    localAutonomy: 0.5,
    publicReligion: 0.25,
  },
  communal: {
    pluralism: 0.6,
    groupIdentification: 0.65,
    authority: 0.4,
    localAutonomy: 0.7,
    publicReligion: 0.6,
  },
}
/** Initial political variation follows movements, never ethnic or religious labels. */
export function initializeCommunityPolitics(
  group: PopulationCommunity,
  movement: IdentityDefinition['orientation'] = 'neutral',
) {
  for (const key of POLITICAL_FIELDS) group[key] ??= ORIENTATIONS[movement][key]
  group.governmentSupport ??= group.contentment
  group.languageTransmission ??= 1
}

export interface IdentityEvaluation {
  recognition: number
  privilege: number
  exclusion: number
  coercion: number
  autonomy: number
  consent: number
}
/** Privilege can win support among aligned groups, while pluralists object to
 * exclusion of others. Knowing the public language avoids a smooth competence
 * penalty without requiring replacement of the household language. */
export function evaluateIdentityPolicy(
  group: PopulationCommunity,
  nation: Pick<Nation, 'identity' | 'policies'>,
  policy = resolveIdentityPolicy(nation.policies),
  protection = 0.5,
): IdentityEvaluation {
  const official = nation.identity
  if (!official) return { recognition: 0, privilege: 0, exclusion: 0, coercion: 0, autonomy: 0, consent: 0 }
  const culture = Number(group.culture === official.culture)
  const language = Number(group.language === official.language)
  const belief = Number(group.belief === official.belief)
  const competence = language || (group.knownLanguage === official.language ? group.fluency : 0)
  const pluralism = group.pluralism ?? 0.5
  const identification = group.groupIdentification ?? 0.5
  const authority = group.authority ?? 0.5
  const local = group.localAutonomy ?? 0.5
  const religious = group.publicReligion ?? 0.5
  const protectionFactor = 1 - clamp(protection) * 0.45
  const exclusion = clamp(
    (0.35 * policy.culturalExclusion * (1 - culture) +
      0.4 * policy.faithRestrictions * (1 - belief) +
      0.12 * policy.languageExclusion * clamp(1 - competence / 0.5)) *
      protectionFactor,
  )
  const recognition =
    identification *
      (0.16 * policy.culturalAssimilation * (2 * culture - 1) +
        0.12 * policy.languageAssimilation * (2 * language - 1)) +
    0.15 * religious * policy.stateFaithSupport * (2 * belief - 1) +
    0.08 * policy.localLanguageSupport * (1 - language)
  const privilege =
    identification *
    (1 - pluralism) *
    (0.18 * policy.culturalExclusion * culture +
      0.16 * policy.faithRestrictions * belief * religious +
      0.08 * policy.languageExclusion * language)
  const coercion =
    -(1 - authority) *
      (0.12 * policy.culturalAssimilation * (1 - culture) +
        0.12 * policy.languageAssimilation * (1 - language) +
        0.1 * policy.faithRestrictions * (1 - belief)) -
    pluralism *
      (0.18 * policy.culturalExclusion + 0.2 * policy.faithRestrictions + 0.1 * policy.languageExclusion)
  const autonomy =
    local *
    (0.1 * policy.localLanguageSupport -
      0.08 * policy.languageAssimilation -
      0.06 * policy.culturalAssimilation)
  return {
    recognition,
    privilege,
    exclusion,
    coercion,
    autonomy,
    consent: clamp(recognition + privilege - exclusion + coercion + autonomy, -1, 1),
  }
}

/** Attitudes follow political organizations over decades. Exclusion may strengthen
 * group identification, but does not automatically teach pluralism or rebellion. */
export function evolveCommunityPolitics(
  group: PopulationCommunity,
  movement: IdentityDefinition['orientation'],
  exclusion: number,
  rate: number,
) {
  initializeCommunityPolitics(group, movement)
  for (const key of POLITICAL_FIELDS) {
    const target = clamp(ORIENTATIONS[movement][key] + (key === 'groupIdentification' ? exclusion * 0.25 : 0))
    group[key] = clamp(group[key]! + (target - group[key]!) * rate)
  }
}

/** Foreign states are evaluated on advertised institutions, discounted by credible
 * security and legitimacy. Geography/capacity remain the caller's admission gate. */
export function identityStateAppeal(
  group: PopulationCommunity,
  nation: Nation,
  policy?: IdentityPolicy,
  protection = 0.5,
) {
  const evaluation = evaluateIdentityPolicy(group, nation, policy, protection)
  const official = nation.identity
  if (!official) return 0
  const affinity =
    (Number(group.culture === official.culture) * 0.4 +
      Number(group.language === official.language) * 0.35 +
      Number(group.belief === official.belief) * 0.25) *
    (group.groupIdentification ?? 0.5)
  return (
    clamp(affinity * 0.35 + evaluation.consent * 0.65, -1, 1) *
    clamp((nation.stability + nation.legitimacy) / 200)
  )
}

/** Weighted resident preference keeps mixed provinces from adopting a single label. */
export function regionIdentityAppeal(nation: Nation, region: Region) {
  const policy = resolveIdentityPolicy(nation.policies)
  let people = 0,
    appeal = 0
  for (const group of region.communities ?? []) {
    const size = group.population.children + group.population.adults + group.population.elders
    people += size
    appeal += size * identityStateAppeal(group, nation, policy)
  }
  return people ? appeal / people : 0
}
