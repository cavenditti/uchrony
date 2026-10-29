import { PLACE_KINDS, type Almanac } from './almanac-types'
import { isWritingTask } from './model-tasks'
import { integerAtMost, recordValue, textValidator, validationFailure } from './persistence-primitives'
import type { World } from './types'
/** Untrusted imports cannot install settings, executable prompts or dangling evidence. */
export function validateAlmanac(w: World, value: unknown) {
  const a = value as Almanac
  const fail = validationFailure('Invalid world save: invalid atlas or historical archive')
  const object = recordValue
  const text = textValidator(3000, 0)
  const integer = integerAtMost(w.month, true)
  const ids = (x: unknown, max = 200000): x is string[] =>
    Array.isArray(x) &&
    x.length <= max &&
    x.every((id) => text(id, 150) && !/^(?:__proto__|constructor|prototype)$/.test(id))
  if (
    !object(a) ||
    a.version !== 1 ||
    typeof a.initialized !== 'boolean' ||
    !integer(a.since) ||
    !Number.isInteger(a.lastMonth) ||
    a.lastMonth < -1 ||
    a.lastMonth > w.month ||
    !integer(a.revision, 1e12) ||
    !object(a.entries) ||
    !object(a.facts) ||
    !object(a.languages) ||
    Object.keys(a.entries).length > 200000 ||
    Object.keys(a.facts).length > 1000000 ||
    Object.keys(a.languages).length > 4096
  )
    fail()
  for (const [id, p] of Object.entries(a.entries)) {
    if (
      !object(p) ||
      p.id !== id ||
      !text(id, 150) ||
      !id.includes(':') ||
      !PLACE_KINDS.includes(p.kind) ||
      !text(p.name, 180) ||
      !integer(p.cell, w.cells.length - 1) ||
      (p.located !== undefined && typeof p.located !== 'boolean') ||
      !integer(p.since) ||
      !integer(p.language, 4096) ||
      !integer(p.revision, 1e12) ||
      !['pending', 'model', 'established'].includes(p.naming) ||
      (p.nameModel !== undefined && !text(p.nameModel, 160)) ||
      !Array.isArray(p.regions) ||
      p.regions.some((id) => !integer(id, w.regions.length - 1)) ||
      !ids(p.related) ||
      !ids(p.facts) ||
      !object(p.attributes) ||
      Object.keys(p.attributes).length > 32 ||
      Object.values(p.attributes).some(
        (v) => typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v)) && !text(v, 300),
      ) ||
      !Array.isArray(p.names) ||
      p.names.length > 10000 ||
      !Array.isArray(p.accounts) ||
      p.accounts.length > 20
    )
      fail()
    if (
      p.milestones !== undefined &&
      (!object(p.milestones) ||
        Object.keys(p.milestones).length > 32 ||
        Object.values(p.milestones).some(
          (v) => typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v)) && !text(v, 300),
        ))
    )
      fail()
    if (
      p.geometry !== undefined &&
      (!Array.isArray(p.geometry) ||
        p.geometry.length > w.cells.length ||
        p.geometry.some((id) => !integer(id, w.cells.length - 1)))
    )
      fail()
    for (const n of p.names)
      if (
        !object(n) ||
        !text(n.name, 180) ||
        !integer(n.month) ||
        !integer(n.language, 4096) ||
        !['former', 'alternative'].includes(n.kind) ||
        !text(n.reason, 500)
      )
        fail()
    for (const account of p.accounts)
      if (
        !object(account) ||
        !isWritingTask(account.task) ||
        !text(account.title, 150) ||
        !text(account.text, 3000) ||
        !text(account.model, 160) ||
        !integer(account.month) ||
        !integer(account.asOf) ||
        account.asOf > account.month ||
        !ids(account.sources, 32) ||
        account.sources.some((id) => !Object.hasOwn(a.facts, id)) ||
        !['interpretation', 'tradition'].includes(account.status) ||
        (account.task === 'tradition') !== (account.status === 'tradition') ||
        (account.question !== undefined && !text(account.question, 500))
      )
        fail()
    if (p.facts.some((id) => !Object.hasOwn(a.facts, id))) fail()
    // Related province IDs can predate administrative initialization, but never reference an unknown entry in a complete registry.
    if (a.initialized && p.related.some((id) => !Object.hasOwn(a.entries, id))) fail()
  }
  for (const [id, f] of Object.entries(a.facts)) {
    if (
      !object(f) ||
      f.id !== id ||
      !text(id, 150) ||
      !integer(f.month) ||
      !text(f.title, 500) ||
      !text(f.detail, 5000) ||
      !ids(f.places, 64) ||
      !['recorded', 'initial', 'legacy'].includes(f.source) ||
      (f.event !== undefined && !integer(f.event, 1e12))
    )
      fail()
    if (a.initialized && f.places.some((id) => !Object.hasOwn(a.entries, id))) fail()
  }
  for (const [id, t] of Object.entries(a.languages))
    if (
      !object(t) ||
      String(t.language) !== id ||
      !integer(t.language, 4096) ||
      !Array.isArray(t.roots) ||
      t.roots.length < 4 ||
      t.roots.length > 24 ||
      t.roots.some((x) => !text(x, 20)) ||
      !Array.isArray(t.endings) ||
      t.endings.length < 3 ||
      t.endings.length > 16 ||
      t.endings.some((x) => !text(x, 20)) ||
      !text(t.convention, 500) ||
      !text(t.demonym, 80) ||
      !text(t.model, 160)
    )
      fail()
}
