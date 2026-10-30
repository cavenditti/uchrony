# Settlement fields, places and block detail

Revised 30 October 2026. Towns are no longer self-contained entities with their own connectivity and merger rules. Land is one continuum described by two smooth settlement fields; the only distinction between a city and the land around it is administrative: a *place* that arises from the fields' topology. These are synthetic mechanisms, not historical estimates. The earlier prestige/wealth identity model and its calibration are summarised under [Superseded centre integration](#superseded-centre-integration).

## Settlement fields

`settlement-field.ts` deposits the residents each home houses in **developed fabric** into a density field (residents per km²). A surveyed building or a funded compact parcel is fully developed. A coarse opening record is developed in proportion to its built cover, at the same `fullBuiltPopulationPerCell` rate that created that cover, so a partly built record splits continuously into compact and dispersed occupants instead of being classified wholesale. Vacant housing deposits nothing.

The fields live on canonical quadtree nodes below each 1,024 m terrain sample: aligned squares addressed like the adaptive mesh but independent of its active leaves. Each sample with mass owns a dense tile keyed by its stable ID. Both node sizes divide the sample, so every node lies in exactly one province and sovereign.

| Field | Nodes | Kernel half-width | Reads |
| --- | --- | --- | --- |
| Fabric | 32 m | 160 m (about a two-minute walk) | Urbanity of living conditions |
| Agglomeration | 256 m | 2,048 m (about a 25-minute walk) | Places, territories and agglomeration pull |

Each support (a parcel square, or a node for point-like buildings) is convolved with a separable biweight. Box ⊗ kernel has a closed form through the biweight CDF, so 850 m coarse parcels need no sub-sampling. Every 1D weight vector is normalized after clipping to the world, so each field conserves developed residents exactly (`Σ density × node area`), independent of the mesh and observer. Points are read bilinearly between node centres. Agglomeration values are reported as **reach**: developed residents within market distance, kernel-weighted, so an isolated building reads its own occupants.

