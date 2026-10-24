# Simulation model

Uchrony's model is deliberately inspectable. These are implemented rules, not claims about real-world predictive accuracy. Coefficients are synthetic and tunable in `src/sim/`.

## Resolution and units

- Time advances by one month per tick, beginning in January 1720. The starting year is a fictional scenario convention, not a historical dataset.
- A generated world contains a 112 × 72 hex grid. Hexes carry geography; provinces carry economic and demographic state. Typical generation produces 180 provinces, with additional provinces for disconnected islands when needed.
- Population values are people. Stocks and flows are tonnes. Treasury, budget, and the internal `gdp` field are thousands of fictional crowns; the UI expands them into crowns.
- The UI calls `gdp` **monthly output**: it is the gross value of goods produced, not an economically calibrated value-added GDP measure.
- The map scale assumes four kilometers per internal map coordinate unit. It is a fictional spatial convention and updates with zoom.
- Generating the same seed with the same settings on the same model version produces the same world. The PRNG state is part of every save.

## Geography and cartography

Generator 2 uses separated continental nuclei with seeded domain warping and angular coastline variation, plus smaller offshore islands. An ocean frame keeps land away from the map boundary. Curved ridge fields create mountain belts. Latitude, elevation, moisture noise, and a simple dry-latitude/rain-shadow term choose biomes. This is synthetic terrain generation, not plate tectonics or an atmospheric simulation.

A priority flood removes drainage sinks by minimally raising their elevations. Each land cell stores a lower, adjacent downstream cell. Runoff accumulates in reverse drainage order; visible rivers begin at 12 runoff units and continue to the sea. Rivers increase local moisture and add a small contribution to provincial fertility. These runoff units are relative catchment weights, not measured cubic meters per second. River flow is geographic and does not yet change with monthly rainfall.

Provinces grow with positive terrain costs, preserving connected land ownership. Centers prefer positions near each province's centroid, with a preference for lower ground and rivers. Starting capitals are spread over substantial landmasses rather than tiny offshore rocks. State expansion follows the province graph; unclaimed offshore provinces join the closest capital. None of these rules constrain later military conquests.

Rendering extracts shared polygon topology from the hex grid, applies bounded shared-vertex offsets, and smooths the land silhouette. Interpolated terrain and slope lighting are cached independently of economic updates. Borders and quantitative fills read current simulation state. City and state labels use screen-space collision checks; ocean labels use open-water clearance. Hit testing follows province polygons, and wheel zoom preserves the geographic location under the pointer. The smoothed shore is a small visual approximation of the underlying boundary; it does not change simulation adjacency.

The version-1 save envelope remains supported. New saves carry `generatorVersion: 2` and optional per-cell drainage fields; older exports without those fields remain valid and keep their saved terrain. New generation is reproducible within this generator version. Changed neighbor traversal and geography may produce different future histories than an older application build; same-build save continuation remains deterministic.

## Monthly order

1. Increment the month; reset population-flow counters.
2. Change annual growing conditions and evaluate potential independence movements.
3. Allocate civilian labor and produce raw and manufactured goods.
4. Clear shortages through capacity-limited domestic and international shipments.
5. Consume household and maintenance goods; apply spoilage/storage limits.
6. Collect taxes, allocate spending, service debt, and handle insolvency.
7. Update services, health, literacy, contentment, aging, births, deaths, migration, and development.
8. Generate research and apply completed discoveries.
9. Update diplomatic relations and autonomous government decisions.
10. Supply armies, train troops, apply attrition, move, fight, occupy, and retreat.
11. Recompute national/world totals and record history.

Changing a policy affects subsequent ticks. Building a provincial improvement and sandbox interventions change state immediately and influence the next tick. A march order records a destination; movement occurs on subsequent ticks.

## Population accounting

The core invariant is:

```text
people after tick = people before tick + births - deaths
people = civilian children + civilian adults + civilian elders + living soldiers
```

Recruitment transfers adults into an army. Migration transfers each age cohort between provinces. Surrendered or disbanded troops return to civilian life. Military and civilian deaths both enter the world death ledger. Territory transfers and independence do not create people.

Children age into the adult cohort over an 18-year timescale. Adults age into the elder cohort over a 47-year timescale. Birth rates depend on adult population, literacy, and food coverage. Baseline mortality differs by cohort and responds to health; shortages add mortality, especially among children and elders.

