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

The version-1 save envelope remains supported. New saves carry `generatorVersion: 2` and optional per-cell drainage fields; older exports without those fields remain valid and keep their saved terrain. New generation is reproducible within this generator version. Changed neighbor traversal and geography may produce different future histories than an older application build; same-build core continuation remains deterministic when supplied the same external historical inputs.

## Monthly order

1. Increment the month; reset population-flow counters.
2. Change annual growing conditions, evaluate potential independence movements, apply historical developments, update state character and process diplomatic commitments.
3. Allocate civilian labor and produce raw and manufactured goods.
4. Clear shortages through capacity-limited domestic and international shipments.
5. Consume household and maintenance goods; apply spoilage/storage limits.
6. Collect taxes, allocate spending, service debt, and handle insolvency.
7. Update community services, health, literacy, contentment, aging, births, deaths, troop retirement, migration, identity diffusion, and development.
8. Generate research and apply completed discoveries.
9. Update diplomatic relations and autonomous government decisions.
10. Supply armies, train troops, apply attrition, move, fight, occupy, and retreat.
11. Recompute national/world totals and record history.

Changing a policy affects subsequent ticks. Building a provincial improvement and sandbox interventions change state immediately and influence the next tick. A march order records a destination; movement occurs on subsequent ticks.

## Population accounting

The core invariant is:

```text
people after tick = people before tick + births - deaths
people = civilian children + civilian adults + civilian elders + living soldiers + naval crews
```

Recruitment transfers adults into an army. Migration transfers each age cohort between provinces. Surrendered or disbanded troops return to civilian life. Military and civilian deaths both enter the world death ledger. Territory transfers and independence do not create people.

Each province contains joint population communities, rather than independent identity percentages. A community has age cohorts, cultural belonging, mother tongue, belief, political outlook and preferred civic allegiance. Culture and language registries begin from geographic communities that cross political borders. No culture or belief receives innate fertility, productivity or military coefficients. States have separate institutional identities; recognizing one changes policy, without relabeling residents.

Children age into adulthood over an 18-year timescale; adults become elders over a 47-year timescale. Each community has its own health, literacy, living standard, urbanization, contentment, grievance, loyalty, rootedness and displacement burden. Material conditions, education, services, policy access and historical effects change these attributes. Birth rates depend on adult numbers, literacy, food, urbanization and living standards. Cohort mortality responds to health and shortages. Saved census randomness provides unbiased integer rounding so small communities can still age, reproduce and die. Soldiers retain community profiles, suffer natural mortality, and retire into civilian elder cohorts.

Migration balances safety, food, infrastructure, health, contentment, diaspora connections, exclusion, cultural prestige and historical migration appeal against rootedness and border friction. Destinations are adjacent provinces or endpoints of actual sea trade. A passenger-capacity proxy permits at most 0.15 people per tonne of delivered maritime freight in each direction; it is not a separately simulated passenger fleet or a shared freight/passenger capacity ledger. Closed borders suppress ordinary international movement, while a small refugee leakage remains. Domestic migration ignores national border policy. Severe devastation, hunger and exclusion can displace people. All departures are subtracted before arrivals, so newly arrived people cannot move again in the same month. Age and identity travel with migrants; displacement and old allegiances persist and gradually adjust.

### Identity formation and diffusion

Local contact, neighboring provinces and delivered trade expose communities to cultures, beliefs and political movements. Literature seeds small reader circles; belief events seed small follower communities. Novelty decays, and adoption is gradual. Government recognition alone creates no followers. Political outlook responds to education, exclusion, local attachment, commerce and institutions. Identities have names, origins, formation dates and parent lineages.

Shared state-language fluency can increase without changing mother tongue. Intergenerational language replacement is slower, with stronger common-language schooling effects; related dialects can also diffuse. The model tracks a mother tongue and fluency in one shared state language, not a complete multilingual repertoire. Cultural adoption is slower still. Sustained peaceful mixing may eventually form a shared local culture; long isolation and local schooling can produce a related dialect. New communities initially coexist with their parents. Integer thresholds mean very small adoption flows can take time to become visible.

Civic, pluralist and heritage citizenship; local, multilingual and common-language schools; and protected, favored or restricted belief policies determine access and pressure. Exclusion generates grievance, weakens loyalty and encourages movement. Conquest preserves community identities and old political allegiances. Civic allegiance can gradually shift toward the host state with confidence in it, or toward local autonomy under sustained grievance. Recruitment draws from adults with loyalty-weighted participation, and unrest uses actual social tension instead of a fixed foreign-culture penalty. State agents and historical generation receive census composition and social indicators.

The Population and province inspectors expose identity distributions, community conditions and monthly flows. Culture, language and belief map layers show the largest community per province; provinces remain internally mixed. Save validation requires community ages to sum exactly to each province census and troop profiles to sum to army strength. Legacy saves receive a deterministic geographic census without adding or removing people; this initializes a plausible composition rather than reconstructing an unrecorded past.

