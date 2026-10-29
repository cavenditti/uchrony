import { ParameterLabel } from './components/ParameterHelp'
import { ConfigurationEditor } from './components/ConfigurationEditor'
import { configurationDraft, configurationFor, validateConfigurationValues } from './sim/configuration'
import { ModelAssignments } from './components/ModelAssignments'
import { PlaceAtlas } from './components/PlaceAtlas'
import type { PlaceQuery, PlaceResult } from './sim/almanac-types'
import { LocalInspection } from './components/LocalInspection'
import { inspectionAround, type InspectionSnapshot } from './sim/inspection'
import { InspectionMailbox } from './inspection-mailbox'
import { OFF_POLICY } from './sim/llm-policy'
import { DEFAULT_WORLD_SCALE, WORLD_SCALES, type WorldScale } from './sim/scale'
import { WorldOverview } from './components/WorldOverview'
import { inWorldText, narrativeProjection, presentWorld } from './sim/narrative'
import { SimulationConditions } from './components/SimulationConditions'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Play,
  Pause,
  FastForward,
  SkipForward,
  Download,
  Upload,
  Plus,
  Search,
  X,
  ChevronRight,
  Globe2,
  Users,
  Wheat,
  Swords,
  Route,
  CircleHelp,
  ArrowUpRight,
  Check,
  LoaderCircle,
  PanelLeft,
  Clock3,
  Settings2,
  Network,
  Info,
  CalendarDays,
  ChevronDown,
  Ellipsis,
  Activity,
  BookOpen,
  Compass,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import {
  type World,
  type WorkerRequest,
  type WorkerResponse,
  type Command,
  type Layer,
  dateLabel,
} from './sim/types'
import { LEGACY_SAVE_KEY } from './storage/autosave'
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from './sim/playback'
import { MAX_SAVE_BYTES } from './storage/save-types'
import type { AgentServiceStatus } from './sim/statecraft-types'
import type { StorytellerStatus } from './sim/history-types'
import { WorldMap } from './components/WorldMap'
import { Inspector, TAB_INFO, FlagMark, compact, type Tab } from './components/Inspector'
import './styles.css'

const ModelMathematics = lazy(() => import('./components/ModelMathematics'))

const tabLayer: Partial<Record<Tab, Layer>> = {
  atlas: 'political',
  population: 'population',
  economy: 'trade',
  diplomacy: 'political',
  military: 'military',
}

