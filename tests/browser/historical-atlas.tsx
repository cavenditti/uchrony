/** Synthetic UI fixture; uses real archive queries and constitutional mutations without saves or model calls. */
import React, { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HistoricalAtlas } from '../../src/components/HistoricalAtlas'
import { generateWorld } from '../../src/sim/generate'
import { applyInstitutionTerm } from '../../src/sim/institutions'
import { reconcileInstitutions } from '../../src/sim/institution-lifecycle'
import {
  queryWorldArchive,
  recordWorldArchive,
  type ArchiveQuery,
  type ArchiveResult,
} from '../../src/sim/world-archive'
import { relation, type Command } from '../../src/sim/types'
import { applyCommand } from '../../src/sim/commands'
import type { DiplomaticClause, DiplomaticOffer } from '../../src/sim/statecraft-types'
import '../../src/styles.css'
const world = generateWorld('Historical atlas review fixture', 3, 8)
world.nations[0].name = world.nations[0].shortName = 'River Republic'
world.nations[1].name = world.nations[1].shortName = 'Northern Kingdom'
world.nations[2].name = world.nations[2].shortName = 'Coastal Commonwealth'
const term: DiplomaticClause = {
  kind: 'institution',
  from: 0,
  to: -1,
  amount: 0,
  good: '',
  field: '',
  regions: [],
  duration: 0,
  text: 'Three Rivers League',
  charter: {
    operation: 'found',
    id: 0,
    form: 'defense-league',
    powers: ['defense', 'trade'],
    rule: 'majority',
    contribution: 0.03,
    exit: 'notice',
  },
}
const offer = { id: 1, parties: [0, 1, 2], visibility: 'public' } as DiplomaticOffer
applyInstitutionTerm(world, term, offer)
recordWorldArchive(world)
world.month = 6
applyInstitutionTerm(
  world,
  { ...term, text: 'League of the Three Rivers', charter: { ...term.charter!, id: 1, operation: 'rename' } },
  offer,
)
recordWorldArchive(world)
world.month = 12
Object.assign(relation(world, 0, 1)!, { treaty: 'war', since: 12, aggressor: 0 })
reconcileInstitutions(world)
recordWorldArchive(world)
world.month = 18
reconcileInstitutions(world)
recordWorldArchive(world)
world.nations[1].ai = false
function Fixture() {
  const [result, setResult] = useState<ArchiveResult | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [closed, setClosed] = useState(false)
  const query = useCallback(
    (q: Omit<ArchiveQuery, 'id'>) => setResult(queryWorldArchive(world, { ...q, id: 1 })),
    [],
  )
  const command = (c: Command) => {
    try {
      applyCommand(world, c)
      setRevision((x) => x + 1)
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">Synthetic regression world · no model calls or autosaves</header>
      {closed ? (
        <button onClick={() => setClosed(false)}>Open historical atlas</button>
      ) : (
        <HistoricalAtlas
          world={{ ...world, institutions: revision ? { ...world.institutions! } : world.institutions }}
          result={result}
          error={error}
          initialInstitution={1}
          onQuery={query}
          onClose={() => setClosed(true)}
          onCommand={command}
        />
      )}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
)
