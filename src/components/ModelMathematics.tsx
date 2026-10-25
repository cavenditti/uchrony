import { useState, type ReactNode } from 'react'
import reference from '../../docs/MODEL.md?raw'
import { MODEL_PARAMETERS } from '../sim/model-parameters'

const sections = reference
  .split(/^## /m)
  .slice(1)
  .map((text) => {
    const end = text.indexOf('\n')
    return { title: text.slice(0, end), body: text.slice(end + 1).trim() }
  })
function inline(text: string): ReactNode {
  return text.split(/(\[[^\]]+\]\(https:\/\/[^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/)
    if (link)
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      )
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    return part
  })
}
/** A deliberately small, text-only renderer for the checked-in model reference. No HTML execution. */
function ModelText({ text }: { text: string }) {
  const blocks = text.split(/(```[\s\S]*?```)/g)
  return blocks.map((block, index) => {
    if (block.startsWith('```'))
      return (
        <pre key={index}>
          {block
            .replace(/^```[^\n]*\n/, '')
            .replace(/```$/, '')
            .trim()
            .split('\n')
            .map((line) => line.trimStart())
            .join('\n')}
        </pre>
      )
    return (
      <div key={index}>
        {block
          .trim()
          .split(/\n\s*\n/)
          .filter(Boolean)
          .map((paragraph, i) => {
            if (paragraph.startsWith('### ')) return <h4 key={i}>{inline(paragraph.slice(4))}</h4>
            if (paragraph.startsWith('|')) {
              const rows = paragraph
                .split('\n')
                .filter((row) => !/^\|[\s:|\-]+\|$/.test(row))
                .map((row) =>
                  row
                    .split('|')
                    .slice(1, -1)
                    .map((cell) => cell.trim()),
                )
              return (
                <div key={i} className="model-table">
                  <table>
                    <thead>
                      <tr>
                        {rows[0].map((cell, j) => (
                          <th key={j}>{inline(cell)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(1).map((row, j) => (
                        <tr key={j}>
                          {row.map((cell, k) => (
                            <td key={k}>{inline(cell)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
            if (/^[-\d]/.test(paragraph) && /^(- |\d+\. )/m.test(paragraph))
              return (
                <ul key={i}>
                  {paragraph.split(/\n(?=- |\d+\. )/).map((line, j) => (
                    <li key={j}>{inline(line.replace(/^(- |\d+\. )/, ''))}</li>
                  ))}
                </ul>
              )
            return <p key={i}>{inline(paragraph.replace(/\n/g, ' '))}</p>
          })}
      </div>
    )
  })
}
export function ModelMathematics() {
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase(),
    visible = sections.filter((s) => !search || `${s.title} ${s.body}`.toLowerCase().includes(search))
  return (
    <section className="model-mathematics" aria-label="Simulation mathematics">
      <p>Model {MODEL_PARAMETERS.version} · Monthly time steps · People, tonnes and thousands of crowns.</p>
      <p>
        Explore the equations, assumptions and limits behind the world. These are synthetic scenarios, with
        standard demographic and economic model forms; they are not calibrated historical forecasts.
      </p>
      <label className="model-search">
        Find a mechanism
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try firms, banks, GDP or fertility"
        />
      </label>
      <p className="model-result-count" aria-live="polite">
        {visible.length} {visible.length === 1 ? 'topic' : 'topics'}
        {search ? ' matching your search' : ''}
      </p>
      {!visible.length && <p>No matching mechanism. Try a broader term or clear the search.</p>}
      <div className="model-topics">
        {visible.map((s) => (
          <details key={`${s.title}:${search}`} open={search ? true : undefined}>
            <summary>{s.title}</summary>
            <ModelText text={s.body} />
          </details>
        ))}
      </div>
      <details>
        <summary>Current core parameters</summary>
        <dl className="model-parameters">
          {Object.entries(MODEL_PARAMETERS).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
              <dd>{Array.isArray(value) ? value.join(', ') : value}</dd>
            </div>
          ))}
        </dl>
        <p>
          Values above are read directly from the running model’s parameter module. Other system-specific
          coefficients are described in the topic sections.
        </p>
      </details>
    </section>
  )
}
