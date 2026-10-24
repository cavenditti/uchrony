import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Play,
  Pause,
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
  Eye,
  CircleHelp,
  ArrowUpRight,
  Check,
  LoaderCircle,
  PanelLeft,
  Clock3,
  Settings2,
  Info,
  CalendarDays,
} from 'lucide-react'
import {
  type World,
  type WorkerRequest,
  type WorkerResponse,
  type Command,
  type Layer,
  dateLabel,
} from './sim/types'
import { parseSave } from './sim/persistence'
import { WorldMap } from './components/WorldMap'
import { Inspector, TAB_INFO, FlagMark, compact, type Tab } from './components/Inspector'
import './styles.css'

const SAVE_KEY = 'uchrony.world.v1'
const speedOptions = [1, 4, 12, 60]
const tabLayer: Partial<Record<Tab, Layer>> = {
  atlas: 'political',
  population: 'population',
  economy: 'trade',
  diplomacy: 'political',
  military: 'military',
}

export default function App() {
  const [world, setWorld] = useState<World | null>(null),
    [running, setRunning] = useState(false),
    [speed, setSpeed] = useState(1)
  const [tab, setTab] = useState<Tab>('atlas'),
    [layer, setLayer] = useState<Layer>('political')
  const [nation, setNation] = useState(0),
    [region, setRegion] = useState<number | null>(null)
  const [showRoutes, setShowRoutes] = useState(true),
    [showArmies, setShowArmies] = useState(false)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null),
    [busy, setBusy] = useState(false)
  const [modal, setModal] = useState<'new' | 'help' | null>(null),
    [stateSearch, setStateSearch] = useState(''),
    [showStates, setShowStates] = useState(false)
  const [seed, setSeed] = useState('A world unwritten'),
    [continents, setContinents] = useState(3),
    [nationCount, setNationCount] = useState(8)
  const [focus, setFocus] = useState<{ region: number; key: number } | null>(null),
    [orderedArmy, setOrderedArmy] = useState<number | null>(null)
  const [savedAt, setSavedAt] = useState('Not saved yet'),
    [restoreWarning, setRestoreWarning] = useState<string | null>(null)
  const worker = useRef<Worker | null>(null),
    pending = useRef(false),
    currentWorld = useRef<World | null>(null)
  const fileInput = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    dialogRef = useRef<HTMLDialogElement>(null)
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), [])
  const send = useCallback((data: WorkerRequest) => {
    pending.current = true
    setBusy(true)
    worker.current?.postMessage(data)
  }, [])

  useEffect(() => {
    const instance = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    instance.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      pending.current = false
      setBusy(false)
      if (data.type === 'error') {
        notify(data.message, true)
        setRunning(false)
        return
      }
      setWorld(data.world)
      currentWorld.current = data.world
      if (data.message) notify(data.message)
    }
    instance.onerror = () => {
      pending.current = false
      setBusy(false)
      setRunning(false)
      notify('The simulation worker stopped. Reload to restore your latest autosave.', true)
    }
    let saved: World | null = null
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (raw) saved = parseSave(raw)
    } catch {
      setRestoreWarning(
        'The previous autosave could not be restored. A new world has been created; import a valid exported save to recover another world.',
      )
    }
    if (saved) {
      send({ type: 'load', world: saved })
      setSavedAt('Autosave restored')
    } else send({ type: 'generate', seed: 'A world unwritten' })
    return () => {
      instance.terminate()
      worker.current = null
    }
  }, [notify, send])

  useEffect(() => {
    if (!running) return
    const interval = window.setInterval(
      () => {
        if (!pending.current) send({ type: 'step', count: speed === 60 ? 12 : speed === 12 ? 3 : 1 })
      },
      speed === 1 ? 1000 : speed === 4 ? 250 : speed === 12 ? 250 : 200,
    )
    return () => window.clearInterval(interval)
  }, [running, speed, send])
  useEffect(() => {
    if (!world) return
    if (region !== null && world.regions[region]) setNation(world.regions[region].nation)
    else if (!world.nations[nation]?.population)
      setNation(world.nations.find((n) => n.population > 0)?.id ?? 0)
  }, [world, region, nation])
  useEffect(() => {
    if (!world || (running && world.month % 12 !== 0)) return
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(world))
        setSavedAt(`Saved ${dateLabel(world)}`)
      } catch {
        setSavedAt('Autosave unavailable')
        setRestoreWarning('Browser storage is full or unavailable. Export your world to keep it.')
      }
    }, 350)
    return () => clearTimeout(timeout)
  }, [world, running])
  useEffect(() => {
    const persist = () => {
      try {
        if (currentWorld.current) localStorage.setItem(SAVE_KEY, JSON.stringify(currentWorld.current))
      } catch {
        /* Export remains available when browser storage is full. */
      }
    }
    window.addEventListener('pagehide', persist)
    return () => window.removeEventListener('pagehide', persist)
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 6000)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (modal) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [modal])
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)
      )
        return
      if (modal) return
      if (e.code === 'Space') {
        e.preventDefault()
        setRunning((v) => !v)
      }
      if (['1', '2', '3', '4'].includes(e.key)) setSpeed(speedOptions[Number(e.key) - 1])
      if (e.key === 'l' || e.key === 'L')
        setLayer((v) => {
          const list: Layer[] = [
            'political',
            'terrain',
            'population',
            'prosperity',
            'food',
            'trade',
            'military',
          ]
          return list[(list.indexOf(v) + 1) % list.length]
        })
      if (e.key === 'Escape') {
        setOrderedArmy(null)
        setRegion(null)
        setShowStates(false)
      }
      if (e.key === '/') {
        e.preventDefault()
        setShowStates(true)
        searchInput.current?.focus()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [modal])
  const chooseTab = (next: Tab) => {
    setTab(next)
    if (tabLayer[next]) setLayer(tabLayer[next]!)
    if (next === 'military') setShowArmies(true)
  }
  const chooseNation = (id: number) => {
    setNation(id)
    setRegion(null)
    setShowStates(false)
    setOrderedArmy(null)
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
    setNation(world.regions[id].nation)
    setTab('atlas')
  }
  const focusRegion = (id: number) => setFocus({ region: id, key: Date.now() })
  const exportWorld = () => {
    if (!world) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(world)], { type: 'application/json' })),
      a = document.createElement('a')
    a.href = url
    a.download = `uchrony-${world.seed.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 50)}-${world.startYear + Math.floor(world.month / 12)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    notify('World exported, including history and the random state for exact continuation.')
  }
  const importWorld = async (file: File) => {
    try {
      if (file.size > 20_000_000) throw new Error('Choose a world save smaller than 20 MB.')
      const restored = parseSave(await file.text())
      setRunning(false)
      setNation(0)
      setRegion(null)
      setOrderedArmy(null)
      send({ type: 'load', world: restored })
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
        <p>Raising continents. Settling provinces. Setting history in motion.</p>
        {toast?.error && <p role="alert">{toast.text}</p>}
      </div>
    )
  const nations = world.nations.filter((n) => n.population > 0),
    selected = world.nations[nation] ?? world.nations[0]
  const wars = world.totals.wars,
    food = world.regions.reduce((s, r) => s + r.foodCoverage, 0) / world.regions.length
  const controlled = nations.filter((n) => !n.ai)

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="world-identity">
          <span className="world-divider" />
          <Globe2 size={15} />
          <span>{world.seed}</span>
          <span className="world-type">Generated world</span>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            aria-label="How the simulation works"
            title="How it works"
            onClick={() => {
              setRunning(false)
              setModal('help')
            }}
          >
            <CircleHelp size={18} />
          </button>
          <button className="button header-secondary" onClick={() => fileInput.current?.click()}>
            <Upload size={14} />
            <span>Import</span>
          </button>
          <button className="button header-secondary" onClick={exportWorld}>
            <Download size={14} />
            <span>Export world</span>
          </button>
          <button
            className="button new-world-button"
            onClick={() => {
              setRunning(false)
              setModal('new')
            }}
          >
            <Plus size={15} />
            <span>New world</span>
          </button>
        </div>
      </header>
      <div className="world-stats">
        <div className="world-status">
          <span className={`status-dot ${running ? 'pulse' : ''}`} />
          {running ? 'World in motion' : 'World paused'}
        </div>
        <div>
          <Users size={14} />
          <strong>{compact(world.totals.population)}</strong>
          <span>people</span>
        </div>
        <div>
          <Globe2 size={14} />
          <strong>{nations.length}</strong>
          <span>states</span>
        </div>
        <div>
          <Route size={14} />
          <strong>{compact(world.totals.trade)}</strong>
          <span>t traded / mo</span>
        </div>
        <div>
          <Wheat size={14} />
          <strong>{Math.round(food * 100)}%</strong>
          <span>food needs met</span>
        </div>
        <div className={wars > 0 ? 'war-stat' : ''}>
          <Swords size={14} />
          <strong>{wars}</strong>
          <span>{wars === 1 ? 'active war' : 'active wars'}</span>
        </div>
        <div className="mode-indicator">
          <Eye size={14} />
          <span>
            {controlled.length
              ? `Governing ${controlled.length} ${controlled.length === 1 ? 'state' : 'states'}`
              : 'Observer mode'}
          </span>
        </div>
      </div>
      <nav className="main-nav" aria-label="Simulation views">
        <button
          className="mobile-states-button"
          onClick={() => setShowStates((v) => !v)}
          aria-label="Toggle state list"
        >
          <PanelLeft size={17} />
        </button>
        {TAB_INFO.map(({ id, name, icon: Icon }) => (
          <button
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            className={tab === id ? 'active' : ''}
            onClick={() => chooseTab(id)}
          >
            <Icon size={15} />
            <span>{name}</span>
            {id === 'chronicle' && <small>{Math.min(world.events.length, 99)}</small>}
          </button>
        ))}
      </nav>
      {restoreWarning && (
        <div className="warning-banner" role="alert">
          <Info size={15} />
          <span>{restoreWarning}</span>
          <button aria-label="Dismiss storage warning" onClick={() => setRestoreWarning(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      <main className="workspace">
        <aside className={`world-sidebar ${showStates ? 'open' : ''}`} aria-label="States and recent events">
          <div className="sidebar-section">
            <div className="sidebar-heading">
              <h2>Sovereign states</h2>
              <span>{nations.length}</span>
              <button
                className="mobile-close icon-button"
                aria-label="Close state list"
                onClick={() => setShowStates(false)}
              >
                <X size={14} />
              </button>
            </div>
            <label className="state-search">
              <Search size={14} />
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
                    onClick={() => chooseNation(n.id)}
                  >
                    <FlagMark nation={n} small />
                    <span>
                      <strong>{n.shortName}</strong>
                      <small>{compact(n.population)} people</small>
                    </span>
                    <span
                      className={`state-peace ${world.relations.some((r) => (r.a === n.id || r.b === n.id) && r.treaty === 'war') ? 'at-war' : ''}`}
                      title={
                        world.relations.some((r) => (r.a === n.id || r.b === n.id) && r.treaty === 'war')
                          ? 'At war'
                          : 'At peace'
                      }
                    />
                    <ChevronRight size={13} />
                  </button>
                ))}
              {!nations.some((n) => n.name.toLowerCase().includes(stateSearch.toLowerCase())) && (
                <p className="empty-state">No state matches “{stateSearch}”.</p>
              )}
            </div>
          </div>
          <div className="sidebar-events">
            <div className="sidebar-heading">
              <h2>Recent history</h2>
              <button
                aria-label="Open world chronicle"
                className="icon-button"
                onClick={() => chooseTab('chronicle')}
              >
                <ArrowUpRight size={15} />
              </button>
            </div>
            {world.events.slice(0, 3).map((e) => (
              <button
                className={`sidebar-event ${e.type}`}
                key={e.id}
                onClick={() => {
                  chooseTab('chronicle')
                  if (e.nation !== undefined) chooseNation(e.nation)
                }}
              >
                <time>{dateLabel({ month: e.month, startYear: world.startYear })}</time>
                <strong>{e.title}</strong>
                <span>
                  {e.type === 'world' ? 'The world takes shape' : e.type[0].toUpperCase() + e.type.slice(1)}
                </span>
              </button>
            ))}
            <button className="text-button" onClick={() => chooseTab('chronicle')}>
              Read the chronicle
              <ArrowRightIcon />
            </button>
          </div>
          <div className="sidebar-bottom">
            <span>Every border has a history.</span>
            <small>Every decision writes the next.</small>
          </div>
        </aside>
        <section className="atlas-workspace" aria-label="World atlas">
          <WorldMap
            world={world}
            layer={layer}
            nation={selected.id}
            region={region}
            showRoutes={showRoutes}
            showArmies={showArmies}
            running={running}
            focus={focus}
            onSelect={selectRegion}
            onLayer={setLayer}
          />
          {orderedArmy !== null && (
            <div className="map-order-banner">
              <FlagIcon />
              <span>Choose a destination for your army</span>
              <button onClick={() => setOrderedArmy(null)} aria-label="Cancel destination selection">
                <X size={15} />
              </button>
            </div>
          )}
          <div className="map-tools">
            <div className="overlay-toggles">
              <button
                className={showRoutes ? 'active' : ''}
                aria-pressed={showRoutes}
                onClick={() => setShowRoutes((v) => !v)}
              >
                <Route size={13} />
                Trade routes
              </button>
              <button
                className={showArmies ? 'active' : ''}
                aria-pressed={showArmies}
                onClick={() => setShowArmies((v) => !v)}
              >
                <Swords size={13} />
                Armies
              </button>
            </div>
            <span>Drag to explore · Scroll to zoom</span>
          </div>
          <footer className="time-control">
            <div className="date-display">
              <CalendarDays size={18} />
              <div>
                <strong>{dateLabel(world)}</strong>
                <span>{world.month} months of history</span>
              </div>
            </div>
            <div className="playback">
              <button
                className={`play-button ${running ? 'running' : ''}`}
                aria-label={running ? 'Pause simulation' : 'Play simulation'}
                title="Play / pause (Space)"
                onClick={() => setRunning((v) => !v)}
              >
                {running ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
              <button
                className="step-button"
                aria-label="Advance one month"
                title="Advance one month"
                disabled={busy || running}
                onClick={() => send({ type: 'step', count: 1 })}
              >
                <SkipForward size={17} />
              </button>
              <div className="speed-controls">
                {speedOptions.map((v) => (
                  <button
                    key={v}
                    aria-pressed={speed === v}
                    className={speed === v ? 'active' : ''}
                    onClick={() => setSpeed(v)}
                  >
                    {v}×
                  </button>
                ))}
              </div>
            </div>
            <button
              className="advance-year"
              disabled={busy || running}
              onClick={() => send({ type: 'step', count: 12 })}
            >
              +1 year
              <ChevronRight size={13} />
            </button>
            <span className="save-status" title={savedAt}>
              {busy ? <LoaderCircle className="spin" size={12} /> : <Check size={12} />}
              <span>{busy ? 'Simulating' : savedAt}</span>
            </span>
          </footer>
        </section>
        <Inspector
          world={world}
          nationId={selected.id}
          regionId={region}
          tab={tab}
          onTab={chooseTab}
          onCommand={command}
          onFocus={focusRegion}
          onRegion={setRegion}
          onNation={chooseNation}
          onArmy={setOrderedArmy}
          orderedArmy={orderedArmy}
        />
      </main>
      <div className="app-status">
        <span>
          <Globe2 size={11} />
          UCHRONY <b>0.1</b>
        </span>
        <span>Fictional world · Experimental simulation</span>
        <button
          onClick={() => {
            setRunning(false)
            setModal('help')
          }}
        >
          Model & controls
          <ArrowUpRight size={11} />
        </button>
      </div>
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
        className={`app-dialog ${modal === 'help' ? 'help-dialog' : ''}`}
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
        <button className="dialog-close icon-button" aria-label="Close dialog" onClick={() => setModal(null)}>
          <X size={20} />
        </button>
        {modal === 'new' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setNation(0)
              setRegion(null)
              setTab('atlas')
              setLayer('political')
              setOrderedArmy(null)
              send({
                type: 'generate',
                seed: seed.trim() || 'A world unwritten',
                continents,
                nations: nationCount,
              })
              setModal(null)
            }}
          >
            <Globe2 className="dialog-symbol" size={34} strokeWidth={1} />
            <h2 id="dialog-title">A different beginning.</h2>
            <p>Give geography a seed. Let history find its own way.</p>
            <label className="select-label">
              World seed
              <input
                autoFocus
                maxLength={100}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="A world unwritten"
                required
              />
            </label>
            <div className="form-columns">
              <label className="select-label">
                Geography
                <select value={continents} onChange={(e) => setContinents(Number(e.target.value))}>
                  <option value={1}>One great continent</option>
                  <option value={2}>Twin continents</option>
                  <option value={3}>Continental mosaic</option>
                  <option value={5}>Scattered continents</option>
                </select>
              </label>
              <label className="select-label">
                Starting states
                <select value={nationCount} onChange={(e) => setNationCount(Number(e.target.value))}>
                  {[4, 6, 8, 10, 12].map((v) => (
                    <option key={v} value={v}>
                      {v} sovereign states
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="panel-note">
              The same seed and settings create the same world. This replaces your current world; export it
              first to keep a copy.
            </p>
            <button className="button primary full" type="submit">
              <Plus size={16} />
              Generate world
            </button>
          </form>
        ) : (
          <>
            <CompassIcon />
            <h2 id="dialog-title">A world of consequences.</h2>
            <p>
              Uchrony is a local, deterministic world-history sandbox. Let states govern themselves, or
              intervene in any one of them.
            </p>
            <div className="help-steps">
              <div>
                <Play size={18} />
                <span>
                  <strong>Set history in motion</strong>Play advances monthly ticks. Speed changes pacing; +1
                  year advances twelve months while paused.
                </span>
              </div>
              <div>
                <Search size={18} />
                <span>
                  <strong>Follow a place or a system</strong>Select a state, click a province, or change the
                  map layer. Every number comes from the same simulation.
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
                  <strong>Keep an alternate history</strong>Autosaves stay in this browser. Export a world to
                  preserve its geography, history, and exact random state.
                </span>
              </div>
            </div>
            <details open>
              <summary>What the model simulates</summary>
              <p>
                Regional age cohorts; births, deaths, and migration; eight goods and three manufacturing
                chains; shared transport capacity; taxation and spending; six technology fields; diplomatic
                relationships; and provincial warfare with supply, morale, terrain, and casualties.
              </p>
            </details>
            <details>
              <summary>Model boundaries</summary>
              <p>
                This is an experimental aggregate model, not a calibrated historical forecast. Provinces
                represent populations rather than individual people. Trade settles within a month through
                public inventories; animated dots visualize completed monthly flows. Sea links abstract port
                access. Diplomacy uses transparent rules rather than language models. Technology is six levels
                per field. Real geography, individual firms, detailed naval combat, and historical calibration
                are not implemented.
              </p>
            </details>
            <div className="keyboard-guide">
              <span>
                <kbd>Space</kbd>Play / pause
              </span>
              <span>
                <kbd>1–4</kbd>Speed
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
          </>
        )}
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
function ArrowRightIcon() {
  return <ChevronRight size={12} />
}
function FlagIcon() {
  return <MapFlag />
}
function MapFlag() {
  return <Swords size={16} />
}
function CompassIcon() {
  return <Clock3 className="dialog-symbol" size={34} strokeWidth={1} />
}
