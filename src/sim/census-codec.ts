import type { BirthCohort } from './population-types'
import type { World } from './types'

const PREFIX = 'cohorts-v1:'
import { MAX_CENSUS_BINS as MAX_BINS } from './simulation-invariants'

/** Lossless delta/varint wire representation. The simulation still uses exact dated tuples. */
export function encodeCohorts(bins: BirthCohort[]): string {
  if (bins.length > MAX_BINS) throw new Error('Too many dated cohorts to encode')
  const bytes: number[] = []
  const put = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid dated cohort integer')
    while (value >= 128) {
      bytes.push((value % 128) + 128)
      value = Math.floor(value / 128)
    }
    bytes.push(value)
  }
  put(bins.length)
  let previous = 0
  for (const [born, female, male] of bins) {
    const delta = born - previous
    put(delta < 0 ? -delta * 2 - 1 : delta * 2)
    put(female)
    put(male)
    previous = born
  }
  return PREFIX + btoa(bytes.map((byte) => String.fromCharCode(byte)).join(''))
}
export function decodeCohorts(value: string): BirthCohort[] {
  if (!value.startsWith(PREFIX) || value.length > MAX_BINS * 32) throw new Error('Invalid packed census')
  const raw = atob(value.slice(PREFIX.length))
  let at = 0
  const get = () => {
    let value = 0,
      factor = 1
    for (let i = 0; i < 8; i++) {
      if (at >= raw.length) throw new Error('Truncated packed census')
      const byte = raw.charCodeAt(at++)
      value += (byte % 128) * factor
      if (!Number.isSafeInteger(value)) throw new Error('Packed census integer overflow')
      if (byte < 128) return value
      factor *= 128
    }
    throw new Error('Packed census integer overflow')
  }
  const count = get(),
    result: BirthCohort[] = []
  if (count > MAX_BINS) throw new Error('Too many packed dated cohorts')
  let born = 0
  for (let i = 0; i < count; i++) {
    const delta = get()
    born += delta % 2 ? -(delta + 1) / 2 : delta / 2
    result.push([born, get(), get()])
  }
  if (at !== raw.length) throw new Error('Trailing packed census data')
  return result
}

/** Repeated community field names are stored once per schema. Tuple values and
 * original field order are preserved, so this changes bytes, never the census. */
function transformCensus(value: unknown, pack: boolean): unknown {
  if (!value || typeof value !== 'object') return value
  const w = value as World,
    source = value as Record<string, unknown>
  if (pack && !w.localEconomy) return value
  const encoding = source.censusEncoding as { version: number; schemas: string[][] } | undefined
  if (
    !pack &&
    encoding !== undefined &&
    (!encoding ||
      encoding.version !== 1 ||
      !Array.isArray(encoding.schemas) ||
      encoding.schemas.length > 256 ||
      encoding.schemas.some(
        (keys) =>
          !Array.isArray(keys) ||
          keys.length > 64 ||
          new Set(keys).size !== keys.length ||
          keys.some((key) => typeof key !== 'string' || key.length > 100),
      ))
  )
    throw new Error('Invalid census field encoding')
  const schemas: string[][] = [],
    index = new Map<string, number>()
  const holders = (list: unknown) => {
    if (!Array.isArray(list)) return list
    let changed = false
    const result = list.map((holder) => {
      if (!holder || !Array.isArray(holder.communities)) return holder
      let modified = false
      const communities = holder.communities.map((original: Record<string, unknown> | unknown[]) => {
        if (!original || typeof original !== 'object') return original
        let group = original as Record<string, unknown>
        if (!pack && Array.isArray(original)) {
          const id = original[0]
          if (
            !encoding ||
            !Number.isSafeInteger(id) ||
            typeof id !== 'number' ||
            !encoding.schemas[id] ||
            original.length !== encoding.schemas[id].length + 1
          )
            throw new Error('Invalid packed community')
          group = Object.fromEntries(encoding.schemas[id].map((key, i) => [key, original[i + 1]]))
          modified = true
        }
        if (pack) {
          const keys = Object.keys(group),
            signature = JSON.stringify(keys)
          let id = index.get(signature)
          if (id === undefined) {
            id = schemas.length
            schemas.push(keys)
            index.set(signature, id)
          }
          modified = true
          return [
            id,
            ...keys.map((key) =>
              key === 'ageCohorts' && Array.isArray(group[key])
                ? encodeCohorts(group[key] as BirthCohort[])
                : group[key],
            ),
          ]
        }
        if (typeof group.ageCohorts === 'string') {
          modified = true
          return { ...group, ageCohorts: decodeCohorts(group.ageCohorts) }
        }
        return group
      })
      if (!modified) return holder
      changed = true
      return { ...holder, communities }
    })
    return changed ? result : list
  }
  const regions = holders(w.regions),
    armies = holders(w.armies),
    fleets = holders(w.warfare?.fleets),
    expeditions = holders(w.overseas?.expeditions)
  if (
    regions === w.regions &&
    armies === w.armies &&
    fleets === w.warfare?.fleets &&
    expeditions === w.overseas?.expeditions &&
    !encoding
  )
    return value
  const { censusEncoding: _encoding, ...base } = source
  return {
    ...base,
    regions,
    armies,
    ...(w.overseas ? { overseas: { ...w.overseas, expeditions } } : {}),
    ...(w.warfare ? { warfare: { ...w.warfare, fleets } } : {}),
    ...(pack ? { censusEncoding: { version: 1, schemas } } : {}),
  }
}
export const packWorldCensus = (world: World): unknown => transformCensus(world, true)
export const unpackWorldCensus = (value: unknown): unknown => transformCensus(value, false)