Migration chooses a more attractive neighboring province based on contentment, health, infrastructure, food coverage, and devastation. Closed borders block international migration; controlled immigration reduces its rate. Domestic migration ignores national border policy. Overseas migration is not modeled.

## Production and carrying capacity

Potential labor is 73% of adults, modified by health. Labor utilization depends on infrastructure, national stability, and devastation. Farm share depends on urbanization and production priority. Extraction and manufacturing divide the remaining labor.

Farm output has diminishing returns to labor and a land-based upper bound:

```text
arable capacity = province hex count × 1,800 × (0.35 + 0.65 × fertility)
effective farm labor = capacity × (1 - exp(-farm workers / capacity))
food output = effective farm labor × fertility yield × technology × season × climate × efficiency
```

This prevents adding people from creating unlimited farmland. Agricultural investment and research increase supportable population. Seasonal output varies by ±23%; annual climate varies from 0.82 to 1.16 of baseline. Industrial technology, literacy, and damage influence overall production efficiency.

Timber, stone, iron, and coal throughput depends on allocated workers and the province's resource richness. Richness currently does not deplete. Industrial capacity constrains manufacturing. Recipe inputs are removed from stocks before outputs are credited:

| Output, 1 tonne | Inputs |
| --- | --- |
| Tools | 0.65 t iron + 0.30 t coal + 0.25 t timber |
| Textiles | 0.30 t timber + 0.12 t food |
| Arms | 0.90 t iron + 0.50 t coal + 0.30 t tools |

These recipes are economic abstractions; timber in the textile recipe stands in for fibrous raw material. Factories can only produce the amount supported by the scarcest input. Military priority increases arms output; agricultural and industrial priorities alter labor allocation.

Households require 25 kg of food per person per month. Other per-capita maintenance requirements are defined in `MONTHLY_NEED`. Prices vary between 0.55× and 3× base prices according to stocks relative to target reserves. Food targets 2.4 months of need; other goods target three months.

Remaining food loses 3.5% monthly to storage/spoilage, timber and textiles lose 0.6%, and other stocks lose 0.1%. Stored quantities are capped at 20× target reserves; excess is discarded. The ledger's “Used” column reports consumption and manufacturing inputs, not storage losses.

## Goods routes

The physical transport network is deterministic and cached for the world's immutable geography. Within each province, a shortest-cost road tree connects its settlement to border crossings and its harbor. Terrain difficulty, elevation changes, and river crossings raise road effort. Neighboring provinces join at the least-cost reachable border; roads cannot cross water or an unrelated third province.

Each coastal province selects a shore reachable from its settlement, preferring the largest connected water body and then the cheapest road access. Shipping paths visit adjacent water hexes between those harbors, with a small preference for clearance from shore. Disconnected water bodies cannot gain a direct sea link. The graph includes a minimum-cost connectivity backbone, the three cheapest shipping connections at each harbor, and crossings to its two nearest other landmasses. This avoids both a dense all-to-all graph and a single artificial crossing for an entire continent. Inland access remains a road leg; each sea transfer has a fixed handling cost.

Monthly route costs depend on physical travel effort, infrastructure, and logistics research. Shipping has a lower distance cost than overland haulage. Infrastructure and technology increase connection throughput, while devastation reduces it; a sea connection with inland access is capped by the smaller road or port allowance. Capacity is shared by all shipments in both directions on each province-to-province connection. Roads or harbors shared by *different* connections do not yet have a separate total-throughput constraint. There are no persistent fleets, port construction levels, or navigable-river freight.

Buyers with shortages seek reachable sellers with surplus. Domestic sources receive a preference. Route paths use shortest-cost searches. Every shipment consumes the capacity shared by its path's edges for that month; later goods and shipments see the remaining capacity. Food is processed first.

International trades transfer treasury funds from buyer to seller. Domestic transfers use public stocks without a treasury payment. Buyers retain a minimum treasury reserve. Tariffs reduce cross-border shipment quantity and affordability; trade agreements and alliances remove that friction. There is no separate tariff-revenue ledger because inventories and payments represent a public allocation abstraction.

War closes hostile border edges and prohibits direct trade between the belligerents. Ships do not have persistent positions or voyage delays. The map merges shared physical segments, displays road and shipping legs separately, marks active harbors, and highlights the selected state's or province's imports and exports. Line width uses a square-root scale of combined monthly tonnage. Symbolic particles indicate actual shipment directions at a constant screen speed; they are presentation-only. The shipment ledger lists each cargo, total path distance (using the atlas scale), and harbor names. Older saves without physical route geometry load normally and regenerate routes on the next tick.

