# Living economic landscape

The 3D atlas makes economic activity visible through cultivated land, farmsteads, woods, extraction sites, workshops, roads and coastal docks. This extends the existing mineral-pigment map treatment; it preserves the slate interface, brass actions, Alegreya lettering and thematic data colors described in [DESIGN.md](../DESIGN.md).

## Simulation and illustration

Monthly employment, production, population and census remain authoritative. `src/sim/economic-landscape.ts` derives a compact, read-only tile projection from firms, residents, resources and transport harbors. It distributes primary-sector employment across suitable land, retains other employment at firm locations and chooses one dominant activity per tile. This is a Civilization-like simplification for legibility, not a new allocation of jobs or goods. A mixed economy can therefore appear as one dominant use.

Agricultural employment includes grazing and scattered woodland clearings. Dry, cold and less fertile agricultural land appears as pasture. Forest terrain keeps its wooded appearance below 12% built land and 5,000 residents per terrain cell, unless extraction or workshops dominate. These thresholds select scenery, not physical deforestation or food-production rules.

`view-snapshot.ts` publishes this projection before filtering detailed country records. Unselected countries retain their visible economic life. Camera movement, detailed models and animation do not advance the economy or consume its random stream. `activity-layout.ts` derives representative scenery deterministically from the world seed, tile and projected state.

The extension also includes two changes to the canonical simulation:

- **Geographic seasonality:** `climate.ts` derives temperature and biome from latitude, elevation, moisture and terrain. Northern and southern seasons are six months apart. Firm food production in `firms.ts` uses the local seasonal factor alongside the existing world climate and productivity factors. The seasonal factor averages one over twelve months; this does not guarantee unchanged annual production when employment, inputs or other conditions change.
- **Public transport works:** the province inspector exposes paved roads, railways and harbor upgrades. `public-works.ts` checks logistics technology, treasury, depot materials, existing improvements and coastal accessibility, transfers construction expenditure through the ledger, consumes materials and records provincial works. The works persist in saves and are validated on load. `transport-development.ts` and `corridors.ts` apply them to transport costs and capacities.

State agents can order the same projects in their own provinces and see existing public works in their government context. Player and agent orders share the same funding and material checks.

| Project        | Treasury (thousand crowns) | Timber / stone / iron / tools (tonnes) | Logistics level |
| -------------- | -------------------------: | -------------------------------------- | --------------: |
| Paved roads    |                      1,600 | 40 / 160 / 0 / 10                      |               2 |
| Railway        |                      3,200 | 100 / 100 / 80 / 30                    |               3 |
| Harbor upgrade |                      1,200 | 100 / 120 / 20 / 10                    |               1 |

These projects complete immediately once funded, following the existing road investment convention; they have no separate construction queue.

Paved roads multiply provincial road friction by 0.85 and capacity by 1.2; railways use 0.65 and 1.5. Each funded harbor level adds 40% to the port capacity multiplier, up to three funded levels. These improve existing transport opportunities; they do not create arbitrary sea bridges or grant a neighboring province the same improvement. The visible road surface uses the lower-ranked surface at a segment's endpoints.

## What the map shows

| Activity             | Representative detail                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| Fields and pasture   | Farmhouses, barns, harvest stacks, occasional mills, orchards or livestock                                   |
| Forest and timber    | Dense trees with climate-dependent forms; timber sites add a sawmill and log stacks                          |
| Stone, iron and coal | Quarry benches or mine headframes, offices and distinct spoil piles                                          |
| Workshops            | Larger roofed workplaces, goods and a kiln chimney                                                           |
| Settlements          | Existing town and housing renderer, alongside the activity scenery                                           |
| Transport            | Terrain-following paths, gravel or paved roads, rail sleepers and rails, coastal piers, warehouses and boats |

`activity-material.ts` uses a compact texture with one texel per source tile and a procedural field mosaic across the landscape. Crop rows soften at distance. Grain, rice, orchard and pasture appearance respond to local climate; seasonal growth changes field color. Field geometry is an illustration: there is no saved crop-per-field economy, individual crop stock or independent harvest simulation for each drawn plot.

The crop and extraction ground treatment is enabled on the Terrain layer. Thematic land fills retain their own data colors. Architecture reuses the illuminated city roofs and procedural materials, with map-local wood, stone, crop and ore colors. These scenery colors are not new interface tokens.

## Observation and runtime bounds

Detailed activity models appear at map scale 3 and above. `ActivityScenery` estimates the visible grid area, projects candidate tiles and prioritizes those nearest the screen center. Its budgets are:

- At most **64 detailed tiles** in the activity scene.
- At most **128 cached tile plans**, with least-recently-used plans removed.
- At most **384 representative motion records**. Each record can contain multiple geometry instances, so this is not a limit of 384 rendered parts.
- Static and moving parts are grouped into instanced batches by five geometry shapes, with up to ten activity meshes in total.

The existing town renderer has its own cache and detail behavior. World-wide simulation, economic projection, compact ground texture and transport indexing still have world-dependent costs. The observation bounds apply to the new detailed models and their motion; they are not a claim that the entire world has constant runtime cost.

Workers, carts, mill sails and boats provide representative movement, not individually simulated people, shipments or machines. Activity animation updates at most 15 times per second of shared scenery time. Pausing or reducing motion freezes that shared time in the application. Rebuilding or evicting a scene plan discards only presentation data.

## Reproduction and limits

Run the focused source checks from the project root:

```sh
node --import tsx --test tests/living-world.test.ts
```

The tests cover seasonality, observer invariance, projected population and employment totals, distinct activity geometry, detail/cache/motion bounds and funded transport persistence and rejection conditions. Their presence is not a claim of historical calibration or a performance benchmark.

The 26 October measurement on a generated 129,024-cell world after one month retained 2,709,504 bytes of projection arrays and a 516,096-byte ground texture. Three warmed projection runs took 73–82 ms on an Apple M4 Pro. Creating 64 representative tile plans took 4.64 ms; this excludes terrain placement, instance upload and GPU rendering. Both population and employment totals were conserved, and the canonical world hash was unchanged by observation. The [measurement record](validation/living-world-2026-10-26.json) includes the Regional comparison, source hashes and reproduction command. These timings do not establish full-engine or long-running browser performance.

Build and serve the browser illustration fixture in separate steps:

```sh
npx vite build --config tests/browser/living-world.config.ts
npx vite preview --config tests/browser/living-world.config.ts
```

Open `http://127.0.0.1:5199/tests/browser/living-world.html`. The fixture provides overview, fields, industry and harbor views, motion and season controls, plus a generated-world view. Its controlled geography deliberately places activities for visual inspection; it does not demonstrate their natural frequency in a generated economy. Resize the browser for the compact layout. This fixture exercises scenery, not the full application inspector or a long-running economic scenario.

The scope remains a synthetic, inspectable simulation as described in [PRODUCT.md](../PRODUCT.md). Dominant tile uses, representative buildings and motion must not be presented as literal independent worker/building simulations. For the existing renderer and its broader constraints, see [MAP_RENDERING.md](MAP_RENDERING.md).
