# Dynamic square grid

Urban update, 27 October 2026: connected development now preserves multiple centres, with wealth/prestige-dependent incorporation and eventual identity merger. Sparse block summaries and demand across several physical centres are described in [Urban centres and block detail](URBAN_CENTRES.md). This supersedes the immediate city-identity merging described in the earlier implementation notes below; numerical refinement and legal administration remain separate.

New worlds use `gridTopology: "square-v1"` and geography generator 5. The active numerical grid is a balanced quadtree covering land and water. Terrain samples are aligned 1,024 m squares (12 render units), centred at `(q + 0.5, r + 0.5)` sample spans. The root starts at `(0, 0)` and has a power-of-two number of sample spans. Every subdivision therefore has exactly the same outer boundary and area as its parent. There is no hex topology or staggered-row coordinate adapter.

Terrain samples retain stable identities for measured geography, resources, legal claims and surveyed transport waypoints. Numerical leaves have separate string addresses (`r`, `r0`, `r01`, …) and may aggregate many samples or subdivide one. Economic accounts and physical sites have their own stable identities. Splitting a numerical cell never divides a bank account, moves a building or creates inhabitants.

## Geometry and behavior

- Active leaves partition the physical domain exactly once, with no active ancestor and descendant together. Neighbouring leaf sizes differ by at most two. Source-by-source land and water area are conserved. Shared interfaces report exact land, water and coast contact lengths. Padding beyond the rectangular world is excluded.
- Density, workplaces, live-site workload (site count / 64), price variation, known terrain variation, coasts, river activity, established traffic and fleets drive refinement down to 128 m. Distinct split/merge thresholds, a twelve-month dwell period and a six-month scheduled remesh prevent numerical oscillation. Camera movement never changes simulation resolution. Refinement does not invent finer geological data.
- Aligned fragments contained in one child are reused instead of repeatedly clipped. Only fragments intersected by a subdivision allocate new polygons.
- Administrative contiguity uses shared faces. Roads and sailing may use diagonals, charged by physical distance; diagonal land/water transitions and travel between blocking corners are forbidden. Ports require a shared face. Fleet movement accounts for fractional progress along a diagonal and retains it in saves.
- River erosion, runoff accumulation and descending drainage are unchanged in method. Eight distance-weighted directions adapt that method to squares. Existing smooth reach, confluence, estuary and terrain-following rendering remains in place.
- Residential parcels and their occupants keep metre coordinates through every split/merge. Construction and relocation remain funded economic actions. Spatial queries use the tree, then exact physical distance/geometry; numerical size is never free travel or new construction.
- The same square footprints serve physical access, map boundaries and point selection. Coasts retain presentation smoothing; that smoothing does not change the authoritative land mask. The old whole-cell urban tint is removed; settlement scenery supplies the developed footprint.

## APIs

| API                                                                   | Purpose                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `adaptiveMesh(world)`                                                 | Reconstruct/read the current authoritative partition and derived totals                          |
| `adaptiveGrid(world)`                                                 | Read leaves, ID lookup and symmetric physical adjacency                                          |
| `locateAdaptiveCell(world, point)`                                    | Resolve a meter position to an active leaf and exact source fragment; reject outside-domain gaps |
| `queryAdaptiveLeaves(world, bounds)`                                  | Recursively select intersecting leaves                                                           |
| `queryAdaptiveSitesInBounds(world, bounds, predicate?)`               | Select exact live site positions within a rectangle                                              |
| `queryAdaptiveSites(world, point, radius, predicate?)`                | Select exact live sites within a radius                                                          |
| `nearestAdaptiveSites(world, point, count, predicate?, maxDistance?)` | Find nearest qualifying sites with branch-and-bound pruning                                      |
| `refreshAdaptiveTotals(world)`                                        | Refresh membership/totals after authoritative site changes, without changing the partition       |
| `commuteSiteRoute(world, from, to, limit?)`                           | Compute access using physical site positions and surveyed links                                  |

Call the membership refresh after adding or moving sites before querying their new positions. Queries are read-only and never initialize new housing or rewrite saved tree state. Returned site objects belong to the authoritative world; callers must not mutate them in inspection code.

## Saves and storage

This release requires newly generated square worlds, as explicitly chosen for the topology change. Saves without `square-v1` are rejected before entering the simulation, with a message to create a new world. They are never silently interpreted as squares.

The production disk namespace is `.uchrony/autosaves/square-v1/`, and the browser database is `uchrony-square-saves`. Earlier disk files and the `uchrony-saves` database remain untouched. Square saves preserve the complete land/water tree, hysteresis, physical sites, ownership and fractional sailing progress. Load validation checks the grid marker, exact sample centres, fixed metre scale, full partition coverage and traversable routes.

## Validation and model boundary