These remain aggregate communities, not individual biographies or households. Sex, marriage, explicit family descent, household assets, text inventories and calibrated fertility schedules are not simulated. Long-run performance and social balance for the expanded census are awaiting the consolidated validation pass.

## State character and leadership

Every state has six continuous tendencies: assertiveness, openness to reform, solidarity, centralization, commercial orientation and patience. Each combines three separate sources: the people's attitudes, institutional habits, and the current head of state or governing body's temperament. Cultural or religious identity names confer no innate personality.

Public attitudes are weighted from civilian and military adults and elders, using political movements, literacy, urbanization, wealth, grievance, loyalty, rootedness, displacement, real trade activity and war exhaustion. They adjust 2.5% toward current circumstances each month. Institutional habits move 0.8% monthly toward assumptions associated with the form of government. These assumptions are explicit synthetic model choices, not calibrated claims about real governments:

| Government family           | People | Institutions | Leader |
| --------------------------- | -----: | -----------: | -----: |
| Republic                    |    48% |          29% |    23% |
| Federation or confederation |    50% |          32% |    18% |
| Commonwealth or assembly    |    55% |          25% |    20% |
| Monarchy                    |    23% |          30% |    47% |
| Empire or autocracy         |    16% |          30% |    54% |
| Unclassified form           |    35% |          35% |    30% |

Effective state direction moves 12% monthly toward a conviction-adjusted weighted combination. The political-extremity setting amplifies distance from the midpoint, moderated by institutional/public/leader influence and personal dogmatism; it does not erase those constraints. The inspector shows its strongest tendencies, current priorities, sources of influence and detailed comparisons. A reform-minded public and a traditional ruler can coexist. The distance between public attitudes and leadership contributes a small social-cohesion cost.

Leaders also have a persistent private political profile with eight drives: ambition, risk tolerance, dominance, opportunism, vengefulness, dogmatism, empathy and vanity. Ten seeded archetypes include territorial hegemons, revanchists, predatory oligarchs, revolutionary reformers, doctrinal guardians, mercantile opportunists, encirclement obsessives, glory-seeking adventurers, constitutional stewards and civic solidarists. Each has an ambition, a red line and a blind spot. Motives correlate with temperament without predetermining every action; a public-interest leader can be confrontational and an ambitious leader can face strong institutional limits. Existing leaders gain motives without replacing their names, skills, perks or recorded temperaments. Extreme dispositions remain tendencies, not mechanical guarantees of war.

Leaders have persistent temperaments and five skills: administration, diplomacy, logistics, scholarship and command. Two strengths and one limitation are assigned deterministically from the world seed, state, tenure, succession generation and recorded name. Examples include commercial contacts, scholarly patronage, methodical administration, command reputation, impulsiveness, patronage dependence and distrust. These affect decision preferences and modest institutional effectiveness, scaled by executive influence. Their combined contribution to each supported effectiveness channel is bounded to ±9%; historical effects retain their existing combined 0.2–2.5 multiplier bounds. Transport, tax collection, funded education/research, command effectiveness and morale use these contributions. Resources, treaty consent and ownership constraints remain enforced separately.

New worlds begin with character-dependent policy allocations and research priorities. Older saves acquire profiles without changing their existing policies or recorded leaders. Private motives affect native military and conscription targets, autonomous responses and research through temperament, and enter state-agent strategic assessments. Strategic context includes actual supplied force ratios, neighboring states, resource-production asymmetries, material constraints and active disputes. Agents are explicitly allowed to pursue selfish, unequal or risky initiatives, and must consider a bold attainable alternative to accommodation or waiting. Referee plausibility does not require prudence or benevolence; risky undertakings still cannot fabricate assets, victories or consent. State-agent and historical-generation prompts receive the evolving profile; other states see public posture and leadership rather than private motives or skill records. The native government fallback uses the same tendencies for policy adjustment, trade/alliance propensity, war risk, exhaustion tolerance and research focus. The legacy four-value `personality` field remains only for version-1 compatibility, not as the behavioral driver.

Succession assigns a fresh leader profile and immediately moves executive direction 45% toward the new weighted target, retaining institutional and popular attitudes. It triggers a strategic review, preserving inherited state memory, signed agreements, population and resources. Replies from an agent deliberating under the old leader are discarded without misconduct penalties. Leader traits cannot be rewritten through ordinary agent orders or unsupported claims. Individual lifespans, family trees, elections, candidate selection and constitutional procedure are not simulated; leadership turnover still enters through historical events. Behavioral consistency of live LLM agents awaits the consolidated validation pass.

## Structural instability and observer controls

Simulation conditions are saved per world and can be changed through **Simulation conditions** or selected at world creation: instability 0–3 (default 1), raw-resource abundance 0.35–1.6 (default 0.85), and political extremity 0–2 (default 1.2). Changes preserve stocks, people, leaders and treaties. Extremity changes the strength of convictions immediately through subsequent monthly adjustment and shapes newly generated leaders; existing ambitions persist.

