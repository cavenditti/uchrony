import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'three/examples/jsm/libs/fflate.module.js'
import { assertWorldVersion } from './save-version'
import { packWorldCensus, unpackWorldCensus } from './census-codec'
import { MAX_ENCODED_SAVE_BYTES as LIMIT } from './simulation-invariants'
import type { World } from './types'

const FORMAT = 'district-blocks-v2'
interface Block {
  bytes: number
  data: string
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  return (crc ^ 0xffffffff) >>> 0
}
/** Independent gzip blocks avoid an enormous intermediate world string. */
export function encodeSaveBlock(value: unknown): Block {
  const bytes = strToU8(JSON.stringify(value))
  if (bytes.length > LIMIT) throw new Error('A save block exceeds the supported size')
  return { bytes: bytes.length, data: btoa(strFromU8(gzipSync(bytes, { level: 1, mtime: 0 }), true)) }
}
export function decodeSaveBlock(value: unknown): unknown {
  const b = value as Block
  if (
    !b ||
    !Number.isSafeInteger(b.bytes) ||
    b.bytes < 1 ||
    b.bytes > LIMIT ||
    typeof b.data !== 'string' ||
    b.data.length > LIMIT
  )
    throw new Error('Invalid compressed save block')
  const bytes = strToU8(atob(b.data), true)
  if (bytes.length < 18) throw new Error('Truncated compressed save block')
  const footer = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8)
  if (footer.getUint32(4, true) !== b.bytes) throw new Error('Compressed save length mismatch')
  const decoded = gunzipSync(bytes, { out: new Uint8Array(b.bytes) })
  if (decoded.length !== b.bytes || crc32(decoded) !== footer.getUint32(0, true))
    throw new Error('Compressed save checksum mismatch')
  return JSON.parse(strFromU8(decoded))
}
type Layout = { [key: string]: true | Layout }
const ECONOMY_TABLES: Layout = {
  households: true,
  producers: true,
  firms: true,
  inventoryPrices: true,
  credit: { loans: true },
  banking: { accounts: true },
  ledger: { opening: true, net: true, entries: true },
  accounts: { businesses: true, stores: true },
}
const ADAPTIVE_TABLES: Layout = {
  sites: true,
  jurisdictions: true,
  commutingRows: true,
  commuteRoutes: true,
  boundaries: true,
}
const LOCAL_TABLES: Layout = { units: true, built: true, reserves: true, shipments: true }
interface Table {
  kind: 'array' | 'record'
  blocks: Block[]
}
interface Section {
  keys: string[]
  core: Block
  fields: Record<string, Table | Section>
}
/** Bound transient JSON/UTF-8/compression buffers instead of encoding an entire
 * economic registry at once. Every record and its original key order survives. */
