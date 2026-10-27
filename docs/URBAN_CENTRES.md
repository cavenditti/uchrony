# Urban centres and block detail

Implemented 27 October 2026. These are synthetic mechanisms with explicit initial calibration, not historical estimates.

## Identity and metropolitan integration

Connected occupied development remains a physical settlement component. It can now contain several persistent named centres. Existing centres retain their IDs, founding dates, names, nuclei and local street frames when components meet. A multi-source shortest-path partition over accessible occupied-plot connections assigns each home to exactly one centre. This neither moves residents nor changes buildings, capacity, accounts or municipal boundaries. Numerical leaves and observer zoom do not determine membership.

The shared area's leading centre is selected using prestige and wealth. A challenger must exceed an incumbent's combined standing by 20% to replace it. The indicators are descriptive:

- Prestige combines the square root of population relative to 500 residents, logarithmic age in decades, and a national-capital bonus. It is a declared proxy for scale, historical continuity and civic status.
- Wealth per resident combines recorded housing investment with the centre's population-proportional share of its economic pools' household deposits. Deposits are an attributed pool average, not measured building-level wealth or a complete net-worth account.

Centres first become linked. Comparable centres can remain linked indefinitely. Incorporation requires the leader to have at least 1.5 times the prestige and a wealth ratio of at least 1.25, sustained for 60 months. Wealth ratios use `(1 + leader wealth per resident) / (1 + other wealth per resident)` to handle zero balances. Incorporation retains the subordinate centre as a named district.

A full merger requires prestige and wealth ratios of at least 3 and 2, sustained for 180 months after incorporation (or after overwhelming dominance begins, if later). The successor receives the active footprint and aliases; the absorbed record retains its ID, name, nucleus, founding date and dated history. Its active population and footprint are cleared to prevent double counting. Old-save successions remain historical records and are not automatically undone.

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