A separate saved PRNG generates additional disturbances independently of model requests. Instability targets roughly `2 × intensity` disturbances per simulated year world-wide, with exponential arrival times calibrated for integer months, a maximum one-month arrival rate and a 120-month upper interval. Zero suppresses new additional disturbances; existing effects, ordinary climate and endogenous shortages/politics continue. The four scopes are province (20%), state (18%), connected geographic region (29%) and international dispute (33%). State pressures currently involve competing factions. Local/regional cases also include harvest failures, extraction interruptions and epidemics. Regional effects follow contiguous neighboring provinces and may cross borders.

International pressures create concrete competing frontier claims, resource-concession disputes or contested transit rights at actual neighboring provinces. They reduce relations, accumulate grievances and may increase transit friction; they never declare a war, transfer territory, invent agreement signatures or create resources. The public ledger records up to 64 recent pressures and feeds affected agents and contextual history generation. A new crisis permits strategic reconsideration after a one-minute strategic cooldown, still subject to the existing thirty-second state cooldown, five-second global launch spacing and concurrency limits. Effects resolve through the native historical mechanism, so pressure frequency does not increase the model request budget. Wider region records can contain up to two effects per province; ordinary model-authored historical records retain their twenty-effect limit.

## Production and carrying capacity

Potential labor is 73% of adults, modified by health. Labor utilization depends on infrastructure, national stability, and devastation. Farm share depends on urbanization and production priority. Extraction and manufacturing divide the remaining labor.

Farm output has diminishing returns to labor and a land-based upper bound:

```text
arable capacity = province hex count × 1,800 × (0.35 + 0.65 × fertility)
effective farm labor = capacity × (1 - exp(-farm workers / capacity))
food output = effective farm labor × (0.105 + 0.125 × fertility) × abundance × technology × season × climate × efficiency
```

This prevents adding people from creating unlimited farmland. Agricultural investment and research increase supportable population. Seasonal output varies by ±23%; annual climate varies from 0.82 to 1.16 of baseline. Industrial technology, literacy, and damage influence overall production efficiency.

Timber, stone, iron, and coal throughput depends on allocated workers, resource abundance and the province's resource richness. New worlds distribute iron and coal through separate spatially correlated geological fields with thresholds for workable deposits; some provinces have none, others have concentrated sources. Existing saves retain their recorded deposits. Scarce industrial inputs constrain manufacturing and create reasons for access agreements, leverage and conflict. Richness currently does not deplete. Industrial capacity constrains manufacturing. Recipe inputs are removed from stocks before outputs are credited:

| Output, 1 tonne | Inputs                                    |
| --------------- | ----------------------------------------- |
| Tools           | 0.65 t iron + 0.30 t coal + 0.25 t timber |
| Textiles        | 0.30 t timber + 0.12 t food               |
| Arms            | 0.90 t iron + 0.50 t coal + 0.30 t tools  |

These recipes are economic abstractions; timber in the textile recipe stands in for fibrous raw material. Factories can only produce the amount supported by the scarcest input. Military priority increases arms output; agricultural and industrial priorities alter labor allocation.

Food demand starts at 25 kg per person per month, scaled by `0.95 + 0.15 × urbanization`. Other household/maintenance requirements use `MONTHLY_NEED`, scaled by `0.65 + 1.3 × urbanization + 0.3 × infrastructure + 0.3 × industry`; iron/coal use one quarter of their base rate and household arms use 15%. Reserves cover 2.4 months of household food demand or three months of other household demand, plus two months of current manufacturing recipe inputs. This avoids treating all raw industrial demand as household consumption while still retaining inputs for workshops. Prices vary between 0.55× and 3× base prices according to stocks relative to target reserves.

The inspector reports a material-coverage index in addition to food coverage. It weights tools (35%), textiles (25%), timber (15%), stone (10%), coal (10%) and iron (5%) household/maintenance fulfillment. Previous-month coverage scales effective labor by `0.75 + 0.25 × coverage`; shortages also lower health/contentment targets and erode infrastructure modestly below 70% fulfillment. These are synthetic dependencies, not calibrated empirical elasticities.

Remaining food loses 3.5% monthly to storage/spoilage, timber and textiles lose 0.6%, and other stocks lose 0.1%. Stored quantities are capped at 20× target reserves; excess is discarded. The ledger's “Used” column reports consumption and manufacturing inputs, not storage losses.

## Goods routes

The physical transport network is deterministic. Harbor locations and connection pairs are cached for the world's immutable geography; the tile paths between them can develop with traffic. Within each province, a shortest-cost road tree connects its settlement to border crossings and its harbor. Terrain difficulty, elevation changes, and river crossings raise road effort. Neighboring provinces join at the least-cost reachable border; roads cannot cross water or an unrelated third province.

Each coastal province selects a shore reachable from its settlement, preferring the largest connected water body and then the cheapest road access. Shipping paths visit adjacent water hexes between those harbors, with a small preference for clearance from shore. Disconnected water bodies cannot gain a direct sea link. The graph includes a minimum-cost connectivity backbone, the three cheapest shipping connections at each harbor, and crossings to its two nearest other landmasses. This avoids both a dense all-to-all graph and a single artificial crossing for an entire continent. Inland access remains a road leg; each sea transfer has a fixed handling cost.