## Government and insolvency

Collected taxes depend on monthly output, tax rate, administrative technology, and stability. Tax rates range from 5% to 55%. Excessive tax burdens reduce contentment.

Welfare, education, military, and research sliders are relative spending weights, not literal percentages. Administration and infrastructure keep weights of 12 and 18. The service budget follows a baseline service floor and a revenue-based target, constrained by current revenue and a limited monthly draw from treasury.

Welfare improves health and contentment; education improves literacy; research funds knowledge; infrastructure funding offsets deterioration. Military funding improves training and morale. Field army upkeep and debt interest are additional expenses.

If expenses exceed treasury plus revenue, the difference becomes debt. Debt incurs 0.3% monthly interest. States with treasury reserves repay debt. Debt beyond the greater of 1,000k crowns or 24 months of gross output triggers restructuring: debt is reduced to 35% of that limit, legitimacy falls by 12, stability falls by 10, and the chronicle records the default. Fiscal surpluses gradually restore legitimacy.

## Research

Each of six fields has six levels. Required knowledge is `140 × (level + 1)^1.45`. Funding produces knowledge, modified by literacy and governance technology. Focus changes preserve all field progress.

| Field | Implemented effects per completed level |
| --- | --- |
| Agriculture | +19% base farm productivity |
| Industry | +13% base overall production efficiency |
| Medicine | +0.05 health-target contribution |
| Logistics | +25% base road throughput |
| Military | +16% combat-effectiveness contribution, plus morale support |
| Governance | Better tax collection, literacy growth, and research effectiveness |

Discoveries are named in `TECH_NAMES`. Their labels describe an abstract progression; e.g. “Steam shipping” is not a separate naval vessel system.

## Diplomacy and warfare

Each unordered pair of states has opinion, treaty, grievance, war exhaustion, and a transition date. Treaty states are neutral, trade, alliance, war, or truce. International commerce gradually improves opinion.

- A diplomatic mission costs 150k crowns and adds 12 opinion points while at peace.
- Trade agreements require opinion ≥10; alliances require ≥45.
- Alliances grant military access and tariff-free trade. Automatic allied war entry is not implemented.
- Expansionist governments can declare war over accessible borders. Personalities, opinion, stability, and seeded randomness influence decisions.
- Exhaustion accumulates in war and rises faster with food shortages. Autonomous belligerents settle once exhaustion exceeds 38.
- Manual early peace proposals need exhaustion ≥5 when relations are deeply hostile. An accepted truce prevents renewed war for 60 months.

Armies consume 34 kg of food and 0.5 kg of arms per soldier per month. Supply affects morale, attrition, and combat effectiveness. Military funding generates training; experience also rises in battle. Corps traverse one accessible province per month. Territory outside the army's state requires alliance or war access.

Defenders include field forces and a provincial garrison. Mountains multiply defense by 1.8; hills and forests by 1.3. Combat uses force size, morale, supply, experience, technology, and seeded variation in casualties. A sufficient advantage captures the province, raises unrest and devastation, and sends surviving defenders to adjacent friendly territory when available. Capitals relocate; states with no remaining provinces cease to govern.

Unrest reflects contentment, occupation/cultural mismatch, and devastation. Severe sustained unrest can create an independent state, up to a global limit of 18 states. It inherits its former state's technologies and begins at war with it.

## Persistence and performance boundaries

The worker owns mutable simulation state. The UI receives snapshots and sends typed commands. Save validation checks dimensions, collections, identifiers, population, stocks, policies, diplomacy, armies, routes, events, and history before accepting an import. Files above 20 MB are rejected.

Recent history retains monthly points for ten years and annual points before that. The chronicle retains the latest 240 events; event identifiers continue increasing. Autosave occurs while paused and at annual boundaries during playback. Export is the durable cross-browser workflow.

Results are deterministic for the same model build, starting save, and command sequence. Rendering frame rate never changes random state. Background tab throttling changes wall-clock playback pace; it does not simulate elapsed real time while closed.

Meaningful future model additions include finite mineral reserves, firms and households, occupations, investment completion times, overseas migration, per-edge sea pathfinding, persistent convoys, navies, treaty clauses, war goals, and empirical calibration. Those require explicit model design rather than additional decorative UI.
