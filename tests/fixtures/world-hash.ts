import { createHash } from 'node:crypto'
/** Hash canonical JSON without constructing a world-sized intermediate string. */
export function canonicalHash(world: object) {
  const hash = createHash('sha256')
  hash.update('{')
  let first = true
  for (const [key, value] of Object.entries(world)) {
    if (value === undefined) continue
    hash.update(`${first ? '' : ','}${JSON.stringify(key)}:`)
    first = false
    if (Array.isArray(value)) {
      hash.update('[')
      value.forEach((entry, i) => hash.update(`${i ? ',' : ''}${JSON.stringify(entry) ?? 'null'}`))
      hash.update(']')
    } else hash.update(JSON.stringify(value))
  }
  return hash.update('}').digest('hex')
}
