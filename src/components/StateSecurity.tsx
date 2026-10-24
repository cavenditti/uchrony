import type { World } from '../sim/types'
import { authoritySummary } from '../sim/sovereignty'

export function StateSecurity({
  world,
  nation,
  onFocus,
}: {
  world: World
  nation: number
  onFocus: (region: number) => void
}) {
  const report = authoritySummary(world, nation)
  return (
    <section className="state-security" aria-label="Protection and territorial authority">
      <h3>Protection and authority</h3>
      <p className="panel-note">
        Supplied forces, functioning institutions and local loyalties sustain public order. Organized
        opposition can replace a government or detach territory when protection fails.
      </p>
      <div className="data-row">
        <span>Vulnerable provinces</span>
        <b>{report.fragile}</b>
      </div>
      <div className="data-row">
        <span>Control contested</span>
        <b>{report.contested}</b>
      </div>
      {!world.sovereignty && <p className="panel-note">Provincial assessments begin with the next month.</p>}
      {report.emergencies.map((entry) => (
        <article className="security-emergency" key={entry.region}>
          <button className="text-button" onClick={() => onFocus(entry.region)}>
            {entry.place} · {entry.stage}
          </button>
          <p className="panel-note">
            {entry.organizationName}: {Math.round(entry.organization * 100)}% organized,{' '}
            {Math.round(entry.support * 100)}% support within its constituency. Protection{' '}
            {Math.round(entry.protection * 100)}%; inadequate for {entry.neglect} months.
          </p>
          {entry.monthsToPossibleLoss !== null && (
            <p className="warning-text">
              Control could be lost in {Math.max(1, entry.monthsToPossibleLoss)}{' '}
              {entry.monthsToPossibleLoss <= 1 ? 'month' : 'months'} if the organized challenge remains
              stronger than loyal forces.
            </p>
          )}
          <small>
            Estimated mobilization {entry.mobilizable.toLocaleString()} · Effective loyal force{' '}
            {Math.round(entry.loyalStrength).toLocaleString()}
          </small>
        </article>
      ))}
    </section>
  )
}
