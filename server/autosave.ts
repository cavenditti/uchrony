import { UnsupportedSaveError } from '../src/sim/save-version'
import { packWorldSave } from '../src/sim/save-codec'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { restoreWorld } from '../src/sim/persistence'
import { MAX_SAVE_BYTES, type WorldSave } from '../src/storage/save-types'
const validSlot = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const checksum = (save: { world: unknown }) =>
  createHash('sha256').update(JSON.stringify(save.world)).digest('hex')
export function validateSaveRecord(value: unknown): WorldSave {
  const record = value as WorldSave
  if (
    !record ||
    record.version !== 1 ||
    !Number.isSafeInteger(record.savedAt) ||
    record.savedAt < 0 ||
    record.savedAt > Date.now() + 60000
  )
    throw new Error('Invalid autosave envelope.')
  return { ...record, world: restoreWorld(record.world) }
}
export class DiskAutosaves {
  private queues = new Map<string, Promise<void>>()
  private verified = new Map<string, { fingerprint: string }>()
  private async fingerprint(path: string) {
    const info = await stat(path)
    return `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
  }
  private async verifiedCurrent(path: string) {
    try {
      const signature = await this.fingerprint(path)
      const cached = this.verified.get(path)
      if (cached?.fingerprint === signature) return cached
      const saved = await this.readFile(path)
      if (!saved) return null
      const verified = { fingerprint: signature }
      this.verified.set(path, verified)
      return verified
    } catch {
      return null
    }
  }
  constructor(readonly root: string) {}
  private path(slot: string, previous = false) {
    if (!validSlot(slot)) throw new Error('Invalid save slot.')
    return join(this.root, `${slot}${previous ? '.previous' : ''}.json`)
  }
  private async readFile(path: string) {
    try {
      if ((await stat(path)).size > MAX_SAVE_BYTES + 1024)
        throw new Error('Autosave exceeds the supported size.')
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      if (parsed.checksum !== checksum(parsed)) throw new Error('Autosave checksum does not match.')
      const save = validateSaveRecord(parsed)
      return {
        version: save.version,
        savedAt: save.savedAt,
        world: save.world,
        encoded: parsed.world as unknown,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  read(slot: string): Promise<{ save: WorldSave | null; recovered: boolean }>
  read(slot: string, encoded: true): Promise<{ save: WorldSave<unknown> | null; recovered: boolean }>
  async read(
    slot: string,
    encoded = false,
  ): Promise<{ save: WorldSave<unknown> | null; recovered: boolean }> {
    const output = (value: NonNullable<Awaited<ReturnType<DiskAutosaves['readFile']>>>) => ({
      version: value.version,
      savedAt: value.savedAt,
      world: encoded ? value.encoded : value.world,
    })
    let failure: unknown
    try {
      const save = await this.readFile(this.path(slot))
      if (save) return { save: output(save), recovered: false }
    } catch (error) {
      failure = error
    }
    const previous = await this.readFile(this.path(slot, true))
    if (previous) return { save: output(previous), recovered: true }
    if (failure instanceof UnsupportedSaveError) throw failure
    if (failure) throw new Error('The saved files could not be restored. They have been kept for recovery.')
    return { save: null, recovered: false }
  }
  async write(slot: string, value: WorldSave<unknown>) {
    const save = validateSaveRecord(value),
      current = this.path(slot),
      backup = this.path(slot, true)
    // The worker already compressed this immutable snapshot. Decode and validate
    // above, but retain its original encoding instead of compressing it twice.
    const encoded = value.world && typeof value.world === 'object' && 'worldEncoding' in value.world
    const packed = { ...save, world: encoded ? value.world : packWorldSave(save.world) }
    const data = JSON.stringify({ ...packed, checksum: checksum(packed) })
    if (Buffer.byteLength(data) > MAX_SAVE_BYTES) throw new Error('Autosave exceeds the supported size.')
    const previous = this.queues.get(slot) ?? Promise.resolve()
    const task = previous
      .catch(() => {})
      .then(async () => {
        await mkdir(this.root, { recursive: true, mode: 0o700 })
        const temporary = `${current}.${randomUUID()}.tmp`,
          backupTemporary = `${backup}.${randomUUID()}.tmp`
        try {
          const file = await open(temporary, 'wx', 0o600)
          try {
            await file.writeFile(data, 'utf8')
            await file.sync()
          } finally {
            await file.close()
          }
          // Never replace a good backup with an unreadable current file.
          const prior = await this.verifiedCurrent(current)
          if (prior) {
            await copyFile(current, backupTemporary)
            await rename(backupTemporary, backup)
          }
          await rename(temporary, current)
          this.verified.set(current, {
            fingerprint: await this.fingerprint(current),
          })
          const directory = await open(this.root, 'r')
          try {
            await directory.sync()
          } finally {
            await directory.close()
          }
        } finally {
          await unlink(temporary).catch(() => {})
          await unlink(backupTemporary).catch(() => {})
        }
      })
    this.queues.set(slot, task)
    try {
      await task
    } finally {
      if (this.queues.get(slot) === task) this.queues.delete(slot)
    }
  }
}

export function autosaveMiddleware(root: string, onError: (error: unknown) => void = () => {}) {
  const store = new DiskAutosaves(root)
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.split('?')[0] !== '/api/saves/current') {
      next()
      return
    }
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Cross-Origin-Resource-Policy': 'same-origin',
        Vary: 'Cookie',
      })
      res.end(JSON.stringify(body))
    }
    try {
      const origin = req.headers.origin
      if (
        (origin && new URL(origin).host !== req.headers.host) ||
        req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.method !== 'GET' && !origin)
      ) {
        reply(403, { error: 'Autosaves require the simulator origin.' })
        return
      }
      if (!['GET', 'PUT'].includes(req.method ?? '')) {
        reply(405, { error: 'Use GET or PUT for autosaves.' })
        return
      }
      const cookie = req.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('uchrony_save_slot='))
        ?.slice('uchrony_save_slot='.length)
      const provided = req.headers['x-uchrony-save-slot'],
        requested = typeof provided === 'string' ? provided : cookie
      const slot = requested && validSlot(requested) ? requested : randomUUID()
      res.setHeader(
        'Set-Cookie',
        `uchrony_save_slot=${slot}; Path=/api/saves; HttpOnly; SameSite=Strict; Max-Age=31536000`,
      )
      if (req.method === 'GET') {
        // Validation still runs; return the verified encoded representation without recompressing it.
        const result = await store.read(slot, true)
        reply(200, {
          ...result,
          save: result.save,
          slot,
        })
        return
      }
      let size = 0
      const chunks: Buffer[] = []
      for await (const part of req) {
        const chunk = Buffer.from(part)
        size += chunk.length
        if (size > MAX_SAVE_BYTES) {
          reply(413, { error: 'The autosave exceeds the supported size.' })
          return
        }
        chunks.push(chunk)
      }
      const save = JSON.parse(Buffer.concat(chunks).toString('utf8')) as WorldSave
      await store.write(slot, save)
      reply(200, { savedAt: save.savedAt, slot })
    } catch (error) {
      onError(error)
      const code = (error as NodeJS.ErrnoException).code
      reply(error instanceof UnsupportedSaveError ? 409 : 503, {
        error:
          error instanceof UnsupportedSaveError
            ? error.message
            : code === 'ENOSPC'
              ? 'The local disk has no free space.'
              : 'The local disk autosave is unavailable. Existing save files have been kept.',
      })
    }
  }
}
export function autosaveServer(): Plugin {
  const middleware = autosaveMiddleware(resolve('.uchrony', 'autosaves', 'square-v1'))
  return {
    name: 'uchrony-local-autosaves',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