`tests/square-grid.test.ts` checks shared physical/rendered boundaries, corner junctions, point selection, diagonal distance costs and blocked corner passage. The adaptive grid tests check complete conservative coverage, physical interfaces, recursive query equivalence and save rejection. Existing geography, hydrology, transport, military, settlement and rendering tests exercise integration.

Run `node --expose-gc --import tsx tests/qualify-adaptive-grid.ts` for the 8,064- and 129,024-sample offline qualification. Its default output is `docs/validation/square-grid-2026-10-26.json`; an optional first argument selects another report path. It measures remeshing and verified queries, not browser frame rate or sustained economic throughput. The earlier hex-over-quadtree report remains historical evidence; changed source geography and leaf counts prevent an exact speedup comparison.

The quadtree adapts computational coverage, not terrain knowledge or property boundaries. Transport corridors are persistent physical networks rather than edges automatically created by numerical refinement. Military commands remain provincial, and economic populations retain permanent household/market ownership records. Those entities are distinct from numerical cells.

The square integration qualification is recorded in [square-integration-2026-10-26.json](validation/square-integration-2026-10-26.json): 111 distinct targeted tests passed across the integration runs, along with the production build and an isolated largest-world browser check at desktop and phone sizes. The browser generated a fresh world, advanced a month, inspected local life, saved and restored both replicas, and retained an old-database sentinel unchanged. This is not a complete long-duration suite. The separate mesh benchmark measured 67,443 adaptive leaves and a 957 ms rebuild for the 129,024-sample world on this machine; it is not a browser frame-rate measurement.

## Parallel influence and dense settlements

The housing solver now builds immutable work/service influence snapshots without city entities. A separate source quadtree inside each terrain sample aggregates coincident workplaces exactly and accepts distant branches under a 2% relative kernel-error bound. Reverse network search establishes accessible source cells before any aggregation; urban density, borders and water remain physical constraints. The source tree is independent of the current numerical partition.

Work is split into batches of at most 64 homes, including multiple batches inside a single terrain cell. A shared atomic queue distributes those batches across up to 32 workers, bounded by available hardware and workload. Input arrays are shared once, outputs have one writer, and reduction order is identical across worker counts. The owner worker waits for every batch to finish before applying housing decisions; idle dispatched workers do not delay an already complete field. Worker modules warm up asynchronously before playback. A worker failure or ten seconds without batch progress discards partial output and disables the pool in favor of the identical serial calculation. The UI thread never waits on this barrier. The local dev and preview servers provide the cross-origin isolation headers required for shared memory; other hosts must do the same to enable this path.

Home destinations are ranked once per pool rather than sorted for every origin. Connected-footprint discovery removes visited sites from per-leaf candidate sets, avoiding repeated scans through already consumed urban neighborhoods. City labels are an observer projection; physical density and paid housing development govern urban shares and attraction.

`tests/settlement-influence.test.ts` covers exhaustive field-error bounds, 100,000 coincident sources, real worker-count equivalence, failure recovery, city-label independence, funded service attraction and complete monthly/save continuation. `node --import tsx tests/qualify-influence.ts` records dense-field and World-scale field measurements. The million-home case is a numeric workload, not a claim that the full economy can advance a million independent household accounts at the same speed. The exact financial, cohort, trade, political and military phases remain serial.


### Qualification on 26 October 2026

- 67 focused adaptive economy, housing, influence, rendering and save tests passed; all 11 autosave tests passed with their local endpoint enabled. The final rendering/playback rerun passed all 12 tests. Production TypeScript/Vite build passed.
- In Chromium, four nested spatial workers produced the same numeric field as the serial solver. A World-scale map completed a month with 129,024 terrain samples, 96,881 physical sites and 47,076 leaves, then restored the saved population exactly (175,491,505). This month took 38.8 seconds during concurrent validation; it is not an isolated engine benchmark.
- The [numeric benchmark report](validation/parallel-influence-2026-10-26.json) includes 65,536 and 1,048,576 home queries plus a World-scale snapshot after its first month, with nonzero economic sources. Each parallel result matched every serial output element. The million-home shared input occupied 33.29 MiB; output buffers and worker/runtime memory are additional. Timing comparisons were single warmed runs and overlapped other validation, so they are diagnostic rather than statistical speedup estimates.
- The broad run completed 342 passing tests before final fixes. Its local HTTP permission failure and district-trade regression passed targeted reruns. An exact-save institution comparison still fails on signed zero; the same failure was reproduced from the unchanged baseline. The century-scale simulation test was stopped after more than half an hour; this change has no new century-scale qualification.

To reproduce the browser qualification, build `tests/browser/influence.config.ts`, preview that config, open `/tests/browser/influence.html`, and run the qualification. `/tests/browser/urban-density.html` exercises the same town renderer separately.