export default function App() {
  const [placesOpen, setPlacesOpen] = useState(false)
  const [placeResult, setPlaceResult] = useState<PlaceResult | null>(null)
  const [writingJobs, setWritingJobs] = useState<Record<string, { state: string; message?: string }>>({})
  const [placeRefresh, setPlaceRefresh] = useState(0)
  const placeSequence = useRef(0)
  const queryAtlas = useCallback((query: Omit<PlaceQuery, 'id'>) => {
    worker.current?.postMessage({
      type: 'places',
      query: { ...query, id: ++placeSequence.current },
    } satisfies WorkerRequest)
  }, [])
  const [inspection, setInspection] = useState<InspectionSnapshot | null>(null)
  const inspectionSequence = useRef(0)
  const inspectionMailbox = useRef<InspectionMailbox | null>(null)
  inspectionMailbox.current ??= new InspectionMailbox((request) => {
    worker.current?.postMessage({ type: 'inspect', request } satisfies WorkerRequest)
  })
  const requestInspection = (bounds: InspectionSnapshot['bounds']) => {
    inspectionMailbox.current!.submit({ id: ++inspectionSequence.current, bounds, detail: 'street' })
  }
  const [llmPolicy, setLlmPolicy] = useState({ ...OFF_POLICY })
  const [llmPending, setLlmPending] = useState(false)
  const [world, setWorld] = useState<World | null>(null),
    [running, setRunning] = useState(false),
    [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [tab, setTab] = useState<Tab>('atlas'),
    [layer, setLayer] = useState<Layer>('terrain')
  const [nation, setNation] = useState(0),
    [region, setRegion] = useState<number | null>(null)
  const [showRoutes, setShowRoutes] = useState(true),
    [showArmies, setShowArmies] = useState(false)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null),
    [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<'new' | 'help' | 'model' | 'conditions' | 'assignments' | null>(null),
    [stateSearch, setStateSearch] = useState(''),
    [showStates, setShowStates] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false),
    [expandedDossier, setExpandedDossier] = useState(false),
    [overviewOpen, setOverviewOpen] = useState(false)
  const [seed, setSeed] = useState('A world unwritten'),
    [continents, setContinents] = useState(3),
    [nationCount, setNationCount] = useState(32)
  const [scale, setScale] = useState<WorldScale>(DEFAULT_WORLD_SCALE)
  const [mapKey, setMapKey] = useState('')
  const [configuration, setConfiguration] = useState(configurationDraft)
  const [newConfiguration, setNewConfiguration] = useState(configurationDraft)
  const [configurationBaseline, setConfigurationBaseline] = useState(configurationDraft)
  const [configurationRevision, setConfigurationRevision] = useState(0)
  const [advancedSetup, setAdvancedSetup] = useState(false)
  const [settlementStart, setSettlementStart] = useState<'frontier' | 'settled'>('frontier')
  const [configurationError, setConfigurationError] = useState('')
  const [focus, setFocus] = useState<{ region: number; key: number; nation?: number; cell?: number } | null>(
      null,
    ),
    [orderedArmy, setOrderedArmy] = useState<number | null>(null)
  const [savedAt, setSavedAt] = useState('Not saved yet'),
    [restoreWarning, setRestoreWarning] = useState<string | null>(null)
  const [storyteller, setStoryteller] = useState<StorytellerStatus>({
    state: 'connecting',
    model: 'deepseek/deepseek-v4.1-flash',
    message: 'Connecting historical simulation…',
  })
  const [agents, setAgents] = useState<AgentServiceStatus>({
    pending: 0,
    active: [],
    decisionModel: '',
    strategyModel: '',
    error: '',
  })
  const [pendingDetails, setPendingDetails] = useState<number[]>([])
  const worker = useRef<Worker | null>(null),
    pending = useRef(false)
  const receivedGeography = useRef<{ key: string; cells: World['cells'] } | null>(null)
  const ensureSaveWorker = useRef<(() => void) | null>(null)
  const retryRestore = useRef<(() => void) | null>(null)
  const [startupError, setStartupError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    stateToggle = useRef<HTMLButtonElement>(null),
    dialogRef = useRef<HTMLDialogElement>(null)
  const notify = useCallback(
    (text: string, error = false) => setToast({ text: inWorldText(text), error }),
    [],
  )
  const send = useCallback((data: WorkerRequest) => {
    if (data.type === 'generate' || data.type === 'load' || data.type === 'import') {
      setPendingDetails([])
      setPlacesOpen(false)
      setPlaceResult(null)
      placeSequence.current++
      setWritingJobs({})
      setShowStates(false)
      setInspectorOpen(false)
      setOverviewOpen(false)
      setOrderedArmy(null)
    }
    pending.current = true
    setBusy(true)
    worker.current?.postMessage(data)
  }, [])

  useEffect(() => {
    const instance = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    let writer: Worker | null = null
    const connectWriter = () => {
      if (writer) return
      const currentWriter = new Worker(new URL('./storage/byte-worker.ts', import.meta.url), {
        type: 'module',
      })
      writer = currentWriter
      const channel = new MessageChannel()
      writer.postMessage({ port: channel.port1 }, [channel.port1])
      instance.postMessage({ type: 'storage-port', port: channel.port2 } satisfies WorkerRequest, [
        channel.port2,
      ])
      writer.onerror = (event) => {
        if (writer !== currentWriter) return
        instance.postMessage({
          type: 'storage-error',
          message: event.message || undefined,
        } satisfies WorkerRequest)
        currentWriter.terminate()
        writer = null
      }
    }
    ensureSaveWorker.current = connectWriter
    connectWriter()
    instance.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'places') {
        if (data.result.request === placeSequence.current) setPlaceResult(data.result)
        return
      }
      if (data.type === 'world-writing') {
        setWritingJobs((jobs) => ({ ...jobs, [data.id]: { state: data.state, message: data.message } }))
        if (data.state === 'done') setPlaceRefresh((n) => n + 1)
        return
      }
      if (data.type === 'startup-error') {
        setStartupError(data.message)
        return
      }
      if (data.type === 'storage') {
        if (data.state === 'saving') setSavedAt('Saving…')
        else if (data.state === 'restored') setSavedAt('Autosave restored')
        else if (data.state === 'error') {
          setSavedAt('Autosave will retry')
          setRestoreWarning(data.message ?? 'Autosave failed.')
        } else {
          setSavedAt(
            `Saved ${dateLabel({ month: data.month!, startYear: data.startYear! })} · ${data.source === 'disk' ? 'local disk' : 'browser database'}`,
          )
          setRestoreWarning(
            data.message
              ? `${data.message} A backup was saved to ${data.source === 'disk' ? 'local disk' : 'this browser'}; the other copy will retry.`
              : null,
          )
        }
        return
      }
      if (data.type === 'exported') {
        const url = URL.createObjectURL(data.blob),
          a = document.createElement('a')
        a.href = url
        a.download = data.filename
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        notify('World exported, including history and the random state for exact continuation.')
        return
      }
      if (data.type === 'inspection') {
        if (data.snapshot.request === inspectionSequence.current) setInspection(data.snapshot)
        inspectionMailbox.current!.settle(data.snapshot.request)
        return
      }
      if (data.type === 'inspection-error') {
        if (data.request === inspectionSequence.current) notify(data.message, true)
        inspectionMailbox.current!.settle(data.request)
        return
      }
      if (data.type === 'llm-policy') {
        setLlmPolicy(data.policy)
        setLlmPending(false)
        return
      }
      if (data.type === 'storyteller') {
        setStoryteller(narrativeProjection(data.status))
        return
      }
      if (data.type === 'agents') {
        setAgents(narrativeProjection(data.status))
        return
      }
      if (data.type === 'event-detail') {
        setPendingDetails((current) =>
          data.state === 'loading'
            ? [...new Set([...current, data.event])]
            : current.filter((id) => id !== data.event),
        )
        if (data.state === 'error' && data.message) notify(data.message, true)
        return
      }
      if (data.type === 'error' || data.acknowledgement !== false) {
        pending.current = false
        setBusy(false)
      }
      if (data.type === 'error') {
        setLlmPending(false)
        notify(data.message, true)
        if (!data.recoverable) setRunning(false)
        return
      }
      if (data.world.cells) {
        receivedGeography.current = { key: data.mapKey, cells: data.world.cells }
      }
      const cells =
        data.world.cells ??
        (receivedGeography.current?.key === data.mapKey ? receivedGeography.current.cells : undefined)
      if (!cells) {
        notify('The atlas has not arrived yet. Reload to restore your world.', true)
        return
      }
      const snapshot: World = { ...data.world, cells }
      setMapKey(data.mapKey)
      setWorld(presentWorld(snapshot))
      if (data.message) notify(data.message)
    }
    instance.onerror = () => {
      pending.current = false
      setBusy(false)
      setRunning(false)
      notify('The simulation worker stopped. Reload to restore your latest autosave.', true)
    }
    const restore = () => {
      setStartupError(null)
      let legacy: string | null = null
      try {
        legacy = localStorage.getItem(LEGACY_SAVE_KEY)
      } catch {
        /* Other replicas can restore. */
      }
      instance.postMessage({ type: 'restore', legacy } satisfies WorkerRequest)
    }
    retryRestore.current = () => {
      void restore()
    }
    void restore()
    return () => {
      writer?.terminate()
      ensureSaveWorker.current = null
      instance.terminate()
      worker.current = null
      retryRestore.current = null
    }
  }, [notify, send])

  useEffect(() => {
    worker.current?.postMessage({
      type: 'view-focus',
      nation: inspectorOpen ? nation : null,
    } satisfies WorkerRequest)
  }, [inspectorOpen, nation])

  // Acknowledge only after React commits, so busy painting cannot queue old worlds.
  useEffect(() => {
    if (world) worker.current?.postMessage({ type: 'snapshot-ack', mapKey } satisfies WorkerRequest)
  }, [world, mapKey])
  useEffect(() => {
    inspectionSequence.current++
    inspectionMailbox.current!.clear()
    setInspection(null)
  }, [mapKey])

  useEffect(() => {
    worker.current?.postMessage({ type: 'playback', running, speed } satisfies WorkerRequest)
  }, [running, speed])
  useEffect(() => {
    if (!world) return
    if (region !== null && world.regions[region]) setNation(world.regions[region].nation)
    else if (!world.nations[nation]?.population)
      setNation(world.nations.find((n) => n.population > 0)?.id ?? 0)
  }, [world, region, nation])
  useEffect(() => {
    const persist = () => {
      ensureSaveWorker.current?.()
      worker.current?.postMessage({ type: 'save' } satisfies WorkerRequest)
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden') persist()
    }
    const interval = window.setInterval(persist, 15000)
    window.addEventListener('pagehide', persist)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clearInterval(interval)
      window.removeEventListener('pagehide', persist)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
  useEffect(() => {
    if (restoreWarning)
      notify('Autosave needs attention. Open activity for details or export a backup.', true)
  }, [restoreWarning, notify])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 6000)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (modal) {
      const dialog = dialogRef.current
      if (dialog && !dialog.open) dialog.showModal()
      if (dialog) dialog.scrollTop = 0
      if (modal === 'model' || modal === 'help')
        dialog?.querySelector<HTMLButtonElement>('.dialog-close')?.focus()
    } else dialogRef.current?.close()
  }, [modal])
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (modal) return
      if (e.key === 'Escape') {
        if (closeMenus()) return
        if (placesOpen) {
          setPlacesOpen(false)
          document.querySelector<HTMLButtonElement>('[aria-label="Open places and histories"]')?.focus()
        } else if (orderedArmy !== null) setOrderedArmy(null)
        else if (showStates) {
          setShowStates(false)
          stateToggle.current?.focus()
        } else if (overviewOpen) {
          setOverviewOpen(false)
          document.querySelector<HTMLCanvasElement>('.world-canvas')?.focus()
        } else if (inspectorOpen) {
          setInspectorOpen(false)
          document.querySelector<HTMLCanvasElement>('.world-canvas')?.focus()
        } else setRegion(null)
        return
      }
      if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName))
        return
      if (['1', '2'].includes(e.key)) {
        e.preventDefault()
        setSpeed(PLAYBACK_SPEEDS[Number(e.key) - 1])
        return
      }
      if (e.target instanceof HTMLElement && ['BUTTON', 'SUMMARY'].includes(e.target.tagName)) return
      if (e.code === 'Space') {
        e.preventDefault()
        setRunning((v) => !v)
      }
      if (e.key === 'l' || e.key === 'L')
        setLayer((v) => {
          const list: Layer[] = [
            'political',
            'terrain',
            'population',
            'culture',
            'language',
            'belief',
            'prosperity',
            'food',
            'trade',
            'military',
          ]
          return list[(list.indexOf(v) + 1) % list.length]
        })
      if (e.key === '/') {
        e.preventDefault()
        closeMenus()
        setOverviewOpen(false)
        setShowStates(true)
        searchInput.current?.focus()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [modal, orderedArmy, showStates, overviewOpen, inspectorOpen, placesOpen])
  useEffect(() => {
    if (showStates) searchInput.current?.focus()
  }, [showStates])
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      for (const menu of document.querySelectorAll<HTMLDetailsElement>('details[data-menu][open]'))
        if (!menu.contains(event.target as Node)) menu.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  const chooseTab = (next: Tab) => {
    closeMenus()
    setPlacesOpen(false)
    setInspectorOpen(true)
    setOverviewOpen(false)
    setShowStates(false)
    setTab(next)
    if (tabLayer[next]) setLayer(tabLayer[next]!)
    if (next === 'military') setShowArmies(true)
  }
  const chooseNation = (id: number) => {
    setNation(id)
    setRegion(null)
    setShowStates(false)
    setOrderedArmy(null)
    setInspectorOpen(true)
    setOverviewOpen(false)
  }
  const command = (c: Command) => send({ type: 'command', command: c })
  const selectRegion = (id: number) => {
    if (!world) return
    if (orderedArmy !== null) {
      command({ type: 'move', army: orderedArmy, target: id })
      setOrderedArmy(null)
      return
    }
    setRegion(id)
    if (world.regions[id].nation >= 0) setNation(world.regions[id].nation)
    setOverviewOpen(false)
  }
  const focusRegion = (id: number) => setFocus({ region: id, key: Date.now() })
  const exportWorld = () => worker.current?.postMessage({ type: 'export' } satisfies WorkerRequest)
  const importWorld = async (file: File) => {
    try {
      if (file.size > MAX_SAVE_BYTES)
        throw new Error(`Choose a world save smaller than ${MAX_SAVE_BYTES / 1024 / 1024} MiB.`)
      setRunning(false)
      setNation(0)
      setRegion(null)
      setOrderedArmy(null)
      send({ type: 'import', file })
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not read that world save.', true)
    }
  }

  if (!world)
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" size={22} />
        <h1>Drawing a world into existence.</h1>
        {!startupError && <p>Raising continents. Settling provinces. Setting history in motion.</p>}
        {startupError && (
          <>
            <p role="alert">{inWorldText(startupError)}</p>
            <button className="button primary" onClick={() => retryRestore.current?.()}>
              Retry restoring saved world
            </button>
            <button className="button" onClick={() => fileInput.current?.click()}>
              Import a backup
            </button>
            <input
              hidden
              type="file"
              accept=".json,application/json"
              ref={fileInput}
              aria-label="Import a backup world"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importWorld(file)
                event.target.value = ''
              }}
            />
            <button
              className="button"
              onClick={() => {
                setStartupError(null)
                send({ type: 'generate', seed: 'A world unwritten' })
              }}
            >
              Start a new world
            </button>
          </>
        )}
        {toast?.error && <p role="alert">{toast.text}</p>}
      </div>
    )
  const nations = world.nations.filter((n) => n.population > 0),
    selected = world.nations[nation] ?? world.nations[0]
  const wars = world.totals.wars,
    food = world.regions.reduce((s, r) => s + r.foodCoverage, 0) / world.regions.length
  const controlled = nations.filter((n) => !n.ai)

  return (
    <div className="app-shell atlas-shell">
      <header className="topbar atlas-header">
        <Brand />
        <span className="atlas-world-name" title={world.seed}>
          {world.seed}
        </span>
        <div className="atlas-header-actions">
          <button
            className={`header-link ${overviewOpen ? 'active' : ''}`}
            aria-label="World overview"
            aria-expanded={overviewOpen}
            onClick={() => {
              setOverviewOpen((v) => !v)
              setInspectorOpen(false)
              setShowStates(false)
            }}
          >
            <Network size={16} />
            <span>World</span>
          </button>
          <button
            className={`header-link ${inspectorOpen && tab === 'chronicle' ? 'active' : ''}`}
            onClick={() => chooseTab('chronicle')}
            aria-label="Open world chronicle"
          >
            <BookOpen size={16} />
            <span>Chronicle</span>
          </button>
          <button
            className={`header-link ${placesOpen ? 'active' : ''}`}
            aria-label="Open places and histories"
            aria-expanded={placesOpen}
            onClick={() => {
              setPlacesOpen((open) => !open)
              setInspectorOpen(false)
              setOverviewOpen(false)
              setShowStates(false)
            }}
          >
            <Compass size={16} />
            <span>Places</span>
          </button>
          <details className="header-popover" data-menu>
            <summary
              className={`header-link activity-trigger ${restoreWarning || storyteller.state === 'error' || agents.error ? 'has-warning' : ''}`}
              aria-label={
                restoreWarning ? 'Autosave problem: open saving status' : 'Simulation activity and saving'
              }
              title={restoreWarning ? 'Autosave needs attention' : 'Activity and saving'}
            >
              {restoreWarning || storyteller.state === 'error' || agents.error ? (
                <Info size={17} />
              ) : (
                <Activity size={17} />
              )}
              <span className="visually-hidden">Activity and saving</span>
              {restoreWarning && <span className="save-problem-label">Save issue</span>}
            </summary>
            <div className="chrome-popover activity-popover">
              <h2>Simulation activity</h2>
              <p className="activity-save">
                <Check size={14} />
                {savedAt}
              </p>
              <p>
                {controlled.length
                  ? `Governing ${controlled.length} ${controlled.length === 1 ? 'state' : 'states'}`
                  : 'Observer mode · States govern themselves.'}
              </p>
              {restoreWarning && (
                <div className="activity-warning" role="alert">
                  <p>{inWorldText(restoreWarning)}</p>
                  <button
                    className="text-button"
                    onClick={() => {
                      ensureSaveWorker.current?.()
                      worker.current?.postMessage({ type: 'save', force: true } satisfies WorkerRequest)
                    }}
                  >
                    Retry save
                  </button>
                  <button className="text-button" onClick={exportWorld}>
                    Export a backup
                  </button>
                </div>
              )}
              <div className="activity-history">
                <strong>Historical accounts</strong>
                <p>
                  {storyteller.state === 'generating'
                    ? 'An account is developing in the background. Local events continue.'
                    : storyteller.message}
                </p>
                {storyteller.state === 'error' && (
                  <button className="text-button" onClick={() => send({ type: 'retry-history' })}>
                    Retry connection
                  </button>
                )}
              </div>
              <p>
                {agents.pending
                  ? `${agents.pending} background deliberations. The simulation continues independently.`
                  : llmPolicy.enabled
                    ? 'Governments deliberate in the background.'
                    : 'Governments use native simulation rules.'}
              </p>
              {agents.error && <p className="negative">{agents.error}</p>}
            </div>
          </details>
          <details className="header-popover" data-menu>
            <summary className="header-link" aria-label="World menu" title="World menu">
              <Ellipsis size={20} />
              <span className="visually-hidden">World menu</span>
            </summary>
            <div className="chrome-popover world-menu">
              <h2>{world.seed}</h2>
              <label className="llm-switch">
                <span>LLM assistance</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={llmPolicy.enabled}
                  disabled={llmPending || llmPolicy.forcedOff}
                  onChange={(event) => {
                    setLlmPending(true)
                    worker.current?.postMessage({
                      type: 'llm-policy',
                      enabled: event.target.checked,
                    } satisfies WorkerRequest)
                  }}
                />
              </label>
              <p aria-live="polite">
                {llmPending
                  ? 'Updating all tabs…'
                  : llmPolicy.forcedOff
                    ? 'Disabled by server settings.'
                    : llmPolicy.enabled
                      ? 'On for all tabs. Model requests may incur charges.'
                      : 'Off for all tabs. Native simulation continues.'}
              </p>
              <p>
                This world:{' '}
                {world.modelProvenance?.source === 'native'
                  ? 'native simulation'
                  : world.modelProvenance?.source === 'model-assisted'
                    ? `${world.modelProvenance.accepted} accepted model responses`
                    : 'earlier model use unknown'}
                .
              </p>
              <button
                onClick={() => {
                  closeMenus()
                  setModal('assignments')
                }}
              >
                <Settings2 size={16} />
                Model assignments
              </button>
              <hr />
              <button
                onClick={() => {
                  closeMenus()
                  exportWorld()
                }}
              >
                <Download size={16} />
                Export world
              </button>
              <button
                onClick={() => {
                  closeMenus()
                  fileInput.current?.click()
                }}
              >
                <Upload size={16} />
                Import world
              </button>
              <button
                onClick={() => {
                  closeMenus()
                  setRunning(false)
                  setConfigurationError('')
                  setModal('new')
                }}
              >
                <Plus size={16} />
                Generate world
              </button>
              <hr />
              <button
                onClick={() => {
                  closeMenus()
                  setConfiguration(configurationDraft(world))
                  setConfigurationBaseline(configurationDraft(world))
                  setConfigurationRevision(world.configuration?.revision ?? 0)
                  setConfigurationError('')
                  setModal('conditions')
                }}
              >
                <Settings2 size={16} />
                Simulation parameters
              </button>
              <button
                onClick={() => {
                  closeMenus()
                  setRunning(false)
                  setModal('model')
                }}
              >
                <BookOpen size={16} />
                Mathematical model
              </button>
              <button
                onClick={() => {
                  closeMenus()
                  setRunning(false)
                  setModal('help')
                }}
              >
                <CircleHelp size={16} />
                About Uchrony
              </button>
              <p>Fictional world · Experimental simulation</p>
            </div>
          </details>
        </div>
      </header>
      {inspection && (
        <LocalInspection
          snapshot={inspection}
          currentMonth={world.month}
          onClose={() => {
            inspectionSequence.current++
            inspectionMailbox.current!.clear()
            setInspection(null)
          }}
          onRefresh={() => requestInspection(inspection.bounds)}
        />
      )}
      <main className="workspace atlas-stage">
        <section className="atlas-workspace" aria-label="World atlas">
          <WorldMap
            world={world}
            mapKey={mapKey}
            layer={layer}
            nation={selected.id}
            region={region}
            showRoutes={showRoutes}
            showArmies={showArmies}
            running={running}
            focus={focus}
            orderMode={orderedArmy !== null}
            showContext={!inspectorOpen && !overviewOpen}
            onSelect={selectRegion}
            onFound={(cell) => command({ type: 'found-settlement', nation: selected.id, cell })}
            onInspectDaily={(cell) => requestInspection(inspectionAround(world, cell))}
            onInspectArea={requestInspection}
            onInspectionViewport={inspection ? requestInspection : undefined}
            onLayer={setLayer}
            onInspect={(id, section) => {
              if (world.regions[id].nation < 0) {
                requestInspection(inspectionAround(world, world.regions[id].center))
                return
              }
              selectRegion(id)
              chooseTab(section)
            }}
            onClear={() => setRegion(null)}
            onToggleRoutes={() => setShowRoutes((v) => !v)}
            onToggleArmies={() => setShowArmies((v) => !v)}
          />
          {orderedArmy !== null && (
            <div className="map-order-banner" role="status">
              <Swords size={16} />
              <span>Select a province as the army’s destination</span>
              <button onClick={() => setOrderedArmy(null)} aria-label="Cancel destination selection">
                <X size={15} />
              </button>
            </div>
          )}
        </section>
        <div className="atlas-navigation">
          <button
            ref={stateToggle}
            className={`map-button state-switcher ${showStates ? 'active' : ''}`}
            aria-expanded={showStates}
            aria-controls="faction-drawer"
            onClick={() => {
              setShowStates((v) => !v)
              setOverviewOpen(false)
            }}
          >
            <PanelLeft size={17} />
            <span>States</span>
            <small>{nations.length}</small>
            <ChevronDown size={13} />
          </button>
          <details className="explore-picker" data-menu>
            <summary className="map-button" aria-label="Explore simulation views">
              <Compass size={17} />
              <span>Explore</span>
              <ChevronDown size={13} />
            </summary>
            <nav className="chrome-popover explore-menu" aria-label="Simulation views">
              {TAB_INFO.map(({ id, name, icon: Icon }) => (
                <button
                  key={id}
                  aria-current={inspectorOpen && tab === id ? 'page' : undefined}
                  onClick={() => chooseTab(id)}
                >
                  <Icon size={16} />
                  <span>{id === 'atlas' ? 'State & province' : name}</span>
                  {tab === id && inspectorOpen && <Check size={13} />}
                </button>
              ))}
            </nav>
          </details>
        </div>
        {showStates && (
          <aside id="faction-drawer" className="faction-drawer" aria-label="Sovereign states">
            <div className="drawer-heading">
              <h2>
                Sovereign states <small>{nations.length}</small>
              </h2>
              <button
                className="icon-button"
                aria-label="Collapse state list"
                onClick={() => {
                  setShowStates(false)
                  stateToggle.current?.focus()
                }}
              >
                <X size={17} />
              </button>
            </div>
            <label className="state-search">
              <Search size={15} />
              <input
                ref={searchInput}
                aria-label="Find a state"
                placeholder="Find a state…"
                value={stateSearch}
                onChange={(e) => setStateSearch(e.target.value)}
              />
              <kbd>/</kbd>
            </label>
            <div className="state-list">
              {nations
                .filter((n) => n.name.toLowerCase().includes(stateSearch.toLowerCase()))
                .sort((a, b) => b.population - a.population)
                .map((n) => (
                  <button
                    key={n.id}
                    className={`state-row ${selected.id === n.id ? 'selected' : ''}`}
                    aria-pressed={selected.id === n.id}
                    onClick={() => {
                      chooseNation(n.id)
                      setFocus({ region: n.capital, nation: n.id, key: Date.now() })
                    }}
                  >
                    <FlagMark nation={n} small />
                    <span>
                      <strong>{n.shortName}</strong>
                      <small>{compact(n.population)} people</small>
                    </span>
                    {world.relations.some((r) => (r.a === n.id || r.b === n.id) && r.treaty === 'war') && (
                      <Swords size={13} className="negative" aria-label="At war" />
                    )}
                    <ChevronRight size={13} />
                  </button>
                ))}
              {!nations.some((n) => n.name.toLowerCase().includes(stateSearch.toLowerCase())) && (
                <p className="empty-state">No state matches “{stateSearch}”.</p>
              )}
            </div>
            <p className="drawer-note">
              Choose a state to open its dossier. You can also select any province on the map.
            </p>
          </aside>
        )}
        {inspectorOpen && !overviewOpen && (
          <section
            className={`dossier-panel ${expandedDossier ? 'expanded' : ''}`}
            aria-label="Selected place dossier"
          >
            <div className="dossier-tools">
              <label>
                <span className="visually-hidden">Dossier section</span>
                <select
                  aria-label="Dossier section"
                  value={tab}
                  onChange={(event) => chooseTab(event.target.value as Tab)}
                >
                  {TAB_INFO.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id === 'atlas' ? 'State & province' : item.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="icon-button expand-dossier"
                aria-label={expandedDossier ? 'Compact dossier' : 'Expand dossier'}
                title={expandedDossier ? 'Compact dossier' : 'Expand dossier'}
                onClick={() => setExpandedDossier((v) => !v)}
              >
                {expandedDossier ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                className="icon-button"
                aria-label="Close dossier"
                onClick={() => {
                  setInspectorOpen(false)
                  document.querySelector<HTMLCanvasElement>('.world-canvas')?.focus()
                }}
              >
                <X size={18} />
              </button>
            </div>
            <Inspector
              onAdvise={(nation, text) => send({ type: 'advise', nation, text })}
              onWithdrawAdvice={(nation, advice) => send({ type: 'withdraw-advice', nation, advice })}
              world={world}
              agentStatus={agents}
              onStrategy={(nation) => worker.current?.postMessage({ type: 'agent-strategy', nation })}
              onEventDetails={(event) => worker.current?.postMessage({ type: 'event-details', event })}
              pendingDetails={pendingDetails}
              nationId={selected.id}
              regionId={region !== null && world.regions[region].nation >= 0 ? region : null}
              tab={tab}
              onTab={chooseTab}
              onCommand={command}
              onFocus={focusRegion}
              onRegion={setRegion}
              onNation={chooseNation}
              onArmy={(id) => {
                setOrderedArmy(id)
                setInspectorOpen(false)
              }}
              orderedArmy={orderedArmy}
            />
          </section>
        )}
        {overviewOpen && (
          <section
            className="world-comparison-panel"
            aria-label="World comparisons"
            aria-labelledby="world-overview-title"
          >
            <div className="comparison-toolbar">
              <span>
                <Network size={16} />
                World overview
              </span>
              <button
                className="icon-button"
                aria-label="Close world overview"
                onClick={() => setOverviewOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="comparison-scroll">
              <div className="world-digest">
                <span>
                  <Users size={14} />
                  <strong>{compact(world.totals.population)}</strong> people
                </span>
                <span>
                  <Wheat size={14} />
                  {Math.round(food * 100)}% food needs met
                </span>
                <span>
                  <Route size={14} />
                  {compact(world.totals.trade)} t traded / month
                </span>
                <span className={wars ? 'negative' : ''}>
                  <Swords size={14} />
                  {wars} active {wars === 1 ? 'war' : 'wars'}
                </span>
              </div>
              <WorldOverview
                world={world}
                nation={nation}
                onNation={(id) => {
                  chooseNation(id)
                  chooseTab('diplomacy')
                }}
                onCommand={command}
              />
            </div>
          </section>
        )}
        <div className="atlas-clock" role="group" aria-label="Simulation time controls">
          <div className="clock-date">
            <strong>{dateLabel(world)}</strong>
            <span>
              {busy ? 'Advancing…' : running ? `In motion · ${speed}×` : 'Paused'}
              {world.fastForward && ' · Approx. history'}
            </span>
          </div>
          <div className="clock-controls">
            <div className="clock-speeds" role="group" aria-label="Simulation speed">
              {PLAYBACK_SPEEDS.map((value, index) => {
                const playing = running && speed === value
                const label = `Play at ${value}× speed`
                return (
                  <button
                    key={value}
                    aria-pressed={speed === value}
                    aria-label={playing ? 'Pause simulation' : label}
                    title={`${playing ? 'Pause' : value === 1 ? 'Play' : '2× speed'} (${index + 1}) · Space to pause or resume`}
                    onClick={() => {
                      setSpeed(value)
                      setRunning(!playing)
                    }}
                  >
                    {playing ? (
                      <Pause size={18} fill="currentColor" aria-hidden="true" />
                    ) : value === 1 ? (
                      <Play size={18} fill="currentColor" aria-hidden="true" />
                    ) : (
                      <FastForward size={20} aria-hidden="true" />
                    )}
                  </button>
                )
              })}
            </div>
            <button
              className="icon-button clock-step"
              aria-label="Advance one month"
              title="Advance one month"
              disabled={busy || running}
              onClick={() => send({ type: 'step', count: 1 })}
            >
              <SkipForward size={17} />
            </button>
            <details className="clock-options" data-menu>
              <summary className="icon-button" aria-label="Time controls">
                <Ellipsis size={19} />
                <span className="visually-hidden">Time controls</span>
              </summary>
              <div className="chrome-popover">
                <p>{world.month} months of history</p>
                <button
                  disabled={busy || running}
                  onClick={() => {
                    closeMenus()
                    send({ type: 'step', count: 12 })
                  }}
                >
                  <CalendarDays size={16} />
                  Advance one year
                </button>
                <p>{busy ? 'Calculating the next month…' : 'Space to play or pause · 1–2 for speed'}</p>
                <p>Both speeds use the monthly model. Pause takes effect after the current month.</p>
              </div>
            </details>
          </div>
        </div>
        {placesOpen && (
          <PlaceAtlas
            result={placeResult}
            startYear={world.startYear}
            currentMonth={world.month}
            enabled={llmPolicy.enabled}
            jobs={writingJobs}
            refresh={placeRefresh}
            onQuery={queryAtlas}
            onWrite={(request) =>
              worker.current?.postMessage({ type: 'world-writing', request } satisfies WorkerRequest)
            }
            onClose={() => {
              setPlacesOpen(false)
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLButtonElement>('[aria-label="Open places and histories"]')
                  ?.focus(),
              )
            }}
            onLocate={(cell) => {
              const r = world.cells[cell]?.region
              setFocus({ region: r ?? -1, cell, key: Date.now() })
              setPlacesOpen(false)
              requestAnimationFrame(() => document.querySelector<HTMLCanvasElement>('.world-canvas')?.focus())
            }}
          />
        )}
      </main>
      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>
          {toast.error ? <Info size={17} /> : <Check size={17} />}
          <span>{toast.text}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".json,application/json"
        aria-label="Import Uchrony world file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importWorld(file)
          e.target.value = ''
        }}
      />
      <dialog
        ref={dialogRef}
        aria-labelledby="dialog-title"
        className={`app-dialog ${modal === 'help' ? 'help-dialog' : modal === 'model' ? 'mathematics-dialog' : modal === 'assignments' ? 'assignments-dialog' : modal === 'conditions' || (modal === 'new' && advancedSetup) ? 'configuration-dialog' : ''}`}
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            const rect = e.currentTarget.getBoundingClientRect()
            if (
              e.clientX < rect.left ||
              e.clientX > rect.right ||
              e.clientY < rect.top ||
              e.clientY > rect.bottom
            )
              setModal(null)
          }
        }}
      >
        <div className={modal === 'model' ? 'model-dialog-heading' : undefined}>
          {modal === 'model' && <h2 id="dialog-title">Mathematical model</h2>}
          <button
            className="dialog-close icon-button"
            aria-label="Close dialog"
            onClick={() => setModal(null)}
          >
            <X size={20} />
          </button>
        </div>
        {modal === 'assignments' ? (
          <ModelAssignments
            onSaved={() => worker.current?.postMessage({ type: 'models-changed' } satisfies WorkerRequest)}
          />
        ) : modal === 'new' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              try {
                validateConfigurationValues(newConfiguration)
              } catch (error) {
                setConfigurationError((error as Error).message)
                return
              }
              setNation(0)
              setRegion(null)
              setTab('atlas')
              setLayer('political')
              setOrderedArmy(null)
              send({
                type: 'generate',
                seed: seed.trim() || 'A world unwritten',
                continents,
                scale,
                nations: nationCount,
                configuration: newConfiguration,
                start: settlementStart,
              })
              setModal(null)
            }}
          >
            <Globe2 className="dialog-symbol" size={34} strokeWidth={1} />
            <h2 id="dialog-title">A different beginning.</h2>
            <p>
              Choose a beginning, then open the advanced view to shape its people, resources and simulation.
            </p>
            <div className="configuration-view-toggle" role="group" aria-label="World setup view">
              <button
                className="button secondary"
                type="button"
                aria-pressed={!advancedSetup}
                onClick={() => setAdvancedSetup(false)}
              >
                Basic setup
              </button>
              <button
                className="button secondary"
                type="button"
                aria-pressed={advancedSetup}
                onClick={() => setAdvancedSetup(true)}
              >
                Advanced setup
              </button>
            </div>
            <div className="select-label">
              <ParameterLabel htmlFor="world-seed" label="World seed">
                The same seed and settings produce the same generated world. Change the text to create a
                different geography and starting history.
              </ParameterLabel>
              <input
                id="world-seed"
                aria-describedby="world-seed-help"
                autoFocus
                maxLength={100}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="A world unwritten"
                required
              />
            </div>
            <div className="form-columns">
              <div className="select-label">
                <ParameterLabel htmlFor="world-size" label="World size">
                  Larger worlds contain more terrain at the same physical scale, increasing travel distances
                  and simulation work.
                </ParameterLabel>
                <select
                  id="world-size"
                  aria-describedby="world-size-help"
                  value={scale}
                  onChange={(e) => {
                    const next = e.target.value as WorldScale
                    setScale(next)
                    setNationCount(WORLD_SCALES[next].states)
                  }}
                >
                  {Object.entries(WORLD_SCALES).map(([key, extent]) => (
                    <option key={key} value={key}>
                      {extent.label} · {(extent.width * extent.height).toLocaleString()} square cells
                    </option>
                  ))}
                </select>
              </div>
              <div className="select-label">
                <ParameterLabel htmlFor="world-start" label="Starting pattern">
                  Frontier settlements start with one settlement per state and largely unclaimed land.
                  Established states begin with populated territories and use their own opening treasury
                  value.
                </ParameterLabel>
                <select
                  id="world-start"
                  aria-describedby="world-start-help"
                  value={settlementStart}
                  onChange={(event) => setSettlementStart(event.target.value as 'frontier' | 'settled')}
                >
                  <option value="frontier">Frontier settlements</option>
                  <option value="settled">Established states</option>
                </select>
              </div>
            </div>
            <p className="panel-note">
              Around {WORLD_SCALES[scale].provinces.toLocaleString()} provinces. Larger worlds add real
              distance: longer supply lines, regional markets, and more wilderness. Each state starts with one
              settlement in Frontier mode, with{' '}
              {Math.round(
                newConfiguration.starting.capitalPopulation * newConfiguration.starting.populationScale,
              ).toLocaleString()}{' '}
              people before any recruitment. Established states begin with populated territories.
            </p>
            <p className="panel-note" aria-live="polite">
              Opening treasury per state:{' '}
              <strong>
                {(
                  (settlementStart === 'frontier'
                    ? newConfiguration.starting.treasury
                    : newConfiguration.starting.settledTreasury) * 1000
                ).toLocaleString()}{' '}
                crowns
              </strong>
              . Change it under Advanced setup → Starting conditions.
            </p>
            <div className="form-columns">
              <div className="select-label">
                <ParameterLabel htmlFor="world-continents" label="Geography">
                  Number and arrangement of generated continental masses. The seed shapes their coastline and
                  distribution.
                </ParameterLabel>
                <select
                  id="world-continents"
                  aria-describedby="world-continents-help"
                  value={continents}
                  onChange={(e) => setContinents(Number(e.target.value))}
                >
                  <option value={1}>One great continent</option>
                  <option value={2}>Twin continents</option>
                  <option value={3}>Continental mosaic</option>
                  <option value={4}>Four continents</option>
                  <option value={5}>Scattered continents</option>
                </select>
              </div>
              <div className="select-label">
                <ParameterLabel htmlFor="world-states" label="Starting states">
                  Number of independent states created at the beginning. Later political changes may create or
                  remove states.
                </ParameterLabel>
                <input
                  id="world-states"
                  aria-describedby="world-states-help"
                  type="number"
                  required
                  min={4}
                  max={48}
                  step={1}
                  value={Number.isFinite(nationCount) ? nationCount : ''}
                  onChange={(event) => setNationCount(event.target.valueAsNumber)}
                />
              </div>
            </div>
            {advancedSetup ? (
              <ConfigurationEditor value={newConfiguration} onChange={setNewConfiguration} />
            ) : (
              <SimulationConditions
                value={newConfiguration.conditions}
                onChange={(conditions) => setNewConfiguration({ ...newConfiguration, conditions })}
              />
            )}
            <p className="panel-note">
              The same seed and settings create the same world. This replaces your current world; export it
              first to keep a copy.
            </p>
            {configurationError && (
              <p className="configuration-error" role="alert">
                {configurationError}
              </p>
            )}
            <button className="button primary full configuration-submit" type="submit" disabled={busy}>
              <Plus size={16} />
              Generate world
            </button>
          </form>
        ) : modal === 'conditions' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              try {
                validateConfigurationValues(configuration)
              } catch (error) {
                setConfigurationError((error as Error).message)
                return
              }
              send({
                type: 'command',
                command: { type: 'configuration', values: configuration, revision: configurationRevision },
              })
              setModal(null)
            }}
          >
            <Settings2 className="dialog-symbol" size={34} strokeWidth={1} />
            <h2 id="dialog-title">Simulation parameters.</h2>
            <p>
              Stage your changes and apply them together. Future steps use the new values; existing people,
              goods and contracts are preserved. Settings travel with this world’s saves.
            </p>
            <ConfigurationEditor
              value={configuration}
              onChange={setConfiguration}
              live
              baseline={configurationBaseline}
            />
            {configurationError && (
              <p className="configuration-error" role="alert">
                {configurationError}
              </p>
            )}
            <div className="configuration-actions">
              <button className="button secondary" type="button" onClick={() => setModal(null)}>
                Discard changes
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={JSON.stringify(configuration) === JSON.stringify(configurationBaseline)}
              >
                Apply changes together
              </button>
            </div>
            {!!world.pressures?.incidents.length && (
              <div className="conditions-incidents">
                <h3>Recent pressures</h3>
                {world.pressures.incidents.slice(0, 5).map((incident) => (
                  <p key={incident.id}>
                    <strong>{incident.title}</strong>
                    <br />
                    <small>
                      {incident.scope} · {incident.expires > world.month ? 'Ongoing' : 'Aftermath'}
                    </small>
                  </p>
                ))}
              </div>
            )}
          </form>
        ) : modal === 'model' ? (
          <>
            <p className="model-intro">
              Equations, assumptions and references. Behavioral coefficients are synthetic.
            </p>
            <Suspense fallback={<p role="status">Loading the mathematical model…</p>}>
              <ModelMathematics parameters={configurationFor(world).model} />
            </Suspense>
          </>
        ) : modal === 'help' ? (
          <>
            <CompassIcon />
            <h2 id="dialog-title">About Uchrony</h2>
            <p>
              Uchrony is a local world-history simulation. Let states govern themselves, or intervene in any
              one of them.
            </p>
            <p>
              Towns emerge from occupied development and merge as their neighborhoods connect. Housing grows
              through paid construction, and households seek accessible jobs. Administrative borders and
              spatial resolution evolve while preserving people, firms, goods and accounts. Close inspection
              shows representative daily activity from the recorded population and paid jobs.
            </p>
            <p>
              LLM assistance is optional and on by default. The World menu switch applies to every tab; the
              native simulation continues with it off.
            </p>
            <button className="about-model-link" onClick={() => setModal('model')}>
              <BookOpen size={17} aria-hidden="true" />
              Mathematical model
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <details className="model-controls">
              <summary>Simulation controls</summary>
              <div className="help-steps">
                <div>
                  <Play size={18} />
                  <span>
                    <strong>Set history in motion</strong>Play and 2× use the monthly model. Pause takes
                    effect after the current month. Advance one year runs twelve monthly steps while paused.
                  </span>
                </div>
                <div>
                  <Search size={18} />
                  <span>
                    <strong>Follow a place or a system</strong>Select a state, click a province, or change the
                    map layer. Explore the same world through its population, economy and history.
                  </span>
                </div>
                <div>
                  <Settings2 size={18} />
                  <span>
                    <strong>Change the conditions</strong>Adjust budgets, develop provinces, fund research,
                    negotiate treaties, recruit armies, or introduce local shocks.
                  </span>
                </div>
                <div>
                  <Download size={18} />
                  <span>
                    <strong>Keep an alternate history</strong>Autosaves stay on this computer. Export a world
                    to preserve its geography, history, and exact random state.
                  </span>
                </div>
              </div>
              <div className="keyboard-guide">
                <span>
                  <kbd>Space</kbd>Play / pause
                </span>
                <span>
                  <kbd>1–2</kbd>Speed
                </span>
                <span>
                  <kbd>L</kbd>Map layer
                </span>
                <span>
                  <kbd>/</kbd>Find state
                </span>
                <span>
                  <kbd>Esc</kbd>Clear selection
                </span>
              </div>
              <a
                href="https://youtu.be/aobeydG8Sd4"
                target="_blank"
                rel="noreferrer"
                className="reference-link"
              >
                Inspired by the Fantasy Map Simulator timelapse
                <ArrowUpRight size={13} />
              </a>
            </details>
          </>
        ) : null}
      </dialog>
    </div>
  )
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="Uchrony home">
      <svg viewBox="0 0 32 36" aria-hidden="true">
        <path
          d="M5 3h22M5 33h22M8 3c0 9 8 12 8 15S8 24 8 33M24 3c0 9-8 12-8 15s8 6 8 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path d="m11 8 5 6 5-6M11 29l5-6 5 6Z" fill="currentColor" />
      </svg>
      <span>UCHRONY</span>
    </a>
  )
}
function CompassIcon() {
  return <Clock3 className="dialog-symbol" size={34} strokeWidth={1} />
}

function closeMenus() {
  const menus = document.querySelectorAll<HTMLDetailsElement>('details[data-menu][open]')
  for (const menu of menus) {
    if (menu.contains(document.activeElement)) menu.querySelector<HTMLElement>('summary')?.focus()
    menu.open = false
  }
  return menus.length > 0
}
