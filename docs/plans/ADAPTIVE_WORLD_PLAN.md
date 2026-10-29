# Adaptive world and dynamic administration

Status: phases 0–7 are implemented in the working tree. Qualification is complete; the save-timing and inherited behavioral failures remain explicitly reported. Prepared 25 October 2026 against commit `07fe925`; implementation reviewed on 26 October 2026. The US historical-model diagnosis is deferred in [the backlog](../BACKLOG.md#historical-macroeconomic-mechanics).

Update — 28 October 2026: LLM assistance now starts on by default at the user's request, superseding the original default-off requirement below. The World menu can disable it, and `UCHRONY_LLM_OFF=1` continues to force it off for native-only runs.

## Implementation record — 26 October 2026

The implementation uses exact retained market/household/firm records as its initial closure. Numerical refinement does not repartition financial accounts. Administrative proposals operate over the original terrain polygons, independently of much finer meter-coordinate leaves. Legal and historical region references remain permanent geographical handles. Representative residents are read-only reconstructions; persistent causal individuals remain phase 8.

- Phase 0: global default-off policy, process override, shared tab updates, dispatch/cancellation barrier, server-instance generations and saved provenance are implemented and tested with provider stubs.
- Phases 1–3: persistent sites and owners, clipped balanced quadtree, conservative regrouping, exact retained heterogeneous state, unchanged shared physical markets and transport, compressed saves and original-file preservation are implemented.
- Phase 4: annual funded local administrative search, atomic geometry validation, legal succession and dated membership are implemented. Public liabilities remain on existing national accounts.
- Phase 5: opening residential/establishment capacity, funded construction, housing-constrained relocation, domestic enterprise commuting and owned freight in transit are implemented. Within-market commuting remains an explicit ten-minute approximation, and cross-market job search uses a six-kilometer neighborhood.
- Phase 6: separate administrative rendering, capacity-based residential detail, bounded regional queries and representative daily routines are implemented. Viewing detail does not change simulation resolution or the random stream. No persistent person or full parcel/property market is claimed.
- Phase 7: split/merge conservation, migration/recovery, provider policy, observer, city geometry and resolution tests pass. Three 200-year Regional runs and the complete regression suite pass their accounting checks (323 unique regressions including subsequent additions). The late settlement fix reproduces the final ten years of all three runs and exact saved continuation through month 2401. All three trajectories nevertheless lose 92–95% of their opening population; this inherited behavioral failure stays deferred. The largest-world full-app run completed 20 minutes with 6,572 drags, 40 inspections and 14 replicated saves without runtime errors. An independent camera-free Chromium replay produces the identical month-49 export. Actual recovered browser/disk replicas and export also match the retained final disk checkpoint. The 90-second save target was missed once (first save after 105.66 seconds), and cross-runtime bit identity fails because Node and Chromium math results differ. Qualification completion is not an unconditional performance or behavioral pass.

The concise equations are in [Mathematics](../MATHEMATICS.md), implementation details and compatibility limits in [Model](../MODEL.md), and qualification evidence in [Validation](../VALIDATION.md).

## 1 Intended result

Uchrony should represent one continuous inhabited landscape at several useful resolutions. Sparse countryside can be computed in broad units; concentrated production, settlement and transport require finer units. Cities and provinces become changeable administrative arrangements over that landscape. They do not define where an economy, settlement or population must stop.

The observer can descend from the world to a region, a neighborhood, a workplace and a resident's daily activity. Those views must remain consistent with the same population, employment, production and financial accounts. Looking somewhere must not make that place richer, more productive or more heavily simulated in a way that changes its future.

The proposed architecture has three independent structures:

| Structure                          | Purpose                                              | What determines its boundaries                                  |
| ---------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Adaptive spatial tree              | Allocate computation and summarize physical activity | Activity, heterogeneity and approximation error                 |
| Administrative jurisdictions       | Apply government, taxation and public services       | Institutional decisions, access, capacity and political history |
| Inspection and rendering hierarchy | Show landscape, buildings and daily activity         | Camera scale and the requested detail                           |

“Fractal” means recursive organization and consistent aggregation here. It does not assume that an economy behaves identically at every scale, or that the world has infinite physical detail.

**Recommended scope:** an adaptive aggregate simulation with detailed, consistent inspection first. Persistent individual agents whose actions feed back into the economy are a subsequent extension with a separate validation gate. Aggregate counts alone cannot recover the unique life history of every person.

## 2 What exists and what must change

| Current implementation                                                                                              | Consequence                                                                        | Planned change                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `spatial.ts` builds a quadtree over existing terrain cells and clips every leaf to a connected part of one province | Province boundaries constrain computation; refinement stops at the original grid   | A spatial tree in physical coordinates, independent of administrative boundaries    |
| `DistrictUnit extends Region`; local accounts and the serialized census retain province relationships               | Administrative geography is embedded throughout economic and population state      | Separate spatial state, legal entities and jurisdiction membership                  |
| `cities.ts` makes persistent named cities from connected built cells                                                | A physical agglomeration is treated as a city with its own continuing identity     | Separate continuous built activity, administrative municipalities and place names   |
| `city-layout.ts` generates decorative streets and buildings                                                         | A rendered factory or home has no corresponding capacity or resident assignment    | Derive inspection geometry from recorded sites, capacity and activity distributions |
| The monthly worker publishes broad world snapshots                                                                  | Deep inspection could multiply copied state and memory                             | Versioned, regional detail subscriptions with bounded caches                        |
| The worker schedules model calls when the server reports credentials                                                | Having a key can activate paid background work; there is no global user off switch | Explicit global policy enforced by the server and every worker                      |

Keep the existing ledgers, dated cohorts, competing firms, banks and conservation audits. Replace their dependence on a particular spatial partition rather than replacing the economic model wholesale. Preserve the separate map and corridor changes already in progress.

## 3 Spatial and legal identities

Introduce independent records for:

- **Spatial nodes:** immutable quadtree addresses, bounds in meters, level, parent, children, active status, integrated physical quantities and revisions.
- **Sites:** persistent locations for homes, establishments, warehouses, ports, public facilities and infrastructure. A site's address survives administrative changes and computational refinement.
- **Economic entities:** households or household pools, firms, banks and governments, each with permanent account identity. Their accounts do not belong to an ephemeral tree node.
- **Jurisdictions:** municipality, province and state records, with dated geometry, membership rules, administrative seat, powers, assets and legal succession.
- **Place names:** geographic labels with dates and aliases. A name is neither a population container nor a constraint on economic interaction.

A firm may operate several establishments. Production and jobs belong to sites; debt and ownership belong to legal entities. A physical move and a change of computational or administrative membership are different events.

Use stable IDs rather than positions in `world.regions`. Replace direct array indexing incrementally with explicit lookups. Audit references in capitals, armies, fleets, occupation, treaties, delegated powers, historical events, intelligence, construction projects, trade routes and saved commands.

An administrative boundary may cross a computational node. Maintain intersections and jurisdiction-tagged subaccounts within that node; do not assign the entire node by its centroid or split its residents by area. Roads and sites retain point/line locations. State sovereignty is a separate legal overlay: provincial reorganization cannot annex territory from another country.

## 4 Adaptive spatial resolution

### Physical geography

Establish one coordinate system and explicit distance/area units before extending below the legacy grid. A quadtree uses square bounds in that coordinate system; the existing axial hex indices are an import representation, not meter coordinates.

New geography comes from deterministic multiscale fields for elevation, soil, moisture and resource potential, plus explicit coastline, drainage and transport geometry. Finer detail must remain consistent with coarse land area, resource totals and established river connections. A bridge, harbor or mountain pass can require refinement even when population is low.

For old saves, retain the original geography as the coarse constraint. Subcell terrain is a conditional reconstruction, not newly discovered empirical information. Existing ore reserves, extraction and owned inventories are fixed constraints. Refining a mountain must not reveal an extra free mineral endowment. Use a documented minimum physical scale; the goal is inspectable detail, not unbounded recursion.

Use a linear quadtree address or equivalent stable integer representation without exceeding JavaScript's safe integer range. Balance neighboring computational levels, initially with a 2:1 rule, and build explicit coarse–fine neighbor interfaces. Coastline cut cells and disconnected land components remain distinguishable inside spatial nodes.

### When to refine

Replace the current population/industrial threshold with a dimensionless indicator combining:

1. Resident, job and productive-capital density.
2. Variation in prices, wages, shortages, land use and accessibility inside the node.
3. Transport bottlenecks and physically important interfaces.
4. Estimated error between coarse predictions and a retained or sampled finer representation.

One candidate form is:

\[
\eta_n=w_d D_n+w_h H_n+w_f F_n+w_e E_n.
\]

Each term is normalized against an explicit physical or numerical reference. These weights are engineering/model choices to test, not economic facts. Refine when estimated error or activity warrants the extra cost; coarsen only after lower thresholds and a dwell period are satisfied. Hysteresis prevents numerical churning. It is distinct from the institutional costs that make administrative borders change slowly.

Resolution is selected from simulation state at deterministic synchronization points. Camera position is excluded. A computational budget may report unmet accuracy or slow the simulation; it must not silently delete people, firms or activity. Identical runs use identical resolution settings rather than adapting economic outcomes to the speed of the user's computer.

## 5 Aggregation and conservation across scales

At any location there is exactly one authoritative computational representation. An active coarse node has no independently evolving active descendants. When children are active, their ancestor holds a derived summary, not another economy. Leaf status means “currently computed,” not “smallest possible.”

For an extensive quantity, restriction is addition:

\[
X_p=\sum_{c\in\mathrm{children}(p)}X_c.
\]

Splitting allocates an existing stock, subject to known sites, resident locations and other constraints:

\[
X_c=w_cX_p,\qquad w_c\ge0,\qquad\sum_cw_c=1.
\]

Weights are specific to the quantity. People follow the census and resident distribution; inventory stays at storage sites; deposits and loans remain with their legal owners; mineral reserves stay in the ground. Integer headcounts and discrete contract counts use exact apportionment; full-time-equivalent employment and worker-hours retain their units rather than being rounded into people. Floating-point monetary and goods residuals use a deterministic final allocation and scale-aware audit tolerances, without creating economic gains.

Do not add prices, wages, health rates or productivity indices. Carry their denominators, relevant distributions and weighting rules. For example, doubling the number of numerical cells cannot double land, divide equipment per worker, create a new firm or change the number of sellers.

### The closure problem

Conservation is necessary but insufficient. In general:

\[
f\!\left(\sum_iX_i\right)\ne\sum_i f(X_i).
\]

A coarse population with the same total income can have different food deprivation; a coarse sector with the same capital can have different concentration, credit risk and spare capacity. Retain the distributions needed by nonlinear rules: age/sex cohorts, strata and affordability, employment states and skills, firm productivity/markup/size, debt terms and maturity, inventory ownership, and origin–destination travel flows.

Initially, retain exact legal firm and loan records even inside coarse nodes. Aggregate and batch calculations around them. Compress heterogeneous firms or households only after a separate closure benchmark demonstrates acceptable error. Coarsening must not erase bankruptcies, unemployment, low-income tails or contractual obligations merely to save memory.

### Shared interfaces and transactions

All flows between active units use one interface ledger, including a large node adjacent to several small nodes. Each transfer is recorded once, with an equal counterpart. Shared road and port capacity is consumed once across all resolutions.

For local substeps, accumulate transfers over the same time interval before synchronizing. Fine transfers must sum to the coarse interface transfer. Conservation techniques from adaptive mesh refinement inform this interface discipline; the economic agents themselves are not treated as fluid equations. [AMReX conservation and flux registers](https://amrex-codes.github.io/amrex/docs_html/AmrCore.html#using-fluxregisters).

Market access depends on physical networks and costs. Splitting a node must not introduce new wholesale margins, tariffs, artificial border tolls, free trading partners or extra transport distance. Keep market venues and establishments distinct from computational cells.

## 6 Dynamic municipalities and provinces

A city becomes a municipal jurisdiction where that administrative form exists. The continuous urbanized area may extend across several municipalities or provinces. An industrial region can include urban centers, mines and countryside without becoming one indivisible city object.

Municipalities and provinces use the same generic jurisdiction machinery at different levels. They can change seats, reshape, split, merge, be renamed or be abolished. Administrative levels need not correspond to a fixed quadtree depth. Rural areas can belong to local jurisdictions without being labeled urban settlements.

### How boundaries evolve

Governments evaluate administrative arrangements using population served, travel time to services, actual commuting/trade links, administrative workload, fiscal capacity and political preferences. A candidate cost function is:

\[
J(\mathcal A)=
\lambda_T\sum_i N_i\tau(i,s_{a(i)})
+\lambda_C C_{\mathrm{administration}}
+\lambda_F C_{\mathrm{fragmentation}}
+\lambda_R C_{\mathrm{reorganization}}.
\]

The terms must be put in comparable units. Travel times come from the transport network. Administrative costs include maintaining offices and providing services; reorganization costs include records, staffing and institutional disruption. Governments propose feasible local changes rather than solving an omniscient global optimum. Their existing character, authority and legal arrangements affect which proposals they accept.

A proposal must preserve complete, non-overlapping jurisdiction at its level, respect sovereignty and delegated powers, and maintain reasonable access. Islands can be connected administratively through functioning sea links. Compactness is a soft consideration, not a demand for circular provinces. Persistent resource booms, new transport links, fiscal failure and population relocation can therefore reshape administration.

Use a scheduled review and material changes as triggers. A boundary remains because changing it has costs and legal consequences, not because the world enforces a target count of provinces. Administrative reform has funded effects; mere polygon recomputation does not charge money or produce services.

### Applying a change

Apply an accepted reform atomically at a fiscal-period boundary:

1. Validate the proposed geometry, powers, references and succession rules.
2. Freeze the completed period's attribution. Past GDP and taxes keep their original jurisdiction and date.
3. Update resident/site jurisdiction membership without moving their physical locations.
4. Preserve household, firm and bank accounts and all loan contracts.
5. Assign public assets, treasury balances and obligations by explicit legal succession. Local public debt does not automatically follow land area; unresolved obligations remain with the liable entity or a successor until settled.
6. Update capitals, seats, service catchments, treaties, military locations and affected caches in one versioned transaction.
7. Audit all assets, claims, people and references before publication; reject the whole transaction on failure.

Migration and administrative reassignment have separate statistics. Moving a line across a household is not a migration, a birth or a new property purchase. Borders can change political incentives in subsequent periods without rewriting earlier history.

## 7 A spatial economy that explains what is rendered

Deep inspection requires more than a denser mesh. Add an explicit connection between residential capacity, productive sites, jobs, services and travel.

### Land use and construction

Represent residential floor space, productive floor space, storage, public facilities, agricultural land and extraction sites. Construction, conversion and demolition require funding, materials, labor and time; buildings cannot appear solely because the camera moves closer. Agricultural and mining areas use the same land/site system as urban ones.

At coarse resolution, maintain capacity totals and their spatial distribution. Generate detailed parcels and building arrangements conditional on those totals, terrain and access. Where a layout has acquired causal constraints or persistent modifications, retain those constraints when it is no longer rendered.

Legacy buildings are initialized from existing built land and capital with explicit conversion assumptions. Initialization is an opening balance-sheet operation, not current GDP. Full housing wealth, land rent and mortgage markets require separate accounting definitions; do not infer asset values from decorative building heights.

### Residence and workplace choice

Household location and firm site choice should respond to wages, housing costs/capacity, amenities, freight access and travel time. A candidate discrete-choice rule is:

\[
\Pr(h\rightarrow j)=
\frac{\exp(V_{hj}/\theta)}{\sum_{k\in\mathcal F_h}\exp(V_{hk}/\theta)},
\]

where feasible alternatives \(\mathcal F_h\) respect vacancies, affordability and legal access. Capacity-constrained assignment must resolve competing claims simultaneously. Coefficients and the moving-cost scale need sensitivity tests. UrbanSim provides a useful reference for connecting households, jobs and development to buildings; it is not a model we can claim to have implemented by adopting its terminology. [UrbanSim parcel-level model](https://www.urbansim.com/parcel-level).

Initially, use explicit housing-space capacity and a documented scarcity/access penalty in location utility, not a cash payment. Introduce paid rents only together with landlords, counterpart payments, ownership and the appropriate national accounts. Avoid adding an unfunded “housing cost” that destroys household money.

### Labor and commuting

Replace strictly local hiring with accessible workplace matching. Maintain an origin–destination matrix of paid jobs by residence, workplace and relevant worker group. Its row and column totals must agree with the census labor force and firm payroll records.

Use generalized travel cost, available modes, time budgets and congestion to constrain access. Residence does not move every morning; employment is not counted again at the destination. Production is attributed to the workplace, while household residence and income attribution remain explicit. Cross-border commuters require separate tax and property-income treatment.

Initially compute network traffic in aggregate or as weighted trip groups. Walking, carts, roads, rail or motor traffic become available through the scenario's technology and infrastructure; the 1720 starting world must not acquire modern traffic by default. Daily activity and transport models such as MATSim inform the approach. [MATSim reference book](https://matsim.org/the-book/).

Freight remains a distinct flow using real warehouses, producers and transport capacity. If modeled travel exceeds a settlement interval, goods enter an explicit in-transit stock with an owner and arrival event. Delayed shipments cannot disappear from physical accounts or arrive twice.

## 8 Inspecting neighborhoods and individual activity

Provide a continuous inspection hierarchy: regional activity → local district → parcels/buildings → workplace or household → a resident's routine. Selection is spatial and entity-based, so it survives administrative reform and numerical remeshing.

### First implementation of daily activity

Use a deterministic, conditional population reconstruction for the visible area. It draws from recorded age/sex/stratum totals, funded jobs, residential capacity, workplaces and origin–destination flows. No person is assigned an imaginary paid job simply to animate a commute.

A daily activity model supplies sequences such as home, work, market, service visit and home, respecting age, employment, travel time and destinations. Representative trip weights recover the modeled aggregate flows. Distant actors can be sampled for rendering; a sampled pedestrian is not necessarily one permanently simulated world resident. Display the represented population and distinguish “representative resident” from a persistent individual.

Use a representative day tied to a specific simulation period. The day clock is inspection of that period, not an additional economic tick. Watching a day cannot pay another monthly wage, consume another monthly ration, advance fertility or spend the treasury again. Freeze or switch inspection snapshots explicitly when the main simulation advances.

Seed reconstruction by stable locations, group/entity identities and period, with a separate random stream. Reopening the same snapshot yields the same reconstruction. Cache eviction and repeated zooming cannot consume the simulation PRNG or change the world.

### Persistent individuals

If following the same named person through years is required, add a persistent-person representation as a later model capability. It needs household membership, home/workplace links, health/age state, employment transitions, life events and a durable identity. A generic cohort plus a seed does not preserve all of that history after arbitrary migration, deaths and remeshing.

Materializing an authoritative individual removes exactly that person's contribution from the residual aggregate pool. The accounting identity is:

\[
N_{\mathrm{total}}=N_{\mathrm{residual\ aggregates}}+N_{\mathrm{explicit\ people}}.
\]

Equivalent partitions are required for employment, consumption claims and any assigned assets or debt. A bookmark can preserve an inspection sample without making it causal. Promoting an actual causal individual is a simulation-setting change with persisted state, not a side effect of clicking a pedestrian.

Start causal microsimulation on bounded experimental scenarios. Validate promotion, demotion and coarse–fine exchange before enabling it in long world runs. Entire-world, second-by-second individual simulation is not compatible with the intended cheap aggregate mode; it should remain a separately budgeted fidelity choice.

## 9 Time and model authority

Keep monthly settlement as the initial economic backbone. Daily travel patterns can supply commuting capacity and accessibility; short event steps can advance explicitly modeled local transport. Construction, migration and administrative decisions use their own documented schedules.

For every subsystem define the authoritative time interval, the variables it reads, the effects it writes, and when those effects settle. A detailed subsystem replaces the corresponding coarse calculation for the same place and time; it never adds a second copy of that output.

Multiple numerical levels require synchronized boundary exchanges and deterministic event ordering. Record time-integrated worker hours, freight, consumption and public services. Do not apply per-month coefficients once per local substep. Exactly identical camera paths must not be required for reproducibility.

Use separate deterministic random streams for economic/demographic processes, administrative proposals, geography refinement and visual reconstruction. Test topology-sensitive random allocation explicitly: different physical resolutions need convergence in outcomes, whereas different viewing histories at the same resolution must produce identical authoritative state.

## 10 Global control of LLM calls

Implement this first so all subsequent experiments can run without paid providers.

### User behavior

Expose one clearly labeled application-wide switch, **LLM assistance**, covering historical generation, expanded accounts, decisions, strategies, referee calls, repairs and retries. Off means the native simulation continues. Opening a dossier, asking for detail or requesting strategy must never silently enable it.

Default new installations and automated runs to off. Preserve existing historical records and already-accepted effects when switching off; removing past model influence would be a different scenario. Importing a world or discovering an API key cannot enable assistance. Store runtime permission separately from imported world content, and store model-use provenance in saves and experiment manifests.

### Enforcement

The server owns the effective global policy for that application instance. All tabs and workers observe it. A server environment override can force off for tests or unattended runs, and no browser request can override that restriction.

Gate all worker scheduling, explicit actions and retries. Also gate every provider dispatch server-side, including repair attempts after an asynchronous response. Add a policy generation number: responses from an earlier enabled generation cannot mutate the world after disabling. Abort queued/in-flight work, clear retries, broadcast the new state and acknowledge the switch after new dispatch is blocked.

An already-dispatched provider request may have incurred a charge before cancellation. The guarantee is no new dispatch after the off barrier, and zero provider calls for runs started off. Record request counts and cancellation state so this is testable.

### Native execution and tests

Audit the native government, event and agreement paths for complete progress without the model. Conventional agreement settlement already exists. Free-form proposals that require interpretation must receive an explicit unsupported/pending-local-review result, rather than indefinite retries or fabricated consent.

Test the ordinary production API path with dummy credentials and a counted provider stub: startup, restored worlds, manual actions, queued jobs, repairs, retries, off/on races, multiple tabs and direct endpoint requests. A separate network-denial fixture catches provider access outside the shared gate. Existing browser-soak mocks are useful but insufficient to establish global enforcement.

LLM-off regression runs use fresh native scenarios or a declared fixed event replay. Merely disabling calls on a previously model-influenced save does not make it a clean native baseline. Paid live-provider qualification is outside this plan's initial tests.

## 11 Rendering and inspection data

The renderer consumes authoritative fields and site records, plus explicitly reconstructed detail. It does not create a separate city economy.

- World view integrates density, activity and land use across tree nodes.
- Regional view shows actual service areas, corridors and selectable administrative overlays.
- Local view displays continuous settlement and industrial land use across administrative boundaries.
- Street view resolves site capacities into consistent building geometry and supported travel networks.
- Resident view explains a selected routine and its household/workplace context.

Render administrative borders independently from built density and computational boundaries. A developer layer can show active simulation cells; the normal view need not expose a chessboard. Names attach to administrative seats or geographic anchors and can overlap a continuous urban region without carving it into isolated visual towns.

Use viewport subscriptions carrying bounds, requested visual detail and world revision. The simulation returns compact immutable inspection snapshots; large censuses and entire worlds are not resent per camera movement. Cancel stale requests and tag responses so an old neighborhood cannot overwrite a newer view.

Use bounded geometry/actor caches, instancing and lower visual detail when rendering is overloaded. Rendering limits are distinct from economic population limits. Preserve the current map's style and controls while replacing decorative site assumptions. Test shorelines, rivers, roads and building footprints for continuity across detail transitions.

## 12 Save migration and compatibility

Create a versioned adaptive-world schema and explicit migration from existing saves. The migration must preserve exact cohorts, account balances, inventories, reserves, capital/projects, loans and ownership. Record initialization assumptions for previously absent building or residential-capacity detail.

Keep original files untouched until a migrated save has validated and been written successfully. Export a recoverable original and support a preview of the migration totals. Upgrading old geography must not silently regenerate coastlines, replace the current world, or claim old visual buildings were previously simulated assets.

Persist tree topology and required fine-state residuals; legal IDs and dated jurisdiction membership; causal site/transport state; relevant random streams; model provenance; and explicit-person records if that mode exists. Purely visual meshes and disposable representative-day caches need not be saved. A discarded cache must be reconstructible from saved authoritative inputs.

Keep tombstones or successor mappings for retired jurisdictions and sites referenced by contracts, history or armies. Retiring an empty computational node can release memory; nonzero claims or historically needed identities cannot be deleted with it.

## 13 Delivery sequence

Each phase should be reviewable and independently reversible through versioned saves and feature selection. Avoid a single replacement of the entire simulation.

| Phase                            | Deliverable                                                                                            | Acceptance gate                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 0 Global LLM policy              | User toggle, server enforcement, cancellation, native fallback audit, provider-call counters           | Normal app and headless runs make zero provider requests when started off; off/on races reject stale replies        |
| 1 Identity and ownership         | Separate site/entity/jurisdiction IDs; compatibility lookups; reference inventory                      | Existing aggregate mechanics and save restoration remain equivalent with static boundaries                          |
| 2 Spatial foundation             | Physical coordinates, geography adapter, quadtree addressing, interfaces and conservative remapping    | Split/merge/coarsen/refine conserve stocks; legacy geography and thin crossings survive conversion                  |
| 3 Resolution-independent economy | Accounts detached from mesh cells, retained distributions, shared market/transport interfaces          | Homogeneous benchmark and coarse–fine convergence gates pass; refinement introduces no extra firms or trade margins |
| 4 Dynamic administration         | Municipal/provincial proposals, legal succession, dated membership, atomic updates                     | Reforms preserve assets/claims and historical attribution; all dependent references remain valid                    |
| 5 Sites and daily flows          | Residential/workplace capacity, funded land-use changes, accessible hiring and commuting               | Occupancy/jobs/payroll and origin–destination totals reconcile; network disruptions have causal aggregate effects   |
| 6 Continuous inspection          | Regional detail subscriptions, site-based rendering, representative residents and daily routines       | World-to-person navigation is coherent; different camera histories leave authoritative state identical              |
| 7 Qualification                  | Migration corpus, resolution experiments, headless 200-year runs, full-app endurance and documentation | Published evidence distinguishes conservation, convergence, performance and behavioral failures                     |
| 8 Optional causal individuals    | Persisted individual states with promotion/demotion and local event stepping                           | No double counting; bounded scenarios agree with aggregate controls within declared tolerances                      |

Phases 0–7 are the proposed main scope. Phase 8 needs an explicit fidelity decision because it changes the represented model, storage and runtime substantially. Streets with plausible activity are delivered in phase 6, with honest inspection semantics.

The first visible milestone is a world that runs with LLM calls off and can split, merge and redraw local administration without changing assets or population. The next is a continuous urban/industrial region with real workplace and residential links. Person-level inspection follows those foundations.

## 14 Validation and performance

### Accounting and topology

Exercise random sequences of splits, merges, administrative changes, save/load cycles and physical migrations. Check exact demographic totals and identities; every good and natural reserve; money, loan principal, rates and ownership; capital, projects, employment and public obligations. Test zero-population areas, islands, enclave-like geometry, boundaries through banks/factories, active conflicts and pending contracts.

Test that changing jurisdiction labels alone causes no migration, GDP or deposit creation. Test that changing a numerical leaf leaves real sites, physical travel paths and contractual terms intact.

### Model accuracy across resolutions

Use a small uniform world where an equivalent split should give the same calculation, a single mine connected through a bottleneck, a port, a growing polycentric industrial region and heterogeneous households with deprivation. Compare fixed coarse, fixed fine and adaptive runs on the same physical initial conditions.

Predeclare error measures for population, production, prices, unemployment, food access, travel times, spatial concentration and firm survival. Use paired seeds and independent ensembles. Conservation should be exact within accounting tolerances; nonlinear outcomes need demonstrated convergence and declared statistical error bounds. Do not promise identical trajectories when genuinely changing modeled detail.

### Observer independence

Run the same scenario headlessly, with no camera movement, with repeated zooming, and while following representative residents. Compare authoritative-state hashes at common checkpoints. Evict caches, reopen the app and revisit the same snapshot. Repeat at different frame rates and display sizes. UI selection and cache pressure must not advance the world RNG or change outcomes.

### Long runs and resource use

After each structural gate passes, run several 200-year Regional scenarios with LLMs off, periodic restoration and continuation checks. Also test a dense metropolitan concentration, mining/agricultural specialization, shrinking settlements and repeated administrative reform. These are stability and conservation experiments; they do not establish historical validity. Inherited version-5 behavioral failures remain reported and deferred; new accounting drift, invalid state or resolution-induced failures block the spatial release.

Profile monthly latency, remeshing time, interface work, worker-to-UI bytes, save size/time, heap and graphics memory, and detail-generation latency. Repeat the largest-world full-app endurance workload with repeated deep inspection and isolated test saves. Record hardware, source revision and active leaf/site/firm/cohort counts.

Set numerical runtime budgets after phase 1 baselines and a phase 2 prototype. Target responsive inspection and bounded caches; do not promise real-time, entire-world individual simulation. If a fixed fidelity setting exceeds resources, slow or pause with an explanation rather than silently reducing economic detail. No paid experiments are necessary for these gates.

## 15 Code migration map

| Area                          | Existing entry points                                                                     | Planned responsibility                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Geography and mesh            | `src/sim/spatial.ts`, `landscape.ts`, `hex.ts`, `generate.ts`                             | Physical-coordinate adapter, adaptive tree, conservative refinement and interface queries      |
| Local state and accounts      | `district-types.ts`, `districts.ts`, `district-finance.ts`, `local-units.ts`              | Separate spatial containers from entities and jurisdiction membership; preserve legal accounts |
| Administration and settlement | `cities.ts`, `types.ts`, institutions/sovereignty/statecraft modules                      | Generic dated jurisdictions, reform proposals, succession and independent place names          |
| Spatial economy               | `firms.ts`, `population.ts`, `district-transport.ts`, `transport.ts`                      | Site capacities, accessible matching, commuting and physical market access                     |
| Time and exchange             | `engine.ts`, `worker.ts`, `snapshot-mailbox.ts`, `view-snapshot.ts`                       | Synchronization contracts, deterministic event order and regional inspection subscriptions     |
| Optional models               | `worker.ts`, `server/storyteller.ts`, `App.tsx`, history/statecraft modules               | Global policy, dispatch enforcement, native fallback and request provenance                    |
| Rendering                     | `src/map/city-layout.ts`, `city-scenery.ts`, `renderer.ts`, `src/components/WorldMap.tsx` | Continuous settlement detail generated from sites and activity, with bounded caches            |
| Persistence                   | district/spatial/economic persistence modules, census/save codecs                         | Versioned migration, retained residuals and exact continuation                                 |

Introduce dedicated modules for jurisdictions, site inventories, spatial interfaces and inspection reconstruction as responsibilities become clear. Avoid extending the already broad `Region` interface with another layer of optional fields.

## 16 Decisions proposed for review

1. **Approve independent spatial and administrative hierarchies.** This is the main structural change; province lines no longer control the computational partition.
2. **Approve activity-driven resolution, with camera-independent economics.** Zoom materializes inspection detail; it does not secretly alter the experiment.
3. **Approve representative daily activity before persistent causal individuals.** The distinction is visible and the later upgrade has an explicit state/conservation contract.
4. **Approve endogenous administrative reform.** Cities and provinces can change, with legal continuity and real institutional constraints; there is no forced province or city count.
5. **Approve LLM assistance off by default for new installations and tests.** A single global switch controls all roles, including manual requests and retries.
6. **Keep the US benchmark repair deferred.** Retain the failed result and return to its economic mechanisms after the spatial work has a stable, independently qualified foundation.
