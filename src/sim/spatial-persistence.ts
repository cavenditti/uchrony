import type { World } from './types'

export function validateSpatial(w: World) {
  const fail = (): never => {
    throw new Error('Invalid world save: invalid spatial districts or settlements')
  }
  const finite = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1e14
  for (const c of w.cells)
    if (c.landscape !== undefined) {
      const s = c.landscape
      if (
        !s ||
        !finite(s.habitat) ||
        s.habitat > 1 ||
        !finite(s.attraction) ||
        s.attraction > 1 ||
        !s.resources ||
        ['timber', 'stone', 'iron', 'coal'].some((g) => !finite(s.resources[g as keyof typeof s.resources]))
      )
        fail()
    }
  const s = w.spatial
  if (!s) return // Older saves gain spatial detail on their next tick.
  if (
    s.version !== 1 ||
    !Number.isInteger(s.month) ||
    s.month < 0 ||
    s.month > w.month ||
    !Array.isArray(s.splits) ||
    !Array.isArray(s.settlements) ||
    !Array.isArray(s.districts) ||
    s.districts.length > w.cells.length ||
    s.settlements.length >
      (w.adaptive?.residentialVersion === 1
        ? Object.keys(w.adaptive.sites).length
        : w.localEconomy
          ? w.cells.length
          : w.regions.length * 8) ||
    s.splits.length > w.cells.length * 2
  )
    fail()
  const rootSpan = 2 ** Math.ceil(Math.log2(Math.max(w.width, w.height)))
  const maxDepth = Math.log2(rootSpan)
  const validNode = (node: unknown): node is string =>
    typeof node === 'string' && /^r[0-3]*$/.test(node) && node.length <= maxDepth + 1
  const splits = new Set(s.splits)
  if (
    splits.size !== s.splits.length ||
    s.splits.some(
      (node) =>
        !validNode(node) || node.length > maxDepth || (node.length > 1 && !splits.has(node.slice(0, -1))),
    )
  )
    fail()
  const seen = new Set<number>(),
    ids = new Set<string>(),
    urban = w.regions.map(() => 0)
  for (const d of s.districts) {
    if (
      !d ||
      !validNode(d.node) ||
      splits.has(d.node) ||
      (d.node.length > 1 && !splits.has(d.node.slice(0, -1))) ||
      d.span !== rootSpan / 2 ** (d.node.length - 1) ||
      !Number.isInteger(d.region) ||
      !w.regions[d.region] ||
      typeof d.id !== 'string' ||
      ids.has(d.id) ||
      !Array.isArray(d.cells) ||
      !d.cells.length ||
      !Number.isSafeInteger(d.population) ||
      !finite(d.population) ||
      !Number.isSafeInteger(d.urbanPopulation) ||
      !finite(d.urbanPopulation) ||
      d.urbanPopulation > d.population ||
      !finite(d.industrialEmployment) ||
      !finite(d.capital)
    )
      fail()
    ids.add(d.id)
    let x = 0,
      y = 0,
      span = rootSpan
    for (const digit of d.node.slice(1)) {
      span /= 2
      x += (+digit % 2) * span
      y += Math.floor(+digit / 2) * span
    }
    for (const id of d.cells) {
      const c = w.cells[id]
      if (
        !Number.isInteger(id) ||
        !c ||
        c.terrain === 'water' ||
        c.region !== d.region ||
        seen.has(id) ||
        c.q < x ||
        c.q >= x + span ||
        c.r < y ||
        c.r >= y + span
      )
        fail()
      seen.add(id)
    }
    urban[d.region] += d.urbanPopulation
  }
  if (seen.size !== w.cells.filter((c) => c.terrain !== 'water').length) fail()
  const sites = new Set<number>(),
    names = new Set<string>()
  for (const p of s.settlements) {
    if (
      !p ||
      typeof p.id !== 'string' ||
      names.has(p.id) ||
      typeof p.name !== 'string' ||
      !Number.isInteger(p.cell) ||
      !w.cells[p.cell] ||
      w.cells[p.cell].region !== p.region ||
      (sites.has(p.cell) && !p.nucleusSite) ||
      !Number.isInteger(p.region) ||
      !w.regions[p.region] ||
      !['city', 'town', 'village'].includes(p.kind) ||
      !finite(p.population) ||
      !Number.isSafeInteger(p.population) ||
      typeof p.capital !== 'boolean'
    )
      fail()
    names.add(p.id)
    sites.add(p.cell)
    urban[p.region] -= p.population
  }
  if (!w.adaptive && (w.localEconomy ? urban.reduce((a, b) => a + b, 0) !== 0 : urban.some((x) => x !== 0)))
    fail()
  if (w.adaptive) {
    for (const settlement of s.settlements) {
      if (settlement.id.startsWith('municipality:')) {
        // Read old exports without erasing any state; spatialState supplies the
        // corrected view and the next monthly refresh stores physical cities.
        const j = w.adaptive.jurisdictions[settlement.id]
        if (!j || j.retired !== undefined || j.level !== 'municipality' || j.seat !== settlement.cell) fail()
      } else {
        const city = w.localEconomy?.cities.find((c) => `city:${c.id}` === settlement.id)
        if (
          !city ||
          city.absorbedBy !== undefined ||
          city.nucleus !== settlement.cell ||
          city.population !== settlement.population ||
          city.cells.length !== settlement.cells?.length ||
          city.cells.some((c, i) => c !== settlement.cells![i])
        )
          fail()
        if (city!.sites) {
          const site = w.adaptive.sites[city!.nucleusSite!]
          if (
            !site ||
            settlement.nucleusSite !== city!.nucleusSite ||
            settlement.siteIds?.length !== city!.sites.length ||
            city!.sites.some((id, i) => id !== settlement.siteIds![i]) ||
            settlement.position?.x !== site.x ||
            settlement.position?.y !== site.y
          )
            fail()
        }
      }
    }
  }
}