function packSection(value: Record<string, unknown>, layout: Layout, blockSize = 256): Section {
  const core: [string, unknown][] = [],
    fields: [string, Table | Section][] = []
  const keys = Object.keys(value).filter((key) => value[key] !== undefined)
  for (const key of keys) {
    const entry = value[key],
      rule = Object.hasOwn(layout, key) ? layout[key] : undefined
    if (!rule || !entry || typeof entry !== 'object') {
      core.push([key, entry])
      continue
    }
    if (rule !== true) {
      fields.push([key, packSection(entry as Record<string, unknown>, rule, blockSize)])
      continue
    }
    const array = Array.isArray(entry),
      records = array ? entry : Object.entries(entry)
    const encoded: Block[] = []
    for (let i = 0; i < records.length; i += blockSize)
      encoded.push(encodeSaveBlock(records.slice(i, i + blockSize)))
    fields.push([key, { kind: array ? 'array' : 'record', blocks: encoded }])
  }
  return { keys, core: encodeSaveBlock(Object.fromEntries(core)), fields: Object.fromEntries(fields) }
}
function unpackSection(
  value: Section,
  layout: Layout,
  budget = { bytes: 0 },
  blockSize = 256,
): Record<string, unknown> {
  const object = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === 'object' && !Array.isArray(x)
  if (
    !value ||
    !Array.isArray(value.keys) ||
    value.keys.some((k) => typeof k !== 'string') ||
    new Set(value.keys).size !== value.keys.length ||
    !object(value.fields)
  )
    throw new Error('Invalid economic save section')
  const decode = (block: Block) => {
    budget.bytes += block?.bytes
    if (!Number.isSafeInteger(budget.bytes) || budget.bytes > LIMIT)
      throw new Error('Economic save expansion exceeds the supported size')
    return decodeSaveBlock(block)
  }
  const core = decode(value.core)
  if (!object(core)) throw new Error('Invalid economic save core')
  const fields = new Map(Object.entries(core))
  for (const [key, entry] of Object.entries(value.fields)) {
    const rule = Object.hasOwn(layout, key) ? layout[key] : undefined
    if (!rule || fields.has(key)) throw new Error('Invalid economic save field')
    if (rule !== true) {
      fields.set(key, unpackSection(entry as Section, rule, budget, blockSize))
      continue
    }
    const table = entry as Table
    if (!table || !['array', 'record'].includes(table.kind) || !Array.isArray(table.blocks))
      throw new Error('Invalid economic save table')
    const rows: unknown[] = []
    for (const block of table.blocks) {
      const decoded = decode(block)
      if (!Array.isArray(decoded) || decoded.length > blockSize)
        throw new Error('Invalid economic save block')
      rows.push(...decoded)
    }
    if (table.kind === 'array') fields.set(key, rows)
    else {
      const pairs = rows as [string, unknown][]
      if (
        pairs.some((row) => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string') ||
        new Set(pairs.map(([key]) => key)).size !== pairs.length
      )
        throw new Error('Invalid economic record identities')
      fields.set(key, Object.fromEntries(pairs))
    }
  }
  if (fields.size !== value.keys.length || value.keys.some((key) => !fields.has(key)))
    throw new Error('Invalid economic save key order')
  return Object.fromEntries(value.keys.map((key) => [key, fields.get(key)]))
}
function unpackAdaptive(value: unknown): unknown {
  const section = value as Section & { encoding?: unknown }
  if (section.encoding !== 'adaptive-blocks-v2') throw new Error('Unsupported adaptive save encoding')
  return unpackSection(section, ADAPTIVE_TABLES, { bytes: 0 }, 4096)
}

/** Historical registries have independent bounded blocks, including at month zero. */
function packHistoricalSections(world: World) {
  return {
    ...(world.archive
      ? {
          archive: {
            encoding: 'atlas-blocks-v1',
            ...packSection(world.archive as unknown as Record<string, unknown>, { frames: true }, 120),
          },
        }
      : {}),
    ...(world.institutions
      ? {
          institutions: {
            encoding: 'institutions-blocks-v1',
            nextId: world.institutions.nextId,
            organizations: world.institutions.organizations.map((o) =>
              packSection(o as unknown as Record<string, unknown>, { events: true, calls: true }, 120),
            ),
          },
        }
      : {}),
  }
}
function unpackHistoricalSections(source: Record<string, unknown>) {
  const result: Record<string, unknown> = {},
    budget = { bytes: 0 }
  for (const key of ['archive', 'institutions']) {
    const value = source[key] as Record<string, unknown> | undefined
    if (!value || !('encoding' in value)) continue
    if (key === 'archive' && value.encoding === 'atlas-blocks-v1')
      result.archive = unpackSection(value as unknown as Section, { frames: true }, budget, 120)
    else if (
      key === 'institutions' &&
      value.encoding === 'institutions-blocks-v1' &&
      Array.isArray(value.organizations)
    )
      result.institutions = {
        nextId: value.nextId,
        organizations: value.organizations.map((o) =>
          unpackSection(o as Section, { events: true, calls: true }, budget, 120),
        ),
      }
    else throw new Error('Unsupported historical save encoding')
  }
  return result
}
/** Encode large registries with bounded buffers and preserve record order exactly. */
export function packWorldSave(world: World): unknown {
  const historical = packHistoricalSections(world)
  if (!world.localEconomy) return Object.keys(historical).length ? { ...world, ...historical } : world
  const packed = packWorldCensus(world) as Record<string, unknown>
  return {
    ...packed,
    ...(world.adaptive
      ? {
          adaptive: {
            encoding: 'adaptive-blocks-v2',
            ...packSection(world.adaptive as unknown as Record<string, unknown>, ADAPTIVE_TABLES, 4096),
          },
        }
      : {}),
    ...historical,
    regions: (packed.regions as unknown[]).map(encodeSaveBlock),
    economy: packSection(packed.economy as Record<string, unknown>, ECONOMY_TABLES),
    localEconomy: packSection(packed.localEconomy as Record<string, unknown>, LOCAL_TABLES),
    worldEncoding: FORMAT,
  }
}
/** Decode only the current wire format; semantic validation follows expansion. */
export function unpackWorldSave(value: unknown): unknown {
  assertWorldVersion(value)
  const source = value as Record<string, unknown>
  if (source.worldEncoding === undefined)
    return unpackWorldCensus({ ...source, ...unpackHistoricalSections(source) })
  if (source.worldEncoding !== FORMAT || !Array.isArray(source.regions) || source.regions.length > 4096)
    throw new Error('Unsupported compressed world')
  const { worldEncoding: _encoding, ...packed } = source
  return unpackWorldCensus({
    ...packed,
    ...(source.adaptive ? { adaptive: unpackAdaptive(source.adaptive) } : {}),
    ...unpackHistoricalSections(source),
    regions: source.regions.map(decodeSaveBlock),
    economy: unpackSection(source.economy as Section, ECONOMY_TABLES),
    localEconomy: unpackSection(source.localEconomy as Section, LOCAL_TABLES),
  })
}
