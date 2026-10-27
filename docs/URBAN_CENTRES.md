# Urban centres and block detail

Implemented and calibrated 27 October 2026. These are synthetic mechanisms, not historical estimates.

## Identity and metropolitan integration

Connected occupied development remains a physical settlement component. It can now contain several persistent named centres. Existing centres retain their IDs, founding dates, names, nuclei and local street frames when components meet. A multi-source shortest-path partition over accessible occupied-plot connections assigns each home to exactly one centre. This neither moves residents nor changes buildings, capacity, accounts or municipal boundaries. Numerical leaves and observer zoom do not determine membership.

The shared area's leading centre is selected using prestige and wealth. A challenger must exceed an incumbent's combined standing by 20% to replace it. The indicators are descriptive:

- Prestige combines the square root of population relative to 500 residents, logarithmic age in decades, and a national-capital bonus. It is a declared proxy for scale, historical continuity and civic status.
- Wealth per resident combines recorded housing investment with the centre's population-proportional share of its economic pools' household deposits. Deposits are an attributed pool average, not measured building-level wealth or a complete net-worth account.

Centres first become linked. Comparable centres can remain linked indefinitely. Incorporation requires the leader to have at least 1.5 times the prestige and a wealth ratio of at least 1.25, sustained for 120 months. Wealth ratios use `(1 + leader wealth per resident) / (1 + other wealth per resident)` to handle zero balances. Incorporation retains the subordinate centre as a named district.

A full merger requires prestige and wealth ratios of at least 2 and 1.75, sustained for 240 months after incorporation (or after overwhelming dominance begins, if later). For new relationships, the earliest full merger is therefore after 30 years of continuous dominance. The successor receives the active footprint and aliases; the absorbed record retains its ID, name, nucleus, founding date and dated history. Its active population and footprint are cleared to prevent double counting. Old-save incorporations and successions remain dated historical records and are not automatically undone; the revised merger delay starts from the recorded incorporation or later overwhelming dominance.

Both transitions require broad occupied contact: at least three distinct adjacent sites on each side, with the contact extending at least 64 metres. A thin ribbon can link an urban area without qualifying it for incorporation. Interrupted dominance resets its corresponding timer. Repeated refreshes within a month do not advance time. Physical separation clears the metropolitan relationship and records separation; fully absorbed entities remain historical.

Legal municipality/province changes remain separate. No political annexation or account transfer occurs through this identity mechanism.

## Blocks

`urbanBlocks` derives sparse summaries on aligned 32, 64, 128, 256 or 512 metre squares. The map publishes 128 metre blocks. These are analysis areas independent of the active quadtree, not new surveyed property boundaries or street-enclosed parcels.

Each block reports residents, housing capacity, vacancies, paid pending capacity, employment, building count, recorded footprint area, surveyed lane length and centre membership. Population, capacity, employment and building counts use recorded site positions exactly once. Footprint areas and lane lengths are clipped across block boundaries. Coarse legacy housing is marked explicitly and is not presented as a measured building census. Summaries have no financial balances and are regenerated from physical state instead of saved as another authority.

The existing map context retains building/cell inspection and adds a block summary and **Inspect block**. The underlying 8 metre minimum for frontier buildings and camera-independent remeshing rules remain unchanged. This implementation does not reconstruct coarse established cities into new buildings.

## Housing demand and construction

Physical demand centres are selected from the best accessible home locations in each 128 metre block, suppressing equivalent reachable candidates within 256 metres. Empty, unfunded records cannot suppress real centres. Selection uses existing workplace/service accessibility, independently of city names, rank and metropolitan membership.

Each origin's annualized moving budget is divided among reachable improvements, including travel-time costs. More candidate destinations cannot multiply that budget. Growth deficits share the economic pool's overall shortage. Vacancies and pending construction are assigned once to a nearby accessible centre; a project at one centre does not automatically cancel another centre's demand.

Each pool can fund multiple requested locations in a month. Each investment rechecks remaining labor, cash and materials after earlier projects. Nearby rebuilding is compared with paid outward expansion; the rebuilding search stays within 256 metres of its demand centre. A site's pending project is never funded again. Capacity arrives after the existing three-month construction lag. The maximum of local growth and relocation demand is used to avoid adding both demands for the same residents.

## Validation boundaries

Focused tests cover identity continuity through contact/separation, broad versus ribbon connectivity, wealth/prestige conditions and elapsed-time thresholds, conserved block aggregation across scales, bounded demand, local pending supply, multiple funded construction projects, resolution invariance, compressed saves and deterministic monthly continuation. Existing frontier, accounting, influence and display/storage suites exercise integration.

