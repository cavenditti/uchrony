import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'three/examples/jsm/libs/fflate.module.js'
import type { AdaptiveWorld } from './adaptive-types'
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
  commuting: true,
  commutingRows: true,
  commuteRoutes: true,
  boundaries: true,
}
const ADAPTIVE_RECORDS = new Set(['sites', 'jurisdictions', 'commuteRoutes'])
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
  legacyOrder = false,
): Record<string, unknown> {
  const object = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === 'object' && !Array.isArray(x)
  if (
    !value ||
    (!legacyOrder && !Array.isArray(value.keys)) ||
    (value.keys !== undefined &&
      (!Array.isArray(value.keys) ||
        value.keys.some((k) => typeof k !== 'string') ||
        new Set(value.keys).size !== value.keys.length)) ||
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
  // Adaptive v1 stored an optional key order and always emitted empty optional
  // tables. Retain that wire contract while using the same bounded decoder.
  if (legacyOrder)
    return value.keys
      ? Object.fromEntries(value.keys.map((key) => [key, fields.get(key)]))
      : Object.fromEntries(fields)
  if (fields.size !== value.keys.length || value.keys.some((key) => !fields.has(key)))
    throw new Error('Invalid economic save key order')
  return Object.fromEntries(value.keys.map((key) => [key, fields.get(key)]))
}
/** Preserve adaptive-blocks-v1 on disk; only its internal table codec is shared. */
function packAdaptive(value: AdaptiveWorld) {
  const section = packSection(value as unknown as Record<string, unknown>, ADAPTIVE_TABLES, 4096)
  return {
    encoding: 'adaptive-blocks-v1',
    keys: Object.keys(value),
    core: section.core,
    ...Object.fromEntries(
      Object.keys(ADAPTIVE_TABLES).map((key) => [
        key,
        (section.fields[key] as Table | undefined)?.blocks ?? [],
      ]),
    ),
  }
}
function unpackAdaptive(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('encoding' in value)) return value
  const source = value as Record<string, unknown>
  if (source.encoding !== 'adaptive-blocks-v1') throw new Error('Unsupported adaptive save encoding')
  const fields = Object.fromEntries(
    Object.keys(ADAPTIVE_TABLES).map((key) => [
      key,
      {
        kind: ADAPTIVE_RECORDS.has(key) ? 'record' : 'array',
        blocks: key === 'commutingRows' ? (source[key] ?? []) : source[key],
      },
    ]),
  )
  return unpackSection(
    { keys: source.keys, core: source.core, fields } as Section,
    ADAPTIVE_TABLES,
    { bytes: 0 },
    4096,
    true,
  )
}
export function packWorldSave(world: World): unknown {
  if (!world.localEconomy) return world
  const packed = packWorldCensus(world) as Record<string, unknown>
  return {
    ...packed,
    ...(world.adaptive ? { adaptive: packAdaptive(world.adaptive) } : {}),
    regions: (packed.regions as unknown[]).map(encodeSaveBlock),
    economy: packSection(packed.economy as Record<string, unknown>, ECONOMY_TABLES),
    localEconomy: packSection(packed.localEconomy as Record<string, unknown>, LOCAL_TABLES),
    worldEncoding: FORMAT,
  }
}
export function unpackWorldSave(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  if (source.worldEncoding === undefined) return unpackWorldCensus(value)
  if (
    ![FORMAT, 'district-blocks-v1'].includes(String(source.worldEncoding)) ||
    !Array.isArray(source.regions) ||
    source.regions.length > 4096
  )
    throw new Error('Unsupported compressed world')
  const { worldEncoding: _encoding, ...packed } = source
  return unpackWorldCensus({
    ...packed,
    ...(source.adaptive ? { adaptive: unpackAdaptive(source.adaptive) } : {}),
    regions: source.regions.map(decodeSaveBlock),
    economy:
      source.worldEncoding === FORMAT
        ? unpackSection(source.economy as Section, ECONOMY_TABLES)
        : decodeSaveBlock(source.economy),
    localEconomy:
      source.worldEncoding === FORMAT
        ? unpackSection(source.localEconomy as Section, LOCAL_TABLES)
        : decodeSaveBlock(source.localEconomy),
  })
}
