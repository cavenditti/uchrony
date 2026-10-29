/** Fiscal confidence links the public debt burden to monthly political stability. */
import { clamp, type Nation } from './types'

/** Compute the next fiscal update without changing the government's accounts. */
export function nextFiscalStability(
  nation: Readonly<Pick<Nation, 'debt' | 'gdp' | 'stability' | 'legitimacy'>>,
  happiness: number,
): number {
  const adjustment = (happiness * 80 + nation.legitimacy * 0.2 - nation.stability) * 0.05
  // GDP is a monthly flow: two years of output is the existing synthetic distress
  // threshold. Nonpositive output cannot support debt, but debt-free states must
  // not acquire a fiscal penalty just because measured value added is negative.
  const distressed = nation.debt > Math.max(0, nation.gdp) * 24
  // Unresolved fiscal distress blocks upward mean reversion; otherwise the 5%
  // adjustment offsets 0.3 points/month at a fixed six-point gap forever. Keep
  // adverse political adjustments, and resume ordinary recovery once debt clears
  // the threshold. Only the shared stability floor limits the cumulative loss.
  const change = distressed ? Math.min(0, adjustment) - 0.3 : adjustment
  return clamp(nation.stability + change, 5, 99)
}
