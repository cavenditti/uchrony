import type { UrbanCharacter as Character } from '../sim/urban-character'

const labels = {
  housing: 'Homes',
  production: 'Workshops',
  market: 'Shops',
  logistics: 'Warehouses',
  civic: 'Public services',
}
const stages = {
  funded: 'Preparing works',
  clearing: 'Preparing the site',
  construction: 'Under construction',
}
export function UrbanCharacter({ character }: { character: Character }) {
  const total = Object.values(character.uses).reduce((a, b) => a + b, 0)
  return (
    <section className="urban-character" aria-label="Neighbourhood development">
      <h3>{character.name}</h3>
      {total > 0 && (
        <p>
          {Object.entries(character.uses)
            .filter(([, area]) => area / total >= 0.05)
            .sort((a, b) => b[1] - a[1])
            .map(
              ([use, area]) => `${labels[use as keyof typeof labels]} ${Math.round((100 * area) / total)}%`,
            )
            .join(' · ')}{' '}
          of recorded floor space
        </p>
      )}
      {character.buildings > 0 && (
        <p>
          {character.buildings} buildings · {character.olderBuildings} at least 10 years old ·{' '}
          {Math.round(character.condition * 100)}% average condition
        </p>
      )}
      {character.coarse && <p>Some housing is still recorded as larger parcels.</p>}
      {character.projects.length > 0 ? (
        <ul>
          {character.projects.map((p) => (
            <li key={p.id}>
              <strong>
                {stages[p.stage as keyof typeof stages] ?? p.stage} · {p.remaining}{' '}
                {p.remaining === 1 ? 'month' : 'months'} remaining
              </strong>
              <p>
                {p.reason}
                {p.displaced > 0 ? ` ${p.displaced} residents temporarily rehoused.` : ''}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {character.completed
            ? `${character.completed} completed improvements. No works underway.`
            : 'No works underway. Renewal depends on demand, funding and available space.'}
        </p>
      )}
    </section>
  )
}
