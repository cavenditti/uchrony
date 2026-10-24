import { GOODS, FIELDS, type World } from './types'

/** Validates untrusted save files before they enter the simulation worker. */
export function validateWorld(value: unknown): World {
  const fail = (message: string): never => {
    throw new Error(`Invalid world save: ${message}`)
  }
  const object = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x)
  const number = (x: unknown, min = 0, max = 1e14) =>
    typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max
  const walk = (x: unknown, depth = 0) => {
    if (depth > 15) fail('data is nested too deeply')
    if (typeof x === 'number' && !Number.isFinite(x)) fail('non-finite number')
    if (typeof x === 'string' && x.length > 5000) fail('oversized text field')
    if (object(x) || Array.isArray(x)) for (const v of Object.values(x)) walk(v, depth + 1)
  }
  if (!object(value)) fail('expected an object')
  const w = value as unknown as World
  walk(w)
  if (w.version !== 1) fail('unsupported version; this app supports version 1')
  if (
    typeof w.seed !== 'string' ||
    w.seed.length > 100 ||
    !number(w.month, 0, 120000) ||
    !Number.isInteger(w.month)
  )
    fail('invalid seed or simulation date')
  if (
    !number(w.startYear, 1, 10000) ||
    !number(w.rng, 0, 4294967295) ||
    !number(w.nextEvent) ||
    !number(w.nextArmy) ||
    !number(w.climate, 0.1, 3)
  )
    fail('missing simulation counters')
  if (w.width !== 112 || w.height !== 72 || !Array.isArray(w.cells) || w.cells.length !== w.width * w.height)
    fail('unsupported map dimensions')
  if (!Array.isArray(w.regions) || w.regions.length < 4 || w.regions.length > 600) fail('invalid provinces')
  if (!Array.isArray(w.nations) || w.nations.length < 4 || w.nations.length > 18) fail('invalid states')
  const regionId = (id: unknown) => number(id, 0, w.regions.length - 1) && Number.isInteger(id)
  const nationId = (id: unknown) => number(id, 0, w.nations.length - 1) && Number.isInteger(id)
  const cellId = (id: unknown) => number(id, 0, w.cells.length - 1) && Number.isInteger(id)
  const terrain = (v: unknown) =>
    ['water', 'plains', 'forest', 'hills', 'mountains', 'desert', 'tundra'].includes(String(v))
  for (const [i, c] of w.cells.entries()) {
    if (
      !object(c) ||
      c.id !== i ||
      !number(c.x) ||
      !number(c.y) ||
      !number(c.q, 0, 111) ||
      !number(c.r, 0, 71) ||
      !terrain(c.terrain) ||
      !number(c.elevation, -5, 5) ||
      !number(c.moisture, 0, 1) ||
      typeof c.river !== 'boolean'
    )
      fail(`invalid map cell ${i}`)
    if (c.terrain !== 'water' && !regionId(c.region)) fail('land cell without a province')
  }
  const seenCells = new Set<number>()
  for (const [i, r] of w.regions.entries()) {
    if (
      !object(r) ||
      r.id !== i ||
      typeof r.name !== 'string' ||
      !nationId(r.nation) ||
      !nationId(r.culture) ||
      !cellId(r.center) ||
      !terrain(r.terrain) ||
      typeof r.coastal !== 'boolean'
    )
      fail(`invalid province ${i}`)
    if (
      !Array.isArray(r.cells) ||
      !r.cells.length ||
      !r.cells.includes(r.center) ||
      r.cells.some(
        (id) =>
          !cellId(id) || w.cells[id].region !== i || w.cells[id].terrain === 'water' || seenCells.has(id),
      )
    )
      fail(`invalid province geometry ${i}`)
    r.cells.forEach((id) => seenCells.add(id))
    if (!Array.isArray(r.neighbors) || r.neighbors.some((id) => !regionId(id) || id === i))
      fail('invalid province neighbors')
    if (
      !object(r.population) ||
      ['children', 'adults', 'elders'].some((k) => !number(r.population[k as keyof typeof r.population]))
    )
      fail('invalid population cohorts')
    for (const key of ['stocks', 'production', 'consumption', 'prices'] as const)
      if (!object(r[key]) || GOODS.some((g) => !number(r[key][g]))) fail(`invalid ${key}`)
    if (
      !object(r.deposits) ||
      ['timber', 'stone', 'iron', 'coal'].some((g) => !number(r.deposits[g as keyof typeof r.deposits]))
    )
      fail('invalid resource deposits')
    for (const key of [
      'fertility',
      'urban',
      'literacy',
      'health',
      'happiness',
      'infrastructure',
      'industry',
      'foodCoverage',
      'births',
      'deaths',
      'employed',
      'unrest',
      'devastation',
      'gdp',
    ] as const)
      if (!number(r[key])) fail(`invalid province ${key}`)
    if (!number(r.migration, -1e14, 1e14)) fail('invalid migration')
  }
  if (seenCells.size !== w.cells.filter((c) => c.terrain !== 'water').length)
    fail('land missing from province geometry')
  for (const [i, n] of w.nations.entries()) {
    if (
      !object(n) ||
      n.id !== i ||
      !regionId(n.capital) ||
      typeof n.name !== 'string' ||
      typeof n.shortName !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(n.color) ||
      typeof n.government !== 'string' ||
      typeof n.ai !== 'boolean'
    )
      fail(`invalid state ${i}`)
    if (!['mercantile', 'expansionist', 'scholarly', 'agrarian'].includes(n.personality))
      fail('invalid state personality')
    if (
      !object(n.policies) ||
      !['balanced', 'agriculture', 'industry', 'military'].includes(n.policies.priority) ||
      !['open', 'controlled', 'closed'].includes(n.policies.migration)
    )
      fail('invalid government policies')
    for (const key of [
      'tax',
      'welfare',
      'education',
      'military',
      'research',
      'tariff',
      'conscription',
    ] as const)
      if (!number(n.policies[key], 0, 100)) fail('invalid budget policy')
    for (const key of ['technologies', 'researchProgress'] as const)
      if (!object(n[key]) || FIELDS.some((f) => !number(n[key][f], 0, key === 'technologies' ? 6 : 1e14)))
        fail('invalid research')
    if (!FIELDS.includes(n.researchFocus)) fail('invalid research focus')
    if (
      !object(n.budget) ||
      ['welfare', 'education', 'military', 'research', 'administration', 'infrastructure'].some(
        (k) => !number(n.budget[k as keyof typeof n.budget]),
      )
    )
      fail('invalid treasury budget')
    for (const key of [
      'treasury',
      'debt',
      'stability',
      'legitimacy',
      'income',
      'spending',
      'gdp',
      'population',
      'foodCoverage',
      'manpower',
      'casualties',
    ] as const)
      if (!number(n[key])) fail(`invalid state ${key}`)
  }
  if (!Array.isArray(w.relations) || w.relations.length !== (w.nations.length * (w.nations.length - 1)) / 2)
    fail('incomplete diplomacy table')
  const seenRelations = new Set<string>()
  for (const r of w.relations) {
    if (
      !object(r) ||
      !nationId(r.a) ||
      !nationId(r.b) ||
      r.a >= r.b ||
      !['neutral', 'trade', 'alliance', 'war', 'truce'].includes(r.treaty) ||
      !number(r.opinion, -100, 100) ||
      !number(r.warExhaustion) ||
      !number(r.since) ||
      !number(r.grievance)
    )
      fail('invalid diplomatic relationship')
    const key = `${r.a}-${r.b}`
    if (seenRelations.has(key)) fail('duplicate diplomatic relationship')
    seenRelations.add(key)
  }
  if (!Array.isArray(w.armies) || w.armies.length > 500) fail('invalid armies')
  const armyIds = new Set<number>()
  for (const a of w.armies) {
    if (
      !object(a) ||
      !number(a.id) ||
      armyIds.has(a.id) ||
      typeof a.name !== 'string' ||
      !nationId(a.nation) ||
      !regionId(a.region) ||
      (a.target !== null && !regionId(a.target)) ||
      !number(a.soldiers) ||
      !number(a.morale, 0, 1) ||
      !number(a.supply, 0, 1) ||
      !number(a.experience, 0, 1) ||
      !number(a.casualties)
    )
      fail('invalid army')
    armyIds.add(a.id)
  }
  if (!Array.isArray(w.routes) || w.routes.length > 20000) fail('invalid routes')
  for (const r of w.routes)
    if (
      !object(r) ||
      !regionId(r.from) ||
      !regionId(r.to) ||
      !Array.isArray(r.path) ||
      r.path.some((id) => !regionId(id)) ||
      !object(r.goods) ||
      GOODS.some((g) => !number(r.goods[g])) ||
      !number(r.volume) ||
      !number(r.value) ||
      !number(r.capacity) ||
      typeof r.id !== 'string' ||
      typeof r.sea !== 'boolean' ||
      typeof r.international !== 'boolean'
    )
      fail('invalid trade route')
  if (!Array.isArray(w.events) || w.events.length > 240) fail('invalid chronicle')
  for (const e of w.events)
    if (
      !object(e) ||
      !number(e.id) ||
      !number(e.month) ||
      typeof e.title !== 'string' ||
      typeof e.detail !== 'string' ||
      !['war', 'peace', 'economy', 'population', 'research', 'diplomacy', 'world'].includes(e.type) ||
      (e.region !== undefined && !regionId(e.region)) ||
      (e.nation !== undefined && !nationId(e.nation))
    )
      fail('invalid chronicle entry')
  if (!Array.isArray(w.history) || w.history.length > 15000) fail('invalid history')
  for (const h of w.history) {
    if (
      !object(h) ||
      !['month', 'population', 'gdp', 'trade', 'wars', 'food'].every((k) => number(h[k as keyof typeof h])) ||
      !Array.isArray(h.nations) ||
      h.nations.some(
        (n) =>
          !object(n) ||
          !nationId(n.id) ||
          !number(n.population) ||
          !number(n.gdp) ||
          !number(n.territory) ||
          !number(n.treasury),
      )
    )
      fail('invalid history point')
  }
  if (
    !object(w.totals) ||
    ['population', 'gdp', 'trade', 'wars', 'births', 'deaths', 'migration'].some(
      (k) => !number(w.totals[k as keyof typeof w.totals]),
    )
  )
    fail('invalid totals')
  return w
}

export function parseSave(text: string): World {
  if (text.length > 20_000_000)
    throw new Error('This save is too large. Choose an Uchrony save smaller than 20 MB.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON. Choose an exported Uchrony world.')
  }
  return validateWorld(value)
}
