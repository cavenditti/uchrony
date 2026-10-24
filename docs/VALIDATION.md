# Validation record

Verified locally on 24 October 2026 using Node 26.11.1 and Chrome for Testing 151.0.7922.47. Results are grouped by implementation revision below; no production deployment is implied.

## Current asynchronous history and statecraft work

Durable autosaves pass seven focused tests for independent disk/database failure, newest-replica selection, legacy restoration without mutation, failed-restore preservation, ordered/coalesced writes, stale-notification suppression, same-origin HTTP writes, browser-slot isolation and atomic disk recovery from a damaged current file. The disk test round-trips a world over 7 MB. In an isolated browser with model calls disabled, a 9.26 MB fixture reproduced `QuotaExceededError` in the old localStorage path, then saved to disk and restored after reload. With the disk API deliberately unavailable, its next month saved and restored through IndexedDB without a warning. Existing local save files were preserved, including a verified 168-month world. This is targeted storage qualification; broad simulation qualification remains deferred.

Agreement references pass six focused regressions covering canonical/legacy parsing, ordinary-number preservation, title-based local links to older agreements, confidential and unavailable references, escaped model text, retention of cited/counteroffer ancestors (including cycles), unchanged signed records, visibility-filtered agent catalogs and full save validation. The TypeScript/Vite build passes. Live provider adherence to the new citation format and interactive browser navigation remain part of the deferred consolidated qualification.

The army/navy revision passed a focused 12-month accounting run plus exact save continuation: eight paid fleets started in the generated world, civilian and military identity/age totals remained valid, every monthly population equaled the previous total plus births minus deaths, and full save validation passed. The run ended at month 13 with eight recorded army supply deliveries and a 3.37 MB save. A separate fixture exercised water-only sailing, embarkation and disembarkation, blockade closure and relief, supply isolation and identity-preserving desertion. These are focused checks, not broad military balance or live strategic-agent/browser qualification; the consolidated test pass remains deferred.

The state-character revision passes a focused seven-month check: seeded profiles reproduce exactly and differ between states; succession changes leader skills and generation while preserving policies, population and relations; stale replies from the previous leader cannot execute orders; leadership effects remain bounded and work without active historical modifiers; monthly population accounting and full save validation pass; save continuation is exact; legacy character initialization preserves policies and historical leaders; unknown perks are rejected; public attitude changes remain gradual. A fixture also checks that foreign posture summaries omit private skill records. The build passes. Live agent personality adherence, long-run political balance and browser qualification remain deferred.

The dynamic population revision passes the TypeScript/Vite build and a focused 24-month census check plus a save-continuation tick. Every monthly total equaled the previous population plus births minus deaths; every community age sum matched its province and every military profile matched troop numbers. The same check covered identity-preserving recruitment/demobilization, no instant cultural relabeling from a state policy, seeding a new belief, forced migration (13,460 refugee arrivals in the scenario), deterministic save continuation, legacy census initialization and a new state's identity initialization. The scenario ended at month 25 with 2,991 civilian community records and a 3.58 MB save. This is a narrow accounting check; it does not qualify long-run population behavior, large census performance, social balance or the new browser controls. Broad tests and browser qualification remain deferred at the user's request.

The current TypeScript/Vite build passes. Broad regression, long-run and browser qualification remain deferred at the user's request during rapid feature iteration.

A live provider diagnostic reproduced the reported historical integration defect: OpenRouter returned HTTP 200, but its draft contained `target: -1` for national effects and an unsupported `unrest` modifier. The contract now distinguishes effect kinds, resolves actor-relative national targets, and offers one structured repair attempt. Subsequent bounded live requests both passed first-attempt local validation: DeepSeek V4.1 Flash returned a 445-character historical summary, and Ministral 8B returned a valid routine-state plan. These checks used synthetic contexts and did not alter the user's browser world.

A focused local 24-month check advanced successfully without any provider results, recording four local historical events. A secret two-party settlement collected exact consent, passed adjudication, transferred real treasury funds without changing their total, passed save validation, and was absent from an unrelated state's model context. This is a narrow functional check, not full state-agent or referee qualification. Live multi-state negotiation, broad browser behavior, adversarial prompting and long-run balances remain to be tested.

The corridor work immediately preceding these additions passed 35 regression tests before its final cache/lazy-planning optimization. A controlled 48-month crossing experiment joined 34 previously unshared segments, accepted two extra travel segments for about 21.7% lower learned transport effort, and changed its path once at month 12. One 200-year corridor run completed with population 20,515,783, eight states, 306 shipments and 294 event IDs; the remaining long runs were stopped for faster iteration. Those results do **not** qualify the later historical-effects/statecraft changes.

## Trade inertia revision

