import { packWorldSave } from '../src/sim/save-codec'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { restoreWorld } from '../src/sim/persistence'
import { MAX_SAVE_BYTES, type WorldSave } from '../src/storage/save-types'
import { LEGACY_SAVE_KEY } from '../src/storage/autosave'

const recoveryPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uchrony save recovery</title>
<style>body{background:#19252b;color:#e6e7dd;font:16px/1.6 system-ui;margin:0;padding:40px 24px}main{max-width:640px;margin:10vh auto}h1{font:400 34px/1.2 Georgia,serif}button{background:#d7b77a;color:#253034;border:0;border-radius:4px;padding:12px 18px;font:inherit;cursor:pointer}button:disabled{opacity:.6}a{color:#d7b77a}p{overflow-wrap:anywhere}button:focus-visible,a:focus-visible{outline:2px solid #d7b77a;outline-offset:4px}</style>
<main><h1>Preserve a previous browser save</h1><p>This copies the older browser autosave to local disk without opening a simulation or changing the original browser data. An existing disk autosave is never overwritten. A world that has not yet been saved must be exported from its running tab.</p><button id="backup">Back up previous save</button><p id="status" role="status" aria-live="polite"></p><a href="/">Return to the simulator</a></main>
<script>document.getElementById('backup').onclick=async function(){const status=document.getElementById('status');this.disabled=true;try{const raw=localStorage.getItem(${JSON.stringify(LEGACY_SAVE_KEY)});if(!raw){status.textContent='No previous browser autosave was found. Your running tab may still hold an unsaved world; use Export there before reloading it.';this.disabled=false;return}const world=JSON.parse(raw),initial=await(await fetch('/api/saves/current')).json(),headers={'Content-Type':'application/json','X-Uchrony-Save-Slot':initial.slot},save={version:1,savedAt:Date.now(),world};if(initial.save){status.textContent='A verified disk autosave already exists and was kept. The original browser save is also unchanged.';this.textContent='Existing disk save kept';return}const response=await fetch('/api/saves/current',{method:'PUT',headers,body:JSON.stringify(save)});if(!response.ok)throw new Error('The disk backup could not complete. Your browser save has been kept.');const verified=await(await fetch('/api/saves/current',{headers:{'X-Uchrony-Save-Slot':initial.slot}})).json();if(JSON.stringify(verified.save.world)!==JSON.stringify(world))throw new Error('The backup could not be verified. Your browser save has been kept.');status.textContent='Backup verified on local disk: '+world.seed+', simulation month '+world.month+'. The original browser save is unchanged.';this.textContent='Backup verified'}catch(error){status.textContent=error.message;this.disabled=false}};</script></html>`

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
  private verified = new Map<string, { fingerprint: string; adaptive: boolean }>()
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
      const verified = { fingerprint: signature, adaptive: !!saved.world.adaptive }
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
    let damaged = false
    try {
      const save = await this.readFile(this.path(slot))
      if (save) return { save: output(save), recovered: false }
    } catch {
      damaged = true
    }
    const previous = await this.readFile(this.path(slot, true))
    if (previous) return { save: output(previous), recovered: true }
    if (damaged) throw new Error('The saved files could not be restored. They have been kept for recovery.')
    return { save: null, recovered: false }
  }
  async write(slot: string, value: WorldSave<unknown>) {
    const save = validateSaveRecord(value),
      current = this.path(slot),
      backup = this.path(slot, true)
    // The worker already compressed this immutable snapshot. Decode and validate
    // above, but retain its original encoding instead of compressing it twice.
    // Narrow legacy recovery still runs when either replica is restored.
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
            if (save.world.adaptive && !prior.adaptive) {
              // Write-once recovery copy survives later rotations of the ordinary previous save.
              await copyFile(
                current,
                join(this.root, `${slot}.pre-adaptive-v1.json`),
                constants.COPYFILE_EXCL,
              ).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'EEXIST') throw error
              })
            }
            await copyFile(current, backupTemporary)
            await rename(backupTemporary, backup)
          }
          await rename(temporary, current)
          this.verified.set(current, {
            fingerprint: await this.fingerprint(current),
            adaptive: !!save.world.adaptive,
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
    if (req.url?.split('?')[0] === '/save-recovery' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Cross-Origin-Resource-Policy': 'same-origin',
      })
      res.end(recoveryPage)
      return
    }
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
      reply(503, {
        error:
          code === 'ENOSPC'
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
