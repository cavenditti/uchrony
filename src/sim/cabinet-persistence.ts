/** New strategic memory is optional in old saves, but every present reference,
 * deadline and override is checked before it can influence an autonomous state. */
import { STRATEGIC_POSTURES } from './cabinet-state'
import { POLICY_RULES } from './policy-rules'
import { integerValidator, numberValidator, worldValidators } from './persistence-primitives'
import type { Nation, World } from './types'

/** Reject unsupported intentions while retaining references to historical rivals. */
export function validateCabinet(w: World, n: Nation) {
  const c = n.cabinet
  if (c === undefined) return
  if (!c || typeof c !== 'object') throw new Error('Invalid cabinet strategy in this save.')
  const integer = integerValidator(0, w.month + 60),
    number = numberValidator(0, 1e14)
  const ids = worldValidators(w)
  const military = c.posture === 'prepare-war' || c.posture === 'wage-war'
  if (
    !c ||
    !STRATEGIC_POSTURES.includes(c.posture) ||
    !['native', 'model'].includes(c.source) ||
    !integer(c.started, 0, w.month) ||
    !integer(c.review, c.started, w.month + 60) ||
    (c.target !== null &&
      !(military ? ids.nationId(c.target) && c.target !== n.id : ids.regionId(c.target))) ||
    (military && c.target === null) ||
    !Array.isArray(c.overrides) ||
    c.overrides.length > 64 ||
    new Set(c.overrides.map((o) => o?.key)).size !== c.overrides.length ||
    c.overrides.some(
      (o) =>
        !o ||
        !integer(o.until, 0, w.month + 6) ||
        !(
          o.key === 'research' ||
          (typeof o.key === 'string' &&
            ((o.key.startsWith('policy:') && Object.hasOwn(POLICY_RULES, o.key.slice(7))) ||
              /^army:\d+$/.test(o.key)))
        ),
    ) ||
    !Array.isArray(c.wars) ||
    c.wars.length >= w.nations.length ||
    new Set(c.wars.map((m) => m?.rival)).size !== c.wars.length ||
    c.wars.some(
      (m) =>
        !m ||
        !ids.nationId(m.rival) ||
        m.rival === n.id ||
        typeof m.active !== 'boolean' ||
        !integer(m.peace, 0, w.month) ||
        !number(m.grievance) ||
        !number(m.balance),
    ) ||
    (c.objectives !== undefined &&
      (!Array.isArray(c.objectives) ||
        c.objectives.length >= w.nations.length ||
        new Set(c.objectives.map((o) => o?.rival)).size !== c.objectives.length ||
        c.objectives.some(
          (o) =>
            !o ||
            !ids.nationId(o.rival) ||
            o.rival === n.id ||
            !ids.regionId(o.province) ||
            !integer(o.review, 0, w.month + 6),
        )))
  )
    throw new Error('Invalid cabinet strategy or campaign memory in this save.')
}