Monthly route costs sum the effort of the tiles actually traversed. Plains, forests, hills, mountains, desert and tundra have base road difficulties of 1, 1.5, 2, 5, 1.8 and 2, respectively. Slope and river crossings add effort; local infrastructure and logistics research lower friction, while devastation raises it. Shipping has a lower distance cost than overland haulage. Infrastructure and logistics increase road/port capacity; devastation and difficult road terrain reduce it. Open-water capacity is 16,000 tonnes per segment per month before the familiarity bonus. These are synthetic coefficients, not geographic freight estimates.

Successful deliveries reinforce **undirected adjacent tile segments** shared by every route. This is inspired by the positive feedback in [Dorigo, Maniezzo and Colorni's Ant System (1996)](https://pubmed.ncbi.nlm.nih.gov/18263004/). It is a deterministic reinforcement heuristic, not a stochastic ant-colony search or a proof of global optimality. The signal represents commercial familiarity, coordination and economies of established traffic; it does not construct free roads or spend government funds.

For each fulfilled journey, the useful-flow reward is delivered tonnes divided by its total **unreinforced** travel effort, including port handling. A longer or more difficult detour earns less reward. A revisited segment receives that journey's reward only once, although every traversal consumes capacity. Rewards from different journeys accumulate on shared segments. No order, remembered supplier relationship, army movement or decorative particle deposits a reward without a completed civilian shipment.

```text
signal = 1 - exp(-sum(useful-flow rewards) / 30)
familiarity next = 0.975 × familiarity + 0.10 × (1 - familiarity) × signal
smoothed traffic next = 0.80 × smoothed traffic + 0.20 × actual traversing tonnes
capacity = terrain/infrastructure/technology allowance × (1 + 0.80 × familiarity)
effective tile cost = unreinforced cost × (1 - 0.70 × familiarity)
                      × (1 + min(8, 1.5 × (smoothed traffic / capacity)^2))
```

The familiarity discount draws nearby routes into useful shared trunks. It remains bounded: difficult terrain, longer journeys, and port handling still matter. Congestion works against unlimited convergence. Unused familiarity loses 2.5% monthly (about a 27-month half-life); negligible traces are pruned. Road, harbor and open-water capacity is shared across **different province connections**, all goods and both travel directions. Backtracking consumes the same segment again. This can leave some demand unmet even when the abstract province graph remains connected. Supplier selection uses past smoothed congestion; there is no within-month global multicommodity optimizer or residual-capacity detour search.

Every three months the planner evaluates alternatives using learned costs. An adopted tile path holds for at least 12 months, then changes only for savings above 5%, so an attractive trunk can draw other routes toward it without monthly flicker. Ports stay at the same shore tiles. Plans, adoption dates and familiarity are saved explicitly: loading a world neither resets the learned network nor triggers an early replan. Old saves without this state start learning from their next actual shipments. There are no persistent fleets, port construction levels, or navigable-river freight.

Buyers with shortages seek reachable sellers with surplus. Domestic sources receive a preference. New routes use shortest-cost searches, while an established path stays in use until another path is more than 25% cheaper in current transport effort, or an old connection becomes unavailable. Every shipment consumes the capacity shared by its path's edges for that month; later goods and shipments see the remaining capacity. Food is processed first.

Trade has inertia at the supplier and route levels. Per-good supplier shares are remembered in saved `tradeLanes`. Competitive incumbent suppliers retain their share of a buyer's current order. When a competitor offers more than a 25% transport-cost advantage (after domestic preference), 12% of the incumbent's share is released each month; actual unmet orders then go to the cheapest eligible suppliers. For a constant order, a displaced incumbent's share typically follows 100%, 88%, 77.44%, and so on. A new supplier can enter alongside existing suppliers; there is no fixed five-supplier cutoff.

Established buyers replenish small reserve shortfalls, and their suppliers can ship surplus above their own target without waiting for the 10% entry buffer. This avoids alternate months of large orders and no trade. Unused per-good remembered flow decays by 12% per month and is discarded below 0.1 tonnes; an entirely idle relationship expires after 18 months. These values are sourcing preferences, not stocks, contracts, or goods in transit. Only actual, affordable shipments enter the ledger or map. War removes hostile relationships, unavailable suppliers and full connections cannot fulfill reservations, and buyers with less than one month's household food skip supplier reservations entirely. Closed physical paths are replaced immediately when another path is available. Save/load preserves inertia; older saves initialize it from their last actual shipments.

International trades transfer treasury funds from buyer to seller. Domestic transfers use public stocks without a treasury payment. Buyers retain a minimum treasury reserve. Tariffs reduce cross-border shipment quantity and affordability; trade agreements and alliances remove that friction. There is no separate tariff-revenue ledger because inventories and payments represent a public allocation abstraction.

War closes hostile border edges and prohibits direct trade between the belligerents. Ships do not have persistent positions or voyage delays. The map merges shared physical segments, displays road and shipping legs separately, marks active harbors, and highlights the selected state's or province's imports and exports. Line width uses a square-root scale of combined monthly tonnage. Symbolic particles indicate actual shipment directions at a constant screen speed; they are presentation-only. The shipment ledger lists each cargo, total path distance (using the atlas scale), and harbor names. Older saves without physical route geometry load normally and regenerate routes on the next tick.

## Historical causation and generated events

OpenRouter generates contextual historical drafts using `deepseek/deepseek-v4.1-flash` by default. The server reads credentials from `.env`; keys never enter prompts, worker state, exports or browser bundles. Model work is asynchronous. Time continues through missing credentials, slow requests, validation failures and provider outages.

A separate saved historical PRNG samples context-weighted states, provinces and themes: succession, discovery, literature, belief, institutions, social change, commerce, disaster and diplomacy. Event intervals follow a bounded exponential draw of 2–18 months, with war and low stability increasing the hazard. A draft request can remain in flight while the local simulation advances. At the next historical moment, a suitable validated LLM draft is preferred; otherwise a locally composed contextual event occurs. The native repertoire contains 47 distinct mechanisms across the nine categories, with seeded intensities, durations, response alternatives and conditional aftermath. Local recent titles suppress immediate repetition. Material conditions weight selection and shape the account; effects are resolved by the same bounded historical system as model-authored events. Up to three prepared drafts wait in a saved queue. Conditions, current territorial control and intervening leadership changes are checked before use; unsuitable drafts are discarded or expire. Existing climate, fiscal, research and military mechanisms also continue recording their own events.

New clients request a bundle containing one bespoke draft and up to three portable mechanisms; older clients retain the original event response contract. Portable mechanisms contain short generic developments and supported gain/friction modifier names, never executable instructions or arbitrary property paths. Up to 64 are retained in the save and can be instantiated with future local contexts and new outcomes; their model provenance remains recorded. This amortizes creative generation across many later events. History launches require both ninety seconds since the last launch and twenty-four simulated months; native events do not wait for that budget.

Each LLM draft contains a title and two or three short sentences, concrete effects, optional autonomous government responses and up to two conditional follow-ups. The API requests a kind-aware JSON Schema, then the worker checks IDs, scopes, units and effect compatibility independently. Actor-relative national target `-1` is resolved to the actual requesting state; it cannot select another state. Invalid structured responses receive one repair pass. The original integration defect was reproduced with a syntactically valid provider response containing unresolved national targets and an unsupported modifier; those are now handled by explicit target binding, separate effect-kind schemas and repair feedback.

Four effect kinds share a saved lifecycle:

- **Modifiers** affect harvests, extraction, manufacturing, transport friction/capacity, taxation, research, education, healthcare, births, mortality, migration appeal, social cohesion, military effectiveness and combat morale. World, state and province contributions compose; multiplicative channels clamp the combined factor to 0.2–2.5. Province contributions to national channels are weighted by population. Cohesion and migration appeal enter behavioral scores.
- **Immediate or delayed changes** affect stability, legitimacy, treasury, opinion, unrest, literacy, health, contentment, devastation, infrastructure, research progress, prestige and pluralism. Units are validated, including fractions versus percentage points.
- **Leadership changes** record a named leader or governing body and tenure, replace the leader's persistent temperament, skills, strengths and limitation, and trigger a strategic review. They preserve institutional character and existing state commitments. Individual lifespans and genealogies are not simulated.
- **Cultural legacies** record works, belief movements and institutions. Belief and literature legacies seed small follower or reader communities that may diffuse through contact and trade. Prestige affects migration appeal; pluralism moderates exclusion. Belief populations are explicit aggregate communities; individual readers and physical text inventories are not tracked.

Modifiers can last 1–240 months, with a delay of up to 120 months and steady, fading or growing curves. Expiration removes a modifier without subtracting from an already-mutated base. LLM rate effects begin on the next tick after their event is selected; local and scheduled events enter the monthly lifecycle directly. Governments select responses from current conditions after the initial shock, policy, personality and saved randomness. There are no event-choice cards. Follow-up probability is drawn once, with conditions evaluated over a later window of up to 36 months. Provinces retain place-bound effects through conquest; national effects follow the state.

The chronicle keeps summaries concise. **More detail** generates a cached reading expansion on demand, using the recorded event and effects as facts. This expansion cannot change simulation state or add outcomes. Existing longer event descriptions can be opened without another call.

Saved outcomes, modifier clocks, response choices, follow-up draws and cultural memory continue deterministically given the same external inputs. Future LLM outputs are not guaranteed to repeat, even with a request seed. Native procedural events remain deterministic. Neither browser frame rate nor model latency stops the monthly clock; external inputs are validated against the live world when received and applied.

## State agency, communication and adjudication

Every state identity has persistent private assessment, strategy, goals, memory, institutional compliance, and decision/strategic clocks. Routine decisions default to OpenRouter's `mistralai/ministral-8b-2512`; strategy and referee roles default to the configured DeepSeek event model. The roles can be overridden independently in `.env`. A routine pass handles small domestic adjustments and requests escalation when needed. Strategic reviews become due every 12 simulated months and can also be requested by the lightweight model, new negotiations or the observer. Background calls share a five-second launch spacing and four concurrent worker requests. Each state has a thirty-second minimum launch interval; full strategy passes have an additional two-minute interval, except explicit observer requests. Routine passes reuse unchanged decisions for at least twenty-four simulated months unless hunger, stability, war, leadership, correspondence or proposed agreements change. Due states are scheduled by oldest launch so one state cannot monopolize the service. Eligibility is checked before constructing expensive census/map contexts; outstanding requests are coalesced by state. Deliberation can continue while the monthly world evolves. The current implementation is a hybrid: standing policies and military/logistical rules execute locally while models periodically revise intentions.

An agent receives its own exact government state, private notes, owned provinces and armies, public foreign summaries, visible correspondence and agreements. Secret messages and offers are included only for participants. Public broadcasts and offers are visible to other states. Observer controls can inspect a selected state's confidential archive; that UI capability does not grant the other state models access to it. Agents have no shared conversation or direct world-write capability.

Diplomatic messages can coordinate, threaten, persuade, propose terms or reject them. Offers are immutable and have an engine-issued identity and terms fingerprint. Submission records the author's consent; each other party must accept the exact offer ID and fingerprint. Counteroffers create new documents. Proposal expiry includes a deliberation grace period until invited parties have actually reviewed the offer, so provider latency alone cannot kill a negotiation; ownership, funds and willingness are still checked when replies arrive. The fingerprint is a deterministic binding check, not cryptographic protection against the human owner editing a local save. An agent cannot create another state's signature because the worker binds each response to its actual requesting actor. Ownership, consent and spendable funds are independently enforced by code.

Fully accepted offers and unilateral unusual acts go to a separate referee model with the authoritative world and consent ledger. It can approve, reject or defer them and describe plausible consequences. Submitted prose and claims are explicitly untrusted. The referee's judgment is an LLM estimate, not a guarantee of realism or immunity to persuasion; deterministic authority and conservation checks remain mandatory after any approval. Deliberate authority violations can reduce legitimacy and institutional compliance. Ordinary diplomatic bluffing, unsuccessful bargaining and genuinely stale ownership information are distinguished from forged authority. New correspondence arriving during deliberation remains unread and can trigger another strategic pass.

Agents and referee prose cite agreements with `[[agreement:ID]]`, copied from the supplied reference field or a bounded, visibility-filtered citation catalog. The interface resolves tokens into recorded agreement titles. Older explicit references such as “agreement #21” or “proposal 21” are also linked at display time; signed text and digests are never rewritten. Counteroffers expose their `supersedes` link, and correspondence exposes its associated offer. References open an expanded agreement even outside the latest twelve entries, with Back/Forward navigation. Missing or unauthorized references display a generic unavailable label; confidential targets require that state's archive access. Cited ancestors are retained during ledger trimming, including chains through counteroffers, messages, institutional memory and rulings. Citations carry no consent, execution or reactivation semantics, and do not alter numeric protocol IDs or signatures.

Supported settlement mechanisms include one-time payments, recurring tribute, physical goods supply obligations, preferential trade, alliances, peace, nonaggression, military access, guarantees, research cooperation, province transfers, territorial purchases, state formation, mergers and declarations of war. Unconventional terms can be expressed freely as custom clauses; the referee maps them into supported operations and bounded effects or explains why they cannot be carried out. It cannot execute arbitrary code or simply pretend an unsupported physical action happened. Custom financial consequences must resolve to explicit conserved transfers, not treasury multipliers.

Payments, territory, state creation and mergers execute as one transaction after rechecking the live world. Transfers and mergers conserve civilian and military population and treasury funds. Mergers carry treasury, debt and armies into the successor; state formation requires real founding provinces and funding. Cultural identity is retained rather than instantly assimilated. Capitals are relocated when needed. Extinct identities remain in historical arrays, with up to 64 state identities supported. Voluntary sovereignty transfers require all relevant parties' consent; ordinary conquest still uses the military model.

A recurring goods clause is a real logistical obligation, prioritized before ordinary market clearing and sharing the same tile and connection capacity. It draws on actual surplus, reserves, reachable buyers and real carriage; promises do not teleport or create goods. Payments for goods are separate agreed terms. Tribute transfers available treasury funds monthly and records shortfalls. Research cooperation shares bounded knowledge subject to the source's funding. Secret trade/access/alliance rights affect the relevant mechanics without automatically becoming public treaty labels. Term expiration and obligation shortfalls are retained for subsequent negotiation. Guarantees and political promises inform agent strategy; they do not automatically spawn armies or declare a new war.

Model responses are checked against current ownership and assets, and outstanding requests are canceled when a different world is generated or loaded. The worker owns playback timing and yields after short slices (one expensive month may exceed the slice budget). World snapshots are coalesced to two per second above 12×, and five per second otherwise; pause flushes the latest world. Pending external requests do not gate ticks. The requested pace is a CPU-bounded target, not a guarantee of sixty months per second for arbitrarily large worlds. Background snapshots do not acknowledge unrelated commands. Autosaves independently coalesce current snapshots every two seconds. The full regression, longevity and adversarial-agent qualification remains deferred during the ongoing feature iteration.

## Government and insolvency

Collected taxes depend on monthly output, tax rate, administrative technology, and stability. Tax rates range from 5% to 55%. Excessive tax burdens reduce contentment.

Welfare, education, military, and research sliders are relative spending weights, not literal percentages. Administration and infrastructure keep weights of 12 and 18. The service budget follows a baseline service floor and a revenue-based target, constrained by current revenue and a limited monthly draw from treasury.

Welfare improves health and contentment; education improves literacy; research funds knowledge; infrastructure funding offsets deterioration. Military funding improves training and morale. Field army upkeep and debt interest are additional expenses.

If expenses exceed treasury plus revenue, the difference becomes debt. Debt incurs 0.3% monthly interest. States with treasury reserves repay debt. Debt beyond the greater of 1,000k crowns or 24 months of gross output triggers restructuring: debt is reduced to 35% of that limit, legitimacy falls by 12, stability falls by 10, and the chronicle records the default. Fiscal surpluses gradually restore legitimacy.

## Research

Each of six fields has six levels. Required knowledge is `140 × (level + 1)^1.45`. Funding produces knowledge, modified by literacy and governance technology. Focus changes preserve all field progress.

| Field       | Implemented effects per completed level                            |
| ----------- | ------------------------------------------------------------------ |
| Agriculture | +19% base farm productivity                                        |
| Industry    | +13% base overall production efficiency                            |
| Medicine    | +0.05 health-target contribution                                   |
| Logistics   | +25% base road throughput                                          |
| Military    | +16% combat-effectiveness contribution, plus morale support        |
| Governance  | Better tax collection, literacy growth, and research effectiveness |

Discoveries are named in `TECH_NAMES`. Their labels describe an abstract progression; e.g. “Steam shipping” is not a separate naval vessel system.

## Diplomacy and warfare

Each unordered pair of states has opinion, treaty, grievance, war exhaustion, and a transition date. Treaty states are neutral, trade, alliance, war, or truce. International commerce gradually improves opinion.

- A diplomatic mission costs 150k crowns and adds 12 opinion points while at peace.
- Trade agreements require opinion ≥10; alliances require ≥45.
- Alliances grant military access and tariff-free trade. Automatic allied war entry is not implemented.
- In the native fallback, sufficiently assertive governments can declare war over accessible borders. State character, opinion, stability, and seeded randomness influence decisions. Connected state agents instead choose declarations through the diplomatic ledger.
- Exhaustion accumulates in war and rises faster with food shortages. Native autonomous belligerents settle at a character-dependent threshold of 30–50; connected state agents negotiate their settlements.
- Manual early peace proposals need exhaustion ≥5 when relations are deeply hostile. An accepted truce prevents renewed war for 60 months.

### Land forces, supply and civilian relations

Armies carry food and arms rather than drawing unlimited provisions from their current province. They aim to carry three months of food and four months of arms, consuming 34 kg food and 0.5 kg arms per soldier per month, with further arms expenditure in battles. Supply depots are existing provincial inventories: the capital, or sufficiently developed, undamaged infrastructure/industry hubs. Sources must be owned; transit requires sovereign, allied or negotiated military access. Hostile territory breaks a line. Distance, unrest and devastation reduce throughput. Supply uses actual physical road/sea paths and the capacity left after civilian freight; shipments are recorded and visible on the military map. Loading transfers real goods into carried inventories. These stores must be included in goods accounting. Supplies remain an aggregate monthly logistics flow rather than individually simulated wagons or ships' manifests.

Reserves buffer interrupted deliveries. Sustained shortage reduces morale, increases attrition, and eventually encourages desertion. Soldiers retain their population identities, mother tongue and civic allegiances. Shared language helps coordination; loyalty, pay, fatigue and provision affect cohesion and behavior, without innate cultural combat coefficients. Deserters return to local civilian communities instead of disappearing or being counted as deaths. Severe disaffection can cause temporary refusal of orders. Dead troops enter the death ledger, and surrendered forces return to the civilian census; detailed prisoner-of-war camps are not simulated.

Army standing orders select marching, recovery or entrenchment. Terrain-weighted road effort, logistics technology, cohesion, fatigue and supply determine progress; movement is no longer a guaranteed province per month. March orders follow land only. Defensive preparation takes time and is lost on movement. Mountains multiply defense by 1.8; hills/forests by 1.3, with additional river-crossing and amphibious penalties. Battles use real field forces and local levies: raising a levy removes adults and arms from the province. Casualties, retreats, occupation damage and collateral civilian deaths change the actual population ledger. Conquest preserves identities and allegiances; civilian treatment changes grievance and cooperation. A requisition order may divert up to a quarter of monthly local household food needs when ordinary provision fails, increasing local grievance, unrest and damage. No free civilian provisions are created.

### Fleets and sea control

Navies contain warships and transports, crews, hull condition, morale, provisions, arms and a water-cell position. Commissioning at an owned harbor consumes treasury, timber, iron, tools, armament and local adult crews. New worlds attempt to fund one starter fleet per coastal state from existing resources; legacy saves acquire no free ships or people. Construction is currently an immediate investment abstraction. A state may operate eight fleets, with commissions limited to 16 ships. A warship needs 90 crew and a transport 30. Crew recruitment, aging, retirement, losses, demobilization, state mergers and population identities share the military census. Ongoing fiscal upkeep, supplies, hull wear and paid repairs limit operation. Allied/negotiated port access allows resupply and repair services; foreign provisions and repair services are paid, and replacement crews are recruited only at owned ports.

Courses use connected adjacent water cells, with movement constrained by supply, crew availability, hull and logistics technology. Missions include patrol, escort, blockade, troop transport and return. Nearby hostile fleets fight using ship mix, hull, ammunition, crew readiness, supply, morale, command effects and technology. Damage, lost ships, crew deaths and lost passenger capacity have physical consequences. There are no tactical gun arcs, individual hull classes, weather fronts or rescue simulation; fleet combat is aggregate.

Warships project sea control only across nearby connected water cells. Hostile superiority reduces shipping throughput and can close a corridor; friendly/allied warships counter it. Civilian trade and military sea supply use this control. Military sea supply additionally needs an actual owned escort/transport fleet on the relevant sea route and shares its available cargo budget across deliveries. Embarked troops reduce cargo capacity. Monthly convoy capacity is abstracted; merchant hull ownership and individual supply voyages are not simulated.

An army can embark only at the same accessible harbor as an owned fleet, with sufficient berths. An intact transport carries 800 troops; warships have small incidental transport capacity. The embarked army remains separate from crew in the census, disappears from land combat, consumes its own provisions and moves with the fleet. Friendly or returning landings disembark it; hostile landings must win an amphibious battle. Lost transports can kill embarked troops. Shipwreck survival and naval prisoners are not modeled. State agents receive force readiness, port locations, fleet capabilities and naval orders; military access and sovereign authority remain checked by code.

Unrest reflects contentment, social grievance, loyalty, exclusion, occupation and devastation. Severe sustained unrest can create an independent state, up to a global limit of 64 historical state identities. It inherits its former state's technologies and begins at war with it.

## Persistence and performance boundaries

The worker owns mutable simulation state. The UI receives snapshots and sends typed commands. Save validation checks dimensions, collections, identifiers, population, stocks, policies, diplomacy, armies, routes, events, and history before accepting an import. Imports support worlds up to 128 MiB.

Recent history retains monthly points for ten years and annual points before that. The chronicle retains the latest 240 events; event identifiers continue increasing. Autosave checks for changes every two seconds and flushes when the page becomes hidden. A separate save worker performs validation, serialization and I/O so saving does not halt simulation ticks. One write runs at a time; intermediate pending snapshots coalesce into the newest one. A replaced world cannot receive stale save-success notifications. Tab closure may interrupt its final asynchronous flush; the last completed checkpoint remains authoritative.

Local preview/development saves to `.uchrony/autosaves/`, excluded from Git, with separate browser save slots identified by a local cookie. Disk writes use private temporary files, a checksum, atomic rename, file/directory synchronization and one previous verified copy. An unreadable current file falls back to that previous copy; damaged files are not copied over a good backup. Same-origin checks protect save writes, slot IDs cannot select arbitrary paths, and snapshots contain no API credentials. IndexedDB stores a second copy and provides a fallback when the disk service is unavailable. Browser fallback saves are retried against disk even while paused. Startup chooses the newest valid available replica. Neither backend uses the old size-limited `localStorage` world slot.

The old browser save remains intact and is read as a legacy fallback. `/save-recovery` can copy and verify that legacy save on disk without starting a simulation. Failed restoration no longer generates and autosaves a replacement world automatically. If both write backends fail, the UI reports the actual failure, retries, and keeps Export available. A successful retry clears the warning. Export remains the portable cross-browser workflow; local save slots are not cloud synchronization.

The deterministic core is reproducible for the same build, starting save, commands and recorded external historical inputs; future LLM outputs are not guaranteed to repeat. Rendering frame rate never changes random state. Background tab throttling changes wall-clock playback pace; it does not simulate elapsed real time while closed.

Meaningful future additions include finite mineral reserves, firms and households, occupations, investment completion times, individual convoy voyages, ship classes and naval weather, detailed prisoners/rescue, formal war goals, and empirical calibration.

## Computation and scheduling

Migration evaluates simultaneous plans using per-province culture, language and belief marginals instead of rescanning every destination community for each sort comparison. Corridors use compact undirected hex-edge indices; phase profiles share physical link costs and capacities across military views. Supply and movement graphs are shared per state within the army phase and invalidated on ownership changes. Maritime replanning stops once the required destination ports have settled shortest paths, and plans still inside their minimum adoption period avoid redundant replanning. Provincial shortest paths use a heap. Tariff preferences are prepared once per market-clearing phase; civilian and military traffic still share actual physical capacities. These are computational changes, not coarse time steps: demographic, production, consumption, research, obligations and military effects continue monthly.
