import { CHARACTER_AXES, LEADER_SKILLS } from '../sim/character-types'
import { CHARACTER_LABELS, LEADER_PERKS } from '../sim/character'
import { EFFECT_LABELS } from '../sim/effects'
import { dateLabel, type Nation, type World } from '../sim/types'

const score = (n: number) => Math.round(n * 100)
const axisNames = ['Force', 'Reform', 'Welfare', 'Authority', 'Commerce', 'Patience']
const skillNames = ['Administration', 'Diplomacy', 'Logistics', 'Scholarship', 'Command']

export function StateCharacter({
  world,
  nation,
  compact = false,
}: {
  world: World
  nation: Nation
  compact?: boolean
}) {
  const c = nation.character
  if (!c) return null
  if (compact)
    return (
      <div className="state-character-summary">
        <strong>{c.title}</strong>
        <span>{c.leader.name}</span>
      </div>
    )
  const temperament = CHARACTER_AXES.map((axis) => ({
    axis,
    distance: Math.abs(c.leader.attitudes[axis] - 0.5),
  }))
    .sort((a, b) => b.distance - a.distance)
    .slice(0, 2)
    .map(({ axis }) => CHARACTER_LABELS[axis][c.leader.attitudes[axis] >= 0.5 ? 1 : 0].toLowerCase())
    .join(' and ')
  return (
    <section className="state-character" aria-label="State character">
      <h3>{c.title}</h3>
      <p className="character-account">{c.description}</p>
      <ul className="character-priorities">
        {c.priorities.map((priority) => (
          <li key={priority}>{priority}</li>
        ))}
      </ul>
      <h4>Who shapes the state</h4>
      <div className="character-influence">
        <span>
          People <b>{score(c.influence.people)}%</b>
        </span>
        <span>
          Institutions <b>{score(c.influence.institutions)}%</b>
        </span>
        <span>
          Leader <b>{score(c.influence.leader)}%</b>
        </span>
      </div>
      <p className="panel-note">
        These weights describe political influence. Public attitudes evolve with living conditions and
        political movements.
      </p>
      <h4>Current leadership</h4>
      <div className="character-leader">
        <strong>{c.leader.name}</strong>
        <span>Since {dateLabel({ month: c.leader.since, startYear: world.startYear })}</span>
      </div>
      <p className="character-account">
        Temperament: {temperament}.{' '}
        {c.mandateGap > 0.3
          ? 'Public opinion and leadership are pulling in different directions.'
          : 'Personal priorities operate within the state’s institutions.'}
      </p>
      <div className="leader-qualities">
        {c.leader.perks.map((id) => {
          const perk = LEADER_PERKS[id]
          return (
            <div key={id}>
              <div>
                <strong>{perk.name}</strong>
                <span>{perk.strength ? 'Strength' : 'Limitation'}</span>
              </div>
              <p>{perk.description}</p>
            </div>
          )
        })}
      </div>
      <details className="character-details">
        <summary>Compare attitudes and leadership skills</summary>
        <p className="panel-note">
          Scores run from 0 to 100 between the two attitudes shown in each row. A state’s direction combines
          all three sources of influence.
        </p>
        <div className="character-table-wrap">
          <table className="character-table">
            <caption>Sources of state character</caption>
            <thead>
              <tr>
                <th scope="col">Attitude</th>
                <th scope="col">People</th>
                <th scope="col">Offices</th>
                <th scope="col">Leader</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {CHARACTER_AXES.map((axis, i) => (
                <tr key={axis}>
                  <th scope="row">
                    {axisNames[i]}
                    <small>{CHARACTER_LABELS[axis].join(' → ')}</small>
                  </th>
                  <td>{score(c.popular[axis])}</td>
                  <td>{score(c.institutions[axis])}</td>
                  <td>{score(c.leader.attitudes[axis])}</td>
                  <td>{score(c.effective[axis])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h4>Leadership skills</h4>
        {LEADER_SKILLS.map((skill, i) => (
          <div className="data-row" key={skill}>
            <span>{skillNames[i]}</span>
            <b>{score(c.leader.skills[skill])} / 100</b>
          </div>
        ))}
        <h4>Leadership in practice</h4>
        <p className="panel-note">
          Modest changes in institutional effectiveness, reflecting this leader’s skills, connections,
          limitations, and scope of authority.
        </p>
        {Object.entries(c.modifiers).map(([stat, value]) => (
          <div className="data-row" key={stat}>
            <span>{stat === 'cohesion' ? 'Unrest target' : EFFECT_LABELS[stat]}</span>
            <b>
              {stat === 'cohesion'
                ? `${(-value * 15).toFixed(2)} points`
                : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`}
            </b>
          </div>
        ))}
      </details>
    </section>
  )
}
