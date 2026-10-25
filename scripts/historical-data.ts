import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { HistoricalObservation } from '../src/sim/historical-macro'

const root = new URL('../data/history/us-1960-1985/', import.meta.url)
export function loadUSHistory(): HistoricalObservation[] {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))
  const series: Record<string, Map<string, number>> = {}
  for (const source of manifest.series) {
    const bytes = readFileSync(new URL(`${source.id}.csv`, root))
    if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
      throw new Error(`Historical data hash mismatch: ${source.id}`)
    const lines = bytes.toString('utf8').trim().split(/\r?\n/)
    if (lines.shift() !== `observation_date,${source.id}` || lines.length !== source.observations)
      throw new Error('Invalid historical CSV header/count')
    const rows = new Map<string, number>()
    for (const line of lines) {
      const [date, text] = line.split(',')
      const value = Number(text)
      if (!/^\d{4}-\d{2}-01$/.test(date) || !text || !Number.isFinite(value) || value < 0 || rows.has(date))
        throw new Error(`Invalid historical observation: ${line}`)
      rows.set(date, value)
    }
    series[source.id] = rows
  }
  function quarter(id: string, year: number, q: number) {
    const values = Array.from({ length: id === 'GDPC1' ? 1 : 3 }, (_, i) => {
      const date = `${year}-${String(q * 3 + i + 1).padStart(2, '0')}-01`
      const value = series[id]?.get(date)
      if (value === undefined) throw new Error(`Missing historical observation: ${id} ${date}`)
      return value
    })
    return values.reduce((a, b) => a + b, 0) / values.length
  }
  const observations: HistoricalObservation[] = []
  for (let year = 1959; year <= 1985; year++)
    for (let q = 0; q < 4; q++) {
      const gdp = quarter('GDPC1', year, q),
        prices = quarter('CPIAUCSL', year, q)
      observations.push({
        quarter: `${year}-Q${q + 1}`,
        gdp,
        prices,
        unemployment: quarter('UNRATE', year, q) / 100,
        laborForce: quarter('CLF16OV', year, q) * 1000,
        policy: quarter('FEDFUNDS', year, q) / 100,
        oil: quarter('WPU0561', year, q),
        inflation: observations.length >= 4 ? Math.log(prices / observations.at(-4)!.prices) : 0,
        growth: observations.length ? 4 * Math.log(gdp / observations.at(-1)!.gdp) : 0,
      })
    }
  return observations.slice(4)
}
