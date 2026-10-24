import type { World } from './types'

/** Boundary language for legacy records and generated prose. Never rewrites authoritative documents. */
export function inWorldText(text: string): string {
  if (
    !/referee|adjudicat|live-state verification|(?:external|independent|simulation|LLM)\s+(?:overseer|arbiter|judge)/i.test(
      text,
    )
  )
    return text
  return text
    .replace(/\/api\/statecraft\/referee\b/gi, 'background service')
    .replace(/\bReferee\s+approve(?:d)?\s*:/gi, 'Agreement took effect:')
    .replace(/\bReferee\s+reject(?:ed)?\s*:/gi, 'Proposal did not proceed:')
    .replace(/\bReferee\s+defer(?:red)?\s*:/gi, 'Implementation delayed:')
    .replace(
      /\b(?:the\s+)?(?:independent\s+)?referee(?:\s+(?:agent|model))?\s+(?:has\s+)?(?:approved|accepted|ratified)\b/gi,
      'implementation proceeded for',
    )
    .replace(
      /\b(?:the\s+)?(?:independent\s+)?referee(?:\s+(?:agent|model))?\s+(?:has\s+)?rejected\b/gi,
      'implementation could not proceed for',
    )
    .replace(
      /\b(?:the\s+)?referee\s+has applied institutional consequences\.?/gi,
      'This damaged institutional confidence.',
    )
    .replace(
      /\b(await(?:ing|s)?|wait(?:ing)? for|pending)\s+(?:the\s+)?(?:independent\s+)?referee(?:['’]s)?\s+(?:approval|review|decision|adjudication)\b/gi,
      (_match, verb: string) => {
        const lower = verb.toLowerCase(),
          replacement =
            lower === 'await'
              ? 'await implementation'
              : lower === 'awaits'
                ? 'awaits implementation'
                : lower === 'wait for'
                  ? 'wait for implementation'
                  : lower === 'waiting for'
                    ? 'waiting for implementation'
                    : 'awaiting implementation'
        return verb[0] !== verb[0].toLowerCase()
          ? replacement[0].toUpperCase() + replacement.slice(1)
          : replacement
      },
    )
    .replace(
      /\b(?:the\s+)?referee(?:['’]s)?\s+(?:approval|review|decision|adjudication|ruling)\b/gi,
      'implementation conditions',
    )
    .replace(
      /\b(?:the\s+)?(?:independent\s+)?(?:LLM[- ]+)?referee(?:\s+(?:agent|model))?(?:['’]s)?\b/gi,
      'political and material constraints',
    )
    .replace(/referee[a-z-]*/gi, 'implementation')
    .replace(
      /\b(?:the\s+)?(?:external|independent|simulation|LLM)\s+(?:overseer|arbiter|judge)(?:['’]s)?\b/gi,
      'political and material constraints',
    )
    .replace(/\badjudicat(?:ion|ions|or|ors|ed|es|ing|e)\b/gi, 'implementation')
    .replace(/\bLive-state verification\s*:/gi, 'Changed circumstances:')
}

/** Small model-facing contexts only; do not walk the full geographic or community census. */
export function narrativeProjection<T>(value: T): T {
  if (typeof value === 'string') return inWorldText(value) as T
  if (Array.isArray(value)) return value.map(narrativeProjection) as T
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, narrativeProjection(entry)]),
    ) as T
  return value
}

/** A display projection. Persistence/export must always retain the original worker snapshot. */
export function presentWorld(world: World): World {
  const named = <T extends { name: string }>(item: T): T => {
    const name = inWorldText(item.name)
    return name === item.name ? item : { ...item, name }
  }
  return {
    ...world,
    seed: inWorldText(world.seed),
    nations: narrativeProjection(world.nations),
    regions: world.regions.map(named),
    armies: world.armies.map(named),
    events: narrativeProjection(world.events),
    ...(world.warfare ? { warfare: { ...world.warfare, fleets: world.warfare.fleets.map(named) } } : {}),
    ...(world.statecraft ? { statecraft: narrativeProjection(world.statecraft) } : {}),
    ...(world.institutions ? { institutions: narrativeProjection(world.institutions) } : {}),
    ...(world.intelligence ? { intelligence: narrativeProjection(world.intelligence) } : {}),
    ...(world.foreignOffices ? { foreignOffices: narrativeProjection(world.foreignOffices) } : {}),
    ...(world.sovereignty ? { sovereignty: narrativeProjection(world.sovereignty) } : {}),
    ...(world.pressures ? { pressures: narrativeProjection(world.pressures) } : {}),
    ...(world.demography
      ? { demography: { ...world.demography, identities: narrativeProjection(world.demography.identities) } }
      : {}),
    ...(world.historical
      ? {
          historical: {
            ...world.historical,
            effects: world.historical.effects.map((active) => ({
              ...active,
              title: inWorldText(active.title),
              effect: { ...active.effect, text: inWorldText(active.effect.text) },
            })),
            societies: narrativeProjection(world.historical.societies),
            legacies: narrativeProjection(world.historical.legacies),
          },
        }
      : {}),
  }
}
