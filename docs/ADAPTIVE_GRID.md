# Dynamic spatial grid

The active simulation grid is a balanced quadtree over the entire physical domain, including water. Numerical cells have stable string addresses (`r`, `r0`, `r01`, …); they are not entries in the original hex array. A leaf can cover several original hexes or a fraction of one. Its geometry consists of exact intersections with source terrain polygons.

The original hexes remain the imported/generated geography and compatibility reference for surveyed roads, drainage, mineral deposits, historical regions and existing saved commands. Their IDs are never recycled as adaptive cell IDs. They are not a second independently evolving population grid. Economic accounts, firms and physical sites retain their own identities when numerical cells split or merge.

## Why a quadtree

Regular hexagons do not exactly subdivide into smaller regular hexagons. For example, [H3 distinguishes exact logical containment from approximate geometric containment](https://h3geo.org/docs/highlights/indexing/). Uchrony needs exact area conservation and stable inherited geographic claims. Square quadtree bounds clipped to the existing polygons provide both, without pretending that every resulting polygon is a regular hexagon.

## Authority and behavior

- Active leaves cover the domain exactly once. An active ancestor cannot coexist with active descendants. Original terrain fragments retain their source identity, so coastlines and disconnected pieces are not filled in by a leaf's bounding square.
- Neighboring numerical levels differ by at most one. Every physical interface occurs once and reports its shared land, water and land/water boundary lengths. Bounding-square contact alone does not imply traversable land. A leaf can contain disconnected pieces; navigation must still check the physical route.
- Density, workplace activity, price variation, known elevation/moisture variation, coasts, rivers, established corridor traffic and fleet presence determine refinement. The minimum normal span is 125 meters; unknown subhex terrain or new mineral resources are never invented by refinement.
- Different split and merge thresholds and a twelve-month dwell period prevent rapid oscillation. The scheduled authoritative remesh runs every six simulated months. Between remeshes, derived membership and totals are refreshed. Camera movement never changes the partition.
- Residential sites can have explicit occupancy and persistent meter coordinates. Opening sites keep their inherited distribution. New physical parcels and capacity come from funded housing construction. Grid splits and merges regroup sites; they do not move residents, duplicate capacity or repartition financial accounts.
- Recursive site queries now serve labor-market candidate search, housing demand, relocation and detailed inspection. Range queries filter exact meter distance and return stable ID order. Nearest queries use geometric lower bounds and deterministic tie breaking. Both are independent of leaf size.
- Door-to-door access distinguishes two parcels inside the same old hex using their physical positions. Existing surveyed inter-cell links remain the physical transport network, with first/last walking legs; numerical refinement does not create a road.

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

## Saves and compatibility

`adaptive.tree.domain = "world"` marks full-domain partitions. Older saves without that marker reconstruct their original land-only tree unchanged; the next scheduled remesh expands coverage to water. Reconstruction verifies complete coverage and balance. Invalid overlapping, missing, or out-of-domain leaves are rejected. Physical sites must lie inside their actual source polygon, not merely within an approximate radius of its center.

The tree saves addresses and hysteresis history, not duplicated cut-cell polygons. Runtime geometry and query indices are derived caches. Persistent home/firm/market identities, legal claims, construction obligations and account IDs remain separate from those caches.

## Validation and current boundary

`tests/adaptive-grid.test.ts` checks complete land/water coverage, source-by-source area conservation, exact interfaces, absence of false sea connections, range/nearest equivalence to exhaustive queries, legacy tree migration, save rejection, physical site movement and fleet-triggered refinement/coarsening. The existing adaptive-world tests check accounting conservation, saved continuation, observer independence and economic equality across forced resolutions.

Run `node --expose-gc --import tsx tests/qualify-adaptive-grid.ts` for the reproducible 8,064- and 129,024-source-cell qualification. It writes [the measured results](validation/adaptive-grid-2026-10-26.json). Forced `fine` mode is a diagnostic workload: refining empty oceans is materially more expensive than adaptive operation. This qualification measures offline topology and queries; it does not establish browser frame rate or long-run economic plausibility.

This change makes the computational grid and residential locations adaptive. It does not replace the retained terrain raster with new geological detail, reconstruct the road/river network as continuously evolving geometry, or move army and fleet navigation entirely off their existing source geography. Those are distinct model migrations; source references remain explicit rather than being silently renumbered.
