# Urban evolution qualification — 28–29 October 2026

The eight delivery milestones implement persistent building fabric, continuous local access, demand-led activity preferences, paid renewal, street improvements, and derived neighbourhood character. These are synthetic mechanisms, not calibrated historical forecasts.

## What now changes a city

Buildings retain floor uses, condition, age, occupants and redevelopment history. Local demand can fund repair, extension, conversion, replacement or consolidation. Replacement reserves real accommodation before withdrawing capacity; projects pay existing workers and consume recorded materials. Existing owners, firms and public sponsors can fund work when the local contractor cannot finance it alone.

Connected streets influence access across internal accounting boundaries. Busy streets can widen, winding approaches can straighten, and disconnected ends can connect where land and buildings permit. Existing junctions, water and sovereign access still constrain projects. District names describe actual local uses; they do not impose zoning barriers.

Legacy cities enter the same system gradually. Small compact supports can be surveyed completely; large supports release a bounded number of buildings while retaining their remaining aggregate housing and assets. This is a census refinement, not new construction. View queries cannot initiate it. Blocked parcels wait without losing their census.

The inspector explains current character, retained older fabric, condition, active works, remaining time and rehousing. Physical rendering carries use, height, condition and construction progress.

## Controlled comparisons

`tests/urban-controlled-qualification.ts` runs three prescribed neighbourhoods for 48 months, each with evolution enabled/disabled and with one-month/six-month integration: twelve runs in total. Initial population is 96, existing enterprise employment is 80, and initial floor area is 8,640 m². Labour availability and demand inputs are prescribed; cash and materials are finite existing balances.

| Treatment | Enabled outcome | Disabled control |
| --- | --- | --- |
| Fixed-population market neighbourhood | 24 buildings become 17 through seven completed consolidations; another consolidation is funded. Ten older buildings remain. | 24 unchanged buildings; no projects |
| Freight specialization | 252 m² becomes production space and 504 m² becomes logistics space; all 24 buildings remain. | No production/logistics floor space |
| Decline and recovery | Four worn buildings are replaced; 252 m² becomes logistics space; 20 older buildings remain. | No replacement or conversion |
| Detoured crossing approach | Funded straightening reduces travel from 13.66 to 5.85 minutes; the old route remains during works. | Unchanged route before completion |
| Internal accounting boundary | All 24 surveyed frontage plots lie across the neighbouring pool boundary; renaming pools leaves access unchanged. | Same route under different accounting names |

Every trajectory asserts constant population, equal opening/closing enterprise employment, money conservation, exact timber/stone consumption, unchanged total floor area, disabled-control stability and physical treatment effects. Monthly and six-month runs agree on physical census, geometry hashes, uses, condition, retained older buildings and project state. Housing capacity may fall during rebuilding or conversion; population is preserved through existing vacancies. Conversion cannot increase housing capacity when housing floor space is removed. Consolidation preserves the combined footprint area instead of treating the intervening gap as free floor space.

The crossing case is a prescribed detour, not a hydrological experiment. Separate street/river tests enforce terrain and water exclusions.

Machine-readable evidence: [controlled trajectories](urban-evolution-controlled-2026-10-28.json).

## Full-engine endurance and performance

Two regional frontier seeds, `Urban estuary` and `Urban highlands`, are each run for 120 months with evolution disabled and enabled, starting from paired copies of the same generated world. Each run checks demographic conservation every step, money net of bank creation/destruction, periodic world/ledger/goods/bank/national-account validation, and compressed-save restoration followed by an identical monthly continuation.

Final measurements and source fingerprints are in [full-engine trajectories](urban-evolution-world-2026-10-28.json). Timing includes the save and its two continuation ticks; step percentiles measure six-month integration calls. These are single runs on a shared machine, not isolated performance estimates or World-scale qualification.