`npm run build`, `npm run format:check`, and **30 tests** pass. Six new regressions cover gradual supplier replacement, stability under small cost changes, small repeat orders, inactive memory decay and expiry, immediate war/supply/food overrides, physical route hysteresis, freight/treasury conservation and capacity, exact save continuation, legacy initialization, and malformed memory rejection.

`npm run test:trade-stability` runs three 20-year scenarios and measures months 61–240. A recurring supplier is the same origin, destination, and good as in the preceding month, weighted by current freight tonnage. Monthly reallocation is `sum(abs(current - previous)) / sum(current + previous)` across those relationships; it includes changes in total volume. Baseline is commit `45bf3da`, using the same seeds and measurement script. These are evolving synthetic scenarios, not calibrated economic observations.

| Seed | Recurring supplier, before | Recurring supplier, after | Reallocation, before | Reallocation, after |
| --- | ---: | ---: | ---: | ---: |
| A world unwritten | 25.22% | 96.56% | 77.29% | 5.04% |
| Long winter | 22.35% | 82.66% | 80.42% | 21.46% |
| Maritime republics | 27.49% | 82.97% | 76.40% | 22.80% |

Three 200-year runs also pass monthly population accounting and periodic save validation:

| Seed | Final population | Surviving states | Active routes | Event IDs |
| --- | ---: | ---: | ---: | ---: |
| A world unwritten | 20,747,827 | 8 | 384 | 272 |
| Long winter | 20,186,560 | 6 | 437 | 525 |
| Maritime republics | 20,723,378 | 7 | 358 | 579 |

The compiled browser build imports the prior 20-year save without trade memory and initializes 473 remembered relationships on the next monthly tick. Reloading restores the same month and an identical SHA-256 digest of the serialized trade memory. The updated economy explanation and eight shipment rows render successfully, with no browser runtime errors.

## Geographic freight revision

The trade network and renderer pass `npm run build`, `npm run format:check`, and **24 tests**. Five new regressions exercise water-only navigation around headlands, disconnected seas, low mountain passes, road and harbor continuity across three generated worlds, symmetric civilian costs and directional military access, exact shipment geometry, malformed/legacy save handling, and aggregation of opposing flows. Existing tests still verify conservation of goods and treasury, shared connection capacity, deterministic continuation, and population accounting.

All three 200-year / 2,400-month runs pass after the new transport model, with monthly population accounting and periodic full save validation:

| Seed | Final population | Surviving states | Active routes | Event IDs |
| --- | ---: | ---: | ---: | ---: |
| A world unwritten | 20,045,246 | 8 | 136 | 267 |
| Long winter | 19,545,715 | 7 | 169 | 707 |
| Maritime republics | 20,802,169 | 6 | 113 | 349 |

The original JSON export from January 1722 imports successfully; its route refresh notice appears, and advancing one month generates geographic route legs. Browser checks also use a 20-year world with 269 shipments, including 117 journeys with shipping legs. The 1440px desktop and 390px phone layouts have no horizontal overflow; the cargo ledger, mixed-mode legs, harbor markers, and province highlighting were checked. No browser runtime errors were reported. Final desktop, local detail, and phone captures are under `.impeccable/review/trade-final-*.png` (local, ignored by Git).

## Map generation and rendering revision

The revised generator and renderer pass `npm run build`, `npm run format:check`, and **19 tests**. Six geography-specific regressions cover major-landmass counts over three seeds and four settings, the ocean boundary, downstream reachability and runoff, connected provinces and polygon hit testing, static-geometry cache invalidation, pointer-anchored zoom, and legacy-save compatibility/rejection of malformed drainage. The existing simulation suite still passes, including the 100-year validity check and deterministic save continuation.

The three 200-year / 2,400-month soak runs completed on the revised geography, with monthly population accounting and periodic full save validation:

| Seed | Final population | Surviving states | Active routes | Event IDs |
| --- | ---: | ---: | ---: | ---: |
| A world unwritten | 20,334,747 | 8 | 133 | 292 |
| Long winter | 19,839,054 | 6 | 127 | 623 |
| Maritime republics | 20,491,661 | 7 | 130 | 434 |

Browser verification uses the compiled build on local port 4174. The political atlas, terrain, zoomed detail, mobile layout, and legend views were inspected. Clicking Aurel's rendered center selected the correct province. The geometry controls generated a different five-continent, twelve-state world. The 390px phone layout has no horizontal overflow. A real JSON export from the initial build was imported and advanced from January 1722 to January 1723 successfully; no browser runtime errors were reported. Captures are under `.impeccable/review/map-final-*.png` (local, ignored by Git).

The following initial-build record is retained as historical evidence. Its **1,080-year run belongs to the original generator**; the revised generator has the three 200-year runs above, not a new 1,080-year qualification.

## Initial-build automated checks

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
