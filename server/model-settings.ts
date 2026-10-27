import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  defaultModelSettings,
  MODEL_TASKS,
  validateModelSettings,
  type ModelSettings,
  type ModelTask,
  type ModelOption,
  type ModelMeasurement,
} from '../src/sim/model-tasks'

export class ModelService {
  private settings: ModelSettings | null = null
  private loading?: Promise<void>
  private writing: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(settings: ModelSettings) => void>()
  subscribe(listener: (settings: ModelSettings) => void) {
    this.listeners.add(listener)
    listener(this.settings!)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private catalogAt = 0
  private catalogRequest?: Promise<void>
  models: ModelOption[] = []
  measurements: Record<string, ModelMeasurement> = {}
  calls = 0
  catalogError = ''
  constructor(private path?: string) {}
  async initialize(env: Record<string, string | undefined>) {
    this.loading ??= (async () => {
      this.settings = defaultModelSettings(env)
      if (this.path) {
        try {
          this.settings = validateModelSettings(JSON.parse(await readFile(this.path, 'utf8')))
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            this.catalogError = 'Saved model settings could not be read. Environment defaults are in use.'
        }
      }
    })()
    await this.loading
  }
  snapshot() {
    return {
      settings: this.settings!,
      models: this.models,
      measurements: this.measurements,
      calls: this.calls,
      catalogError: this.catalogError,
    }
  }
  async update(value: unknown) {
    const settings = validateModelSettings(value)
    for (const task of Object.keys(MODEL_TASKS) as ModelTask[]) {
      const known = this.models.find((m) => m.id === settings.assignments[task].model)
      if (known && !known.json && !known.structured)
        throw new Error(`${known.name} does not advertise structured or JSON output.`)
      if (known?.outputLimit && known.outputLimit < MODEL_TASKS[task].tokens)
        throw new Error(`${known.name} has too small an output limit for ${MODEL_TASKS[task].label}.`)
    }
    const job = this.writing
      .catch(() => {})
      .then(async () => {
        if (this.path) {
          await mkdir(dirname(this.path), { recursive: true })
          const temporary = `${this.path}.${randomUUID()}.tmp`
          await writeFile(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 })
          await rename(temporary, this.path)
        }
        this.settings = settings
        for (const listener of this.listeners) listener(settings)
      })
    this.writing = job
    await job
    return this.snapshot()
  }
  assignment(task: ModelTask) {
    return this.settings!.assignments[task]
  }
  reserve() {
    if (this.calls >= this.settings!.sessionCallLimit)
      throw new Error(
        'The model call limit for this server session has been reached. Native simulation continues. Raise the limit in Model assignments to resume.',
      )
    this.calls++
  }
  measure(
    model: string,
    elapsedMs: number,
    result?: { usage?: { completion_tokens?: number; cost?: number } },
  ) {
    const m = (this.measurements[model] ??= {
      calls: 0,
      failures: 0,
      elapsedMs: 0,
      outputTokens: 0,
      cost: 0,
      costKnown: true,
    })
    m.calls++
    m.elapsedMs += elapsedMs
    if (!result) m.failures++
    const tokens = result?.usage?.completion_tokens
    if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0) m.outputTokens += tokens
    const cost = result?.usage?.cost
    if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) m.cost += cost
    else m.costKnown = false
  }
  async refreshCatalog(fetcher: typeof fetch = fetch) {
    if (this.catalogAt && Date.now() - this.catalogAt < 3600000) return
    if (this.catalogRequest) return this.catalogRequest
    this.catalogRequest = (async () => {
      try {
        const response = await fetcher('https://openrouter.ai/api/v1/models', {
          signal: AbortSignal.timeout(12000),
        })
        if (!response.ok) throw new Error('Model catalog is unavailable.')
        const body = await response.json()
        if (!Array.isArray(body.data)) throw new Error('Invalid model catalog.')
        const price = (x: unknown) =>
          typeof x === 'string' && x.trim() && Number.isFinite(Number(x)) && Number(x) >= 0
            ? Number(x) * 1e6
            : null
        this.models = body.data
          .filter((m: any) => typeof m.id === 'string' && m.architecture?.output_modalities?.includes('text'))
          .map((m: any): ModelOption => ({
            id: m.id,
            name: String(m.name || m.id),
            context: Number(m.context_length) || 0,
            inputPrice: price(m.pricing?.prompt),
            outputPrice: price(m.pricing?.completion),
            structured: m.supported_parameters?.includes('structured_outputs') === true,
            json: m.supported_parameters?.includes('response_format') === true,
            outputLimit: m.top_provider?.max_completion_tokens || undefined,
          }))
          .sort((a: ModelOption, b: ModelOption) => a.name.localeCompare(b.name))
        this.catalogAt = Date.now()
        this.catalogError = ''
      } catch {
        this.catalogError =
          'Live catalog unavailable. Saved assignments still work; capabilities and prices may be unavailable.'
      } finally {
        this.catalogRequest = undefined
      }
    })()
    return this.catalogRequest
  }
}
