# Dynamic square grid

New worlds use `gridTopology: "square-v1"` and geography generator 5. The active numerical grid is a balanced quadtree covering land and water. Terrain samples are aligned 1,024 m squares (12 render units), centred at `(q + 0.5, r + 0.5)` sample spans. The root starts at `(0, 0)` and has a power-of-two number of sample spans. Every subdivision therefore has exactly the same outer boundary and area as its parent. There is no hex topology or staggered-row coordinate adapter.

Terrain samples retain stable identities for measured geography, resources, legal claims and surveyed transport waypoints. Numerical leaves have separate string addresses (`r`, `r0`, `r01`, …) and may aggregate many samples or subdivide one. Economic accounts and physical sites have their own stable identities. Splitting a numerical cell never divides a bank account, moves a building or creates inhabitants.

## Geometry and behavior

- Active leaves partition the physical domain exactly once, with no active ancestor and descendant together. Neighbouring leaf sizes differ by at most two. Source-by-source land and water area are conserved. Shared interfaces report exact land, water and coast contact lengths. Padding beyond the rectangular world is excluded.
- Density, workplaces, price variation, known terrain variation, coasts, river activity, established traffic and fleets drive refinement down to 128 m. Distinct split/merge thresholds, a twelve-month dwell period and a six-month scheduled remesh prevent numerical oscillation. Camera movement never changes simulation resolution. Refinement does not invent finer geological data.
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