| Seed | Evolution | Completed projects | Total wall / CPU seconds | Median / p95 step seconds |
| --- | --- | --- | --- | --- |
| Estuary | Disabled | 0 | 113.9 / 115.5 | 5.46 / 8.48 |
| Estuary | Enabled | 1 | 114.1 / 121.3 | 4.72 / 9.91 |
| Highlands | Disabled | 0 | 70.0 / 76.3 | 3.38 / 5.66 |
| Highlands | Enabled | 0 | 138.3 / 108.3 | 4.61 / 43.29 |

All four trajectories completed and restored deterministically. The highlands enabled run contains a large wall-time outlier; this report does not interpret contended single-run timing as a guaranteed frame rate or throughput improvement. The earlier independent four-run snapshot also passed; final evidence uses the later run above.

The mechanism is deliberately conditional: young frontier towns can finish a decade with little renewal. The mature-neighbourhood experiments demonstrate the causal consolidation and specialization effects; the frontier runs check integration, endogenous funding and conservation rather than guaranteeing a particular urban form.

Route work is bounded through spatial indexes, reusable origin trees and attachment caches. Reviews consider at most 48 building candidates and 32 street candidates per six-month review. Full-engine measurements were used to find and remove repeated graph reconstruction and repeated route-tree searches.

## Regression, persistence and interface checks

- The 81 distinct regression cases passed across the recorded batches. Focused urban, building, rendering, settlement and local-demand suite: 69 passing checks before the expanded legacy coverage. The final legacy suite and changed renewal tests were then rerun separately; exact totals and results are recorded in the evidence manifest.
- Adaptive-world regression: nine checks passed initially; the remaining representative-commute fixture moved sites without invalidating cached mesh membership. Publishing that fixture change through its revision fixed the failure; the original itinerary and read-only assertions now pass.
- Construction and funding tests reconcile goods, money, bank balances and national accounts; reject unaffordable work and unavailable rehousing; preserve incomplete projects through saves; and check equal wages for equal person-months at different integration steps.
- Legacy tests cover small and large parcels, four-storey bounds, retained floor area/capital/ownership, non-mutating views, blocked frontage, a generated legacy city, compressed saves and subsequent full-engine advancement.
- Production build and TypeScript checks pass. Vite still reports the existing large-bundle advisory.
- The new panel was inspected at 1440×1000 and 390×844 in both the controlled component harness and the complete application. Neither viewport has horizontal overflow. Phone-width refresh and close controls work. Controlled-panel accessibility: 11 passes, zero violations, zero incomplete checks.
- The generated six-month legacy save was imported into the complete app, advanced to month seven, and read back as saved in August 1720 without runtime errors.
- Required fresh UI review used the skill's documented fallback roles; its separator-token correction was applied and re-reviewed with a final `ship` verdict. Existing design documents were preserved.

UI evidence: [interface checks](urban-evolution-ui-2026-10-28.json). Local captures are under `.impeccable/review/urban-evolution/` and are intentionally ignored by Git.

## Limits and interpretation

Street loads are estimates from recorded residents and establishment capacity, not a new simulation of every trip. Firm payroll and market accounting remain at their existing resolution; physical premises distribute existing employment without inventing jobs. Local services and market uses are supported by existing economic activity, not independently simulated storefront businesses.

Legacy surveys are bounded and leave explicit unsurveyed remainders. They do not instantly reconstruct every old city. Funding, spare accommodation, usable land and persistent demand can legitimately delay renewal. Calibration constants are synthetic. The long runs qualify Regional scale; larger worlds and centuries of accumulated project history require separate performance measurements.

The checkout also contained concurrent economy, configuration, military and interface work. Only urban-owned changes and the corrected regression fixture are committed here. The [evidence manifest](urban-evolution-evidence-2026-10-28.json) records working-source fingerprints because a Git revision alone does not identify a shared dirty checkout. Endurance retained a fixed source snapshot; the final consolidation-footprint and legacy-survey corrections were checked by the targeted tests and controlled trajectories. Frontier endurance does not exercise legacy surveying.
