import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js'
import type { World } from './types'
import { packWorldCensus, unpackWorldCensus } from './census-codec'

const FORMAT = 'district-blocks-v1'
const LIMIT = 512 * 1024 * 1024 - 1024
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
export function packWorldSave(world: World): unknown {
  if (!world.localEconomy) return world
  const packed = packWorldCensus(world) as Record<string, unknown>
  return {
    ...packed,
    regions: (packed.regions as unknown[]).map(encodeSaveBlock),
    economy: encodeSaveBlock(packed.economy),
    localEconomy: encodeSaveBlock(packed.localEconomy),
    worldEncoding: FORMAT,
  }
}
export function unpackWorldSave(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  if (source.worldEncoding === undefined) return unpackWorldCensus(value)
  if (source.worldEncoding !== FORMAT || !Array.isArray(source.regions) || source.regions.length > 4096)
    throw new Error('Unsupported compressed world')
  const { worldEncoding: _encoding, ...packed } = source
  return unpackWorldCensus({
    ...packed,
    regions: source.regions.map(decodeSaveBlock),
    economy: decodeSaveBlock(source.economy),
    localEconomy: decodeSaveBlock(source.localEconomy),
  })
}