Desktop and mobile captures check the real block inspector in an isolated world. The independent fallback UI reviewer returned `ship` for that captured extension. The metropolitan caption is source-reviewed; the captured settlement has no metropolitan relationship. No century-scale historical or economic qualification is implied.

## Long-run calibration

The initial implementation was committed as `bab345e` before calibration. Long runs use a frozen copy of the current working simulation, including the separately developed frontier/building and performance foundations. They are not presented as runs of that commit alone. The validation report records source hashes; the baseline and tuned copies differ only in `urban-centres.ts`.

The policy experiment advances fifteen controlled pairs monthly for fifty years under six candidate settings. It uses real building-footprint connectivity and catchment partitioning, with prescribed population and wealth paths. It does not simulate an economy or estimate historical merger probabilities. The selected settings separate the following behaviors:

| Scenario | Initial policy | Calibrated policy |
| --- | --- | --- |
| Eight-year wealth boom | Incorporates in year 5 | Remains distinct |
| 16-to-1 metropolis with twice the per-person wealth | Incorporates; never fully merges | Incorporates in year 10; merges in year 30 |
| Moderately wealthier dominant metropolis | Incorporates only | Incorporates only |
| Satellite growing 4% annually toward its neighbour | Incorporates only | Incorporates only |
| Interrupted dominance, returning in year 8 | Incorporates in year 13 | Incorporates in year 18; merges in year 38 |
| Equal peers, large poor centre, wealthy peer, old prestigious centre, narrow ribbon | Remain distinct | Remain distinct |

Simply lowering merger barriers with the original delays also merges the catching-up satellite in year 20. Increasing the delay prevents that irreversible transition before its prestige gap closes. Lowering the incorporation ratios to 1.35/1.15 additionally incorporates a neighbour with only a 20% wealth advantage, so the original 1.5/1.25 incorporation ratios remain. A forty-year earliest merger produced the same stable outcomes as thirty years in these scenarios; it added delay without another demonstrated benefit.

The full-world runs separately check monthly population conservation, annual save validation, unique centre catchments, block population totals and money conservation adjusted for recorded bank creation/destruction. A same-seed tuned replay checks whether changing identity policy changes the physical trajectory. Their economic and growth results, including failures of plausibility, belong in the accompanying [calibration evidence](validation/urban-calibration-2026-10-27.json). Passing conservation checks does not establish a healthy or historically plausible economy.

| Regional world | Duration | Population | Active centres | Natural integration |
| --- | --- | --- | --- | --- |
| Urban estuary, frontier | 50 years | 22,046 → 4,211 (−80.9%) | 8 → 16 peak → 4 | None |
| Urban highlands, frontier | 50 years | 22,652 → 2,758 (−87.8%) | 8 → 15 peak → 3 | None |
| Urban crossroads, settled | 40 years | 10,866,003 → 6,428,037 (−40.8%) | 166 → 367 peak → 287 | Four linked pairs at the end; no incorporations or full mergers |

Frontier housing capacity rose from 25,518 to 31,120 spaces and from 26,261 to 31,162, largely during early settlement founding, then stayed flat. Mean annual food coverage was only 54% and 52%, with deaths greatly exceeding births. The established world added housing while losing population and fragmenting into more named centres. These are unresolved economic and settlement-growth problems; identity thresholds cannot repair food supply or cause occupied towns to meet. Natural merger rates are therefore **not** qualified by these runs. The wealth and prestige settings remain a conservative behavioral calibration from the [controlled comparison](validation/urban-policy-sensitivity-2026-10-27.json), not a fit to a desired number of mergers.

The complete fifty-year Estuary replay produced an identical final save under the tuned rules. The settled replay continued from year 30 through year 40 and also produced an identical final save. Its shared checkpoint was verified: no earlier incorporation or merger, unchanged incorporation ratios with a longer new waiting period, and no current overwhelming dominance under either policy. Thus the two policies have the same state at that checkpoint. All 25 focused checks passed both in the working simulation and in the isolated commit contents; production build and harness type checks passed.

Reproduce the controlled comparison with `node --import tsx tests/urban-policy-calibration.ts /tmp/urban-policy.json`, and the long trajectories with `node --import tsx tests/urban-calibration.ts --engine-root /path/to/frozen/checkout --seed 'Urban estuary' --start frontier --months 600 --output /tmp/urban-estuary.json`. The trajectory harness requires the spatial-preparation/frontier foundation and rejects an older engine without it. `--start settled` checks established worlds. `--resume /path/to/checkpoint.json` continues a recorded world; `--months` remains the absolute ending month, and the report records the starting month. No model calls, browser saves or live games are involved.
