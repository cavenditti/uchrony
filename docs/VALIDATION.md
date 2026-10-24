# Validation record

Verified locally on 24 October 2026 using Node 26.11.1 and Chrome for Testing 151.0.7922.47. These results apply to the implementation in this checkout, not to a deployed service.

## Automated checks

- `npm run build`: TypeScript and Vite production build passed.
- `npm run format:check`: passed.
- `npm test`: **13 tests passed**, covering seed determinism, map ownership, monthly population accounting, recruitment, conservation and capacity in trade, wartime border access, policy and investment effects, research progression, exact save continuation, malformed saves, 100-year validity, land-limited agriculture, and sovereign insolvency.
- Three earlier 200-year soak runs completed with population and save invariants. The subsequent longer test exposed debt compounding beyond the import validator's numerical limit; the fiscal model was corrected and an insolvency regression test added.
- The corrected model completed a **1,080-year / 12,960-month** run of seed `A world unwritten`, checking exact population accounting every month and full save validity every century plus at completion.

The final 1,080-year run took **154,992 ms** on this machine, ending with 25,228,866 people, 7 surviving states, 1,095 recorded event IDs, and an approximately 3.01 MB JSON save. These are reproducible synthetic outcomes of this build, not benchmarks for other machines or historical predictions. Its event list and monthly history remain intentionally bounded as described in MODEL.md.

## Browser workflows exercised

- Generate the default world; advance one month/year; run at 12× and pause after a year.
- Generate a different seed with five continental centers and 12 states.
- Change tax from 22 to 23 using the keyboard range control; close migration; confirm both in the autosave.
- Change research focus to agriculture and confirm it persists.
- Inspect actual production/consumption/stocks and eight visible trade-route rows.
- Pay for a diplomatic mission; negotiate a trade accord with Serrane; confirm relationship state.
- Recruit a second Aurelian corps; confirm the army list and population transfer.
- Select a destination on the map, issue a march order, advance time, and confirm the army arrives in Ulmere.
- Download a world through the Export button; validate the resulting file independently; import it through the file input into another browser session; confirm the date, army state, and policies.
- Check console errors, desktop overflow, and mobile overflow. No browser runtime errors were reported; the 390px mobile layout has document width 390px.

## Interface checks

- Current desktop capture: `.impeccable/review/desktop.png`, 1440 × 960.
- Current mobile capture: `.impeccable/review/mobile.png`, 390px wide, full document.
- Axe WCAG 2 A/AA audit on the main view: **0 automatic violations**. Canvas-overlay contrast requires manual inspection, as automated contrast cannot infer the changing map background.
- Axe audit on the new-world dialog: **0 violations and 0 incomplete checks**.
- The design detector found one warning for a width transition on a progress indicator; that transition was removed.
- Independent interface review identified missing thematic legends and an inconsistent selected-layer icon. Both were corrected. The review's final disposition was **ship**, scoped to those two fixes, with no visible regressions from the fix batch.
- Final legend captures were taken from the compiled production build at `http://127.0.0.1:4173/`, after importing the exported world. Population, contentment, food, terrain, trade, and military legends were inspected, along with the layer menu. Production build and formatting checks passed after the fixes.
- Some QA browser screenshot commands stalled, including redundant recapture attempts after the required images had been obtained. Only the affected task commands were stopped. The final review used valid captures opened directly from disk; the gameplay and export/import results above were observed independently of these tooling failures.

## Remaining limits

These checks validate implemented behavior and internal invariants. They do not establish historical realism, numerical calibration against empirical data, compatibility with all browsers, or production deployment. The full model boundaries are documented in MODEL.md and the app's help dialog.