**Urbanity** is `ρ² / (ρ² + ρ½²)` on the fabric field, a logistic in log-density with `ρ½ = 1,500/km²` (the Degree of Urbanisation's urban-centre density): about 4% at 300/km² and above 90% beyond 5,000/km². Developed residents take the urbanity of their own fabric; dispersed residents take their sample's mean developed density, so a farm beside a town is partly urban and one in open country is not. A pool's `urban` share is the occupant-weighted mean, replacing the former binary compact-parcel census. Production, identity mixing and fertility read this continuous share; district activity labels a pool `urban` once its mean urbanity reaches one half.

## Places

`settlement-topology.ts` partitions the agglomeration field's superlevel set `{reach ≥ placeReach}` (default 100 developed residents within reach) on habitable land into **urban areas**, one sovereign each. A single persistence-based clustering pass (union–find in descending density, as in ToMATo) builds the merge tree of density **modes**: each mode records its peak, the saddle where its basin first touches a higher one, and that parent. **Prominence** `(peak − saddle) / peak` measures how distinct a centre is from the land joining it to a larger one.

`places.ts` reads that tree:

- **Territory.** Every home within reach belongs to the place whose mode its node ascends to. Insignificant ripples resolve to their significant ancestor, and small unnamed basins join the place they adjoin. A place administers its town and hinterland alike; its census is every occupant of its homes.
- **Birth.** A significant mode (prominence ≥ `quarterBirth` 0.2, or an area summit) is named once the developed residents of its basin, plus unnamed basins pooled into it, reach the 500-person village threshold. A coarse rural record with a few new houses cannot found a town of its dispersed occupants.
- **Identity.** A place keeps the mode its nucleus (the occupied home nearest its peak) ascends to, so peaks can drift with growth while names persist. A held peak survives down to `quarterRetirement` 0.1. Below that, or when two places' nuclei reach one peak, the junior identity merges into the senior and survives as a dated alias.
- **Quarters.** The summit's place is principal. Other places are independent while their prominence is at least `incorporation` 0.4. Below it a place is *linked* to the nearest independent place above it in the merge tree, and becomes its quarter if that persists for `transitionMonths` (12). A quarter is released once its prominence reaches `release` 0.6 for as long. A newly named basin that is already a flank is born a quarter. Repeated refreshes within one month cannot advance a dwell.
- **Seat and label.** The nucleus anchors identity. The map label sits at the centre of mass of the place's core, the developed fabric within half of the peak's reach, never at a field node or sample centre.

**No lattice of identical towns.** At market scale, similar coarse records one sample apart blur into one plateau with one summit. Ripples over evenly settled land are insignificant, and the place is labelled at the plateau's centre of mass. A genuine concentration on that plateau becomes its summit and draws the label. In controlled scenarios a 5,000-person satellite of a 20,000-person city grades with distance: a shoulder of the city at 2.6 km, a quarter-range bump at 3 km, independent from 3.5 km, and a separate urban area beyond about 4.5 km. Density alone barely changes a satellite's prominence; new fabric between two towns does, so sprawl, not mere growth, absorbs a neighbour.

Places move no residents, buildings, accounts or legal jurisdictions. Legal municipalities and provinces (`jurisdictions.ts`) keep their own cost-driven reviews. The records use the `cities` registry. Retired prestige/wealth indicators, dominance timers, `urbanIntegration` settings and `settlements.minimumDensity` are no longer supported.

## Gravitation

Household location utility adds an agglomeration term to work and service access:

`u = 0.18 log(1 + A/100) + 0.12 log(1 + S/100) + 0.12 h + 0.1 log(1 + R/2000) − 0.25 (N/H)²`

`R` is developed residents within reach. The term is concave, so crowding and rising rebuilding costs bound any one centre. Existing residents still move only into vacancies and only when the gain exceeds the moving friction plus travel time. New households (each pool's capacity shortfall) no longer have to form where their parents live. Each home's share is split, logit-style with scale 0.15, between its local centre and reachable centres whose net utility is higher. Construction therefore follows demand into established centres instead of enlarging every coarse record in place. Fast-forward (coarse) periods keep the earlier local shortage rule.

Only developed fabric is drawn as townscape: a place's dispersed farm records stay countryside on the map, even though the place administers them.

## Opening geography

Generation decides how many urban residents each settlement has and which terrain sample holds its nucleus. `opening-settlements.ts` decides where on the land they live. Previously every resident of a settlement sat on its nucleus sample, whose support is capped at 850 m, so a 3,000-person town and a 60,000-person core were the same square at a sample centre.

- **Density law.** A nucleus is anchored off its sample's centre, and its residents follow Clark's negative exponential `ρ(r) = ρ₀ e^(−r/b)` with `N = 2πρ₀b²`. Core density rises weakly with size, `ρ₀ = openingCoreDensity · (N/10⁴)^openingDensityElasticity` (defaults 12,000/km² and 0.25), so the gradient length `b` is about 0.15 km for a village, 0.36 km for a 10,000-person town and 1.3 km for a 300,000-person city. Each sample's share is its integrated density (8×8 midpoint rule) within four gradient lengths, apportioned to integers over the province's habitable land. Neighbouring nuclei sum into continuous conurbations.
- **Districts** keep that shape. A district's urban residents are apportioned over its samples by the summed profile, and each sample's built cover is its own urban share of `fullBuiltPopulationPerCell`. Hamlets below the village threshold, which have no profile, stay on their district's first settlement sample.
- **Anchors.** Each sample's anchor is a hashed offset of up to 0.36 of a sample, leaning 0.18 towards each face that borders water, where harbours and waterfronts form. A coarse record's fabric sits at its anchor, leaning towards developed neighbours by 0.4 of a sample times their built-cover-weighted mean direction. A city's ring faces its core, and a nucleus with an even ring stays at its anchor. The record's support is then fitted inside its own sample, with the record's point at the support's centre, so the drawn parcel and the field's deposit coincide.

The settlement field, place topology, refinement and map all start from this morphology. Rural residents are unchanged: they are apportioned by habitat², as before.

## Atlas fabric

A coarse record knows its developed residents and its support, not its houses. The 2D atlas (`map/built-up-area.ts`) draws a representative texture for it rather than filling its square:

- **Drawn extent.** Supports hold all of a record's residents at a fixed 40 m² per place, so residents per support area is nearly the same for every record, and supports sit apart from one another. The atlas instead sizes each record from its developed residents at a density that rises tenfold with intensity, `ρ = 2,000 · 10^t` per km². Intensity `t` is the developed count on a log scale from 400 (a hamlet) to 30,000 (a dense core).
- **Merged outlines.** Each record has an irregular rounded envelope `exp(−(r/R(θ))⁴)` with its drawn square's area. A point is built-up where the summed support reaches ½, and it belongs to the record with the largest support there, so neighbouring records tile one continuous town with no gap or double fill. Outlines are traced by bisection along 40 rays.
- **Blocks.** Intensity is a support-weighted field across records, eased to zero at the merged boundary, so a town is dense throughout and thins only at its outer edge. Street pitch shrinks from 150 m to 70 m with intensity. Dense blocks are perimeter blocks; loose ones are rows of houses on one or both frontages among gardens. Grid orientation is shared within 4 km, with small per-record deviations.

Below 2.5 px per 100 m, each share is one area shaded by intensity. Above it, the share resolves into roofs in five tones over translucent ground, with roads drawn on top as main streets. Geometry is deterministic in ids, supports and intensities and cached per snapshot. Blocks are laid out only when first drawn. The simulation never reads any of it.

## Blocks

`urbanBlocks` derives sparse summaries on aligned 32, 64, 128, 256 or 512 metre squares. The map publishes 128 metre blocks. These are analysis areas independent of the active quadtree, not new surveyed property boundaries or street-enclosed parcels.

Each block reports residents, housing capacity, vacancies, paid pending capacity, employment, building count, recorded footprint area, surveyed lane length and centre membership. Population, capacity, employment and building counts use recorded site positions exactly once. Footprint areas and lane lengths are clipped across block boundaries. Coarse legacy housing is marked explicitly and is not presented as a measured building census. Summaries have no financial balances and are regenerated from physical state instead of saved as another authority.

The existing map context retains building/cell inspection and adds a block summary and **Inspect block**. The underlying 8 metre minimum for frontier buildings and camera-independent remeshing rules remain unchanged. This implementation does not reconstruct coarse established cities into new buildings.

## Housing demand and construction

Physical demand centres are selected from the best accessible home locations in each 128 metre block, suppressing equivalent reachable candidates within 256 metres. Empty, unfunded records cannot suppress real centres. Selection uses existing workplace/service accessibility, independently of city names, rank and metropolitan membership.

Each origin's annualized moving budget is divided among reachable improvements, including travel-time costs. More candidate destinations cannot multiply that budget. Growth deficits share the economic pool's overall shortage. Vacancies and pending construction are assigned once to a nearby accessible centre; a project at one centre does not automatically cancel another centre's demand.

Each pool can fund multiple requested locations in a month. Each investment rechecks remaining labor, cash and materials after earlier projects. Nearby rebuilding is compared with paid outward expansion; the rebuilding search stays within 256 metres of its demand centre. A site's pending project is never funded again. Capacity arrives after the existing three-month construction lag. The maximum of local growth and relocation demand is used to avoid adding both demands for the same residents.

## Validation

`tests/settlement-field.test.ts` covers exact conservation at both scales and the world edge, continuous developed residents, urbanity, dispersed versus developed occupants, reach, the one-plateau lattice, the shoulder–quarter–independent gradient, the reach floor, sovereign separation and mesh-resolution invariance. `tests/places.test.ts` covers the lattice place and its label, a dominant centre on a plateau, identity persistence and same-month idempotence, link → quarter → release with dated history, sprawl-driven merger with aliases, developed-fabric births, label-threshold persistence and abandonment, legacy-field migration, borders, and the pure merge-tree resolution. `tests/performance-contracts.test.ts` checks pooled deposits against a naive per-building reference at both scales, and housing-demand tests check that new-household demand gravitates without changing the pool's total shortage. `tests/opening-settlements.test.ts` covers exact and eligible spreading, extent and density gradient by size, anchors and their coastal lean, the fabric lean and fitted supports, and a generated world's census, off-centre fabric and graded supports. `tests/built-up-area.test.ts` covers determinism, area-equal irregular outlines, tiling without double fill, density-dependent blocks and drawn extents.

Measured on this machine (single runs, not benchmarks): one settlement-structure evaluation (both fields and topology) takes about 320 ms on a settled World world (129,024 samples, 47,551 sources) and 30 ms on a Continental frontier world; a place refresh takes 3–13 ms. A settled Regional world starts with 79 places at a ~4 km median spacing, where the previous rule named 151 separate cell-scale towns. No century-scale behavioural calibration of the new thresholds has been run yet. With the opening density law, that Regional world starts with 293 developed records instead of 161. None sit on sample centres, and their supports range from 350 m to 850 m, where 63 of 161 were previously capped at 850 m. The adaptive mesh has about 30% more leaves, because it refines around the additional, unaligned development. Drawing the atlas fabric for all 293 records takes 25 ms for outlines, plus 36 ms for blocks, which are built only once visible at reading zoom.

## Superseded centre integration

From 27 to 30 October 2026, connected occupied plots (24 m between buildings, 150 m for coarse parcels) formed self-contained settlement components. Several persistent centres per component were linked, incorporated after 120 months of 1.5× prestige and 1.25× wealth dominance, and fully merged after a further 240 months at 2× and 1.75×. Because coarse records sit 1 km apart, each record that gained compact capacity became its own named town, producing a lattice of similar towns. That calibration ([evidence](validation/urban-calibration-2026-10-27.json), [controlled comparison](validation/urban-policy-sensitivity-2026-10-27.json)) does not apply to the field model. `tests/urban-calibration.ts` still records long trajectories and now reports the place-topology thresholds.
