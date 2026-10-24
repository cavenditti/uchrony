# Uchrony

A living atlas of people, resources, trade, and competing futures.

Uchrony is a local world-history simulation inspired by [Aprento's Fantasy Map Simulator timelapse](https://youtu.be/aobeydG8Sd4). Generate a world, let its governments act autonomously, or intervene in any state. Population, production, transport, policy, research, and warfare share one simulation state.

This is an experimental aggregate simulation, not a calibrated historical model. It implements the interconnected systems below; it does not yet model individual households or firms, real-world geography, or ship-by-ship naval tactics.

## Run

Node.js 22.12 or newer is recommended.

```sh
npm install
# Set OPENROUTER_API_KEY in .env (see .env.example).
npm run dev
```

Open **http://127.0.0.1:5173**. The server binds to loopback. Monthly simulation runs in a browser worker; a local server generates contextual historical events through OpenRouter. OpenRouter supplies contextual history, state decision agents and an independent diplomatic referee. All model work runs asynchronously; monthly simulation never waits for a response.

Set `OPENROUTER_API_KEY` in the ignored `.env` file. The default event/strategic `OPENROUTER_MODEL` is [`deepseek/deepseek-v4.1-flash`](https://openrouter.ai/deepseek/deepseek-v4.1-flash). Routine decisions default to [`mistralai/ministral-8b-2512`](https://openrouter.ai/mistralai/ministral-8b-2512). Override `OPENROUTER_DECISION_MODEL`, `OPENROUTER_STRATEGY_MODEL` and `OPENROUTER_REFEREE_MODEL` independently in `.env`; `.env.example` documents them. The key stays on the server and is never included in browser bundles, prompts, exports or autosaves. The server rereads configuration when connecting, so after adding a key use **Retry connection**.

Both `npm run dev` and `npm run preview` include the history endpoint. A plain static-file host alone cannot run the required OpenRouter integration. Model calls are paid through OpenRouter; local calculations and procedural events are not. A compact decision model handles routine matters, with periodic or requested strategic passes and a separate referee for settlements and unusual acts. Requests are coalesced per state, throttled, and limited to four concurrent calls in a worker. Missing or delayed drafts never stop time: suitable local events fill the gaps, while validated LLM drafts wait for an appropriate situation. Summaries are a few sentences; **More detail** requests an expanded account only when opened.

```sh
npm run build         # Type-check and produce dist/
npm run preview       # Serve the production build locally
npm test              # Simulation and persistence regression suite
npm run test:soak     # Three 200-year simulations with invariant checks
npm run format:check  # Check source formatting
npm run test:trade-stability # Measure supplier continuity across three 20-year runs
npm run test:trade-corridors # Isolate convergence and inertia on parallel crossings
```

## Explore a world

1. **Play** advances time in monthly ticks. Choose 1×, 4×, 12×, or 60×; pause to advance one month or one year precisely.
2. **Select a state** from the left rail, or a **province** on the map. Drag to pan and scroll to zoom. Wheel zoom stays anchored under the cursor; double-click zooms into a location. Map buttons also support zoom and reset.
3. **Change the map layer** between politics, terrain, population, culture, language, belief, contentment, food coverage, trade, and military activity.
4. Use the **Population, Economy, Diplomacy, Military, Research, and Government** views to inspect or intervene. The chronicle records important events.
5. **Export** before trying a different history. Importing a save restores the exact random state and pauses the simulation.

Changing a policy or research focus places that government under manual control. Other states continue autonomously. “Return all states to autonomy” restores autonomous decision-making. Sandbox interventions and province investments are available while observing, too.

Keyboard shortcuts: **Space** play/pause, **1–4** speed, **L** cycle layers, **/** find a state, **Esc** clear a province or march order. Province navigation is also available through the population panel for keyboard users.

## Implemented systems

| System | Mechanisms and consequences |
| --- | --- |
| Geography | Reproducible seeded continent generation; 8,064 hex cells; about 180 provinces plus isolated islands; separated continents and offshore islands; irregular coasts, mountain belts, latitude/moisture biomes, connected river basins, and resource richness. Start with 4–12 fictional states. |
| Demography and identity | Joint communities with children, adults and elders, cultural belonging, mother tongue, belief, political outlook and civic allegiance. Living conditions shape fertility, mortality, education, wealth, grievance and loyalty. Gradual language learning, cultural mixing, new traditions and dialects; migration follows safety, opportunity, diaspora networks and shipping links. Recruitment, casualties and retirement preserve community identities and census totals. |
| Resources and production | Eight goods: food, timber, stone, iron, coal, tools, textiles, arms. Terrain, labor, land capacity, infrastructure, damage, policy, and technology affect output. Manufacturing consumes actual inputs. |
| Distribution | Local reserves, scarcity-sensitive prices, domestic and international shipments, terrain-cost roads, water-only shipping between reachable harbors, learned shared corridors, terrain and congestion costs, persistent suppliers and paths, shared tile capacity, tariff friction, wartime border closures, spoilage and storage limits. |
| Government | Taxation, migration rules, citizenship, language education, freedom of belief, institutional identity, production priority, conscription, and weighted spending. Privilege and exclusion affect services, loyalty and migration; recognition does not instantly assimilate people. Treasury, debt service, insolvency, legitimacy, and stability. |
| State character and leadership | Public attitudes, government institutions and persistent leader temperaments combine into a recognizable state character. Six behavioral dimensions, five leadership skills, two strengths and one limitation guide policy, diplomacy, research and historical responses. Succession replaces personal traits while preserving institutions, population and state commitments. |
| State agents and diplomacy | Persistent private strategy and memory for every state; lightweight routine decisions; periodic and requested strategic reviews; public/secret correspondence, immutable offers, counteroffers and exact consent. An independent referee adjudicates trade, aid, tribute, territorial sales, surrender, state creation/mergers, access, research cooperation and unconventional proposals. Code enforces authority, consent, live resources and conserved transfers. |
| Warfare and navy | Armies carry provisions and arms, use capacity-limited supply lines, accumulate fatigue, entrench and interact with civilians. Troop identities, shared language, loyalty, pay and provisioning affect cohesion, desertion and disorder. Actual population levies defend provinces. Funded warships and transports have crews, hull condition, provisions, ammunition, water-only courses, sea battles, escorts and blockades. Overseas troops need embarkation, transport berths and landings. |
| Research | Agriculture, industry, medicine, logistics, military, and governance, with six implemented levels each. Funding and literacy generate knowledge; changing focus preserves progress. |
| Historical causation | Required contextual OpenRouter generation: succession, discoveries, literature, beliefs, institutions, social movements, commerce, disasters and diplomacy. Immediate changes, delayed and fading effects, policy-driven government responses, conditional follow-ups, leadership and cultural memory. Existing physical-system events still record climate, shortages, wars and discoveries. |
| Persistence | Versioned JSON exports, strict import validation, recorded historical effects and pending generation, browser autosaves, recent monthly history, older annual history, and the latest 240 chronicle entries. |

### A few causal chains

- A drought damages local agriculture and depletes food reserves. Accessible surpluses can arrive by road or sea; transport capacity, tariffs, treasury, and war constrain delivery. A shortfall raises mortality and migration pressure.
- Recruitment consumes treasury funds and arms, then removes working-age adults from local production. The new force needs ongoing food, equipment, and funding. Poor supply damages morale and kills soldiers through attrition.
- An invasion changes ownership and damages production. Communities retain identities and old allegiances; occupation, exclusion and material conditions shape their response. Losing a capital reduces stability; losing every province ends the state.
- Education raises literacy, which helps production and research. Agricultural discoveries raise yields; improved logistics expands road throughput; medicine improves health.
- Low taxes can leave a government unable to fund basic services and army upkeep. Debt incurs interest; insolvency triggers restructuring and a loss of legitimacy rather than unlimited compounding.

## Model and architecture

The formulas, units, approximations, and monthly order are documented in [docs/MODEL.md](docs/MODEL.md).
The tested workflows, regression coverage, and 1,080-year run are recorded in [docs/VALIDATION.md](docs/VALIDATION.md).

```text
src/sim/types.ts        Shared state, commands, and worker messages
src/sim/random.ts       Seed hashing, PRNG, geographic noise
src/sim/geography.ts    Continental relief, climate, and drainage
src/sim/generate.ts     Terrain-aware provinces, states, and initial armies
src/map/               Shared polygon geometry, relief rendering, and label placement
src/sim/economy.ts      Production, trade allocation, consumption
src/sim/transport.ts    Terrain roads, fixed harbors, persistent shipping paths
src/sim/corridors.ts    Useful-flow reinforcement, evaporation, congestion and tile capacity
src/sim/trade-memory.ts Persistent supplier shares and route switching thresholds
src/map/trade.ts        Aggregated freight corridors and distance-based flow
src/sim/engine.ts       Fiscal policy, demographics, research, diplomacy, warfare
src/sim/history.ts      Asynchronous historical drafts, local events and consequences
src/sim/statecraft.ts   State agents, consent, settlements and referee enforcement
src/sim/agreements.ts   Active diplomatic rights and physical supply obligations
src/sim/history-schema.ts Structured event contract and validation
src/sim/effects.ts      Scope-aware, time-dependent effect composition
server/storyteller.ts   Server-side model services for dev and preview
src/sim/persistence.ts  Untrusted-save validation
src/sim/worker.ts       Simulation worker and command dispatch
src/components/        Canvas atlas and country/province inspectors
src/App.tsx            Playback, selection, autosave, import/export, keyboard controls
tests/                 Behavioral and long-horizon invariant tests
```

The simulation engine is independent of React and the DOM. A dedicated Web Worker advances the world while the main thread renders the interface. Model randomness comes from saved pseudorandom state; accepted LLM narratives and effects are saved as historical facts. Future LLM generations are external inputs and can differ even with the same request seed. Rendering animation never changes simulation results.

The UI uses React, TypeScript, Vite, Canvas, Lucide icons, and self-hosted Alegreya fonts. No map imagery or remote fonts are fetched at runtime. Third-party packages retain their own licenses.

## Map generation and rendering

The geography setting selects one, two, three, or five major landmasses, with smaller offshore islands. Province and initial state expansion account for terrain costs. Mountain belts, moisture, latitude, and drainage influence the map; rivers collect runoff and reach the sea, with a small fertility benefit along their course.

The atlas traces shared province boundaries, smooths shorelines, blends terrain shading, and places labels with collision checks. Province divisions and smaller place names become visible as you zoom. The underlying simulation remains a 112 × 72 hex grid; this is a cartographic rendering improvement, not an increase in simulation resolution.

Existing saved worlds retain their geography and load normally. Use **New world** to see the revised generator. New worlds with an old seed now differ from the original generator; exports retain their complete map and generator version.

The trade layer shows actual monthly freight on shared roads and shipping lanes. Roads use low-cost terrain paths; ships follow connected water between reachable coastal harbors. The selected state's or province's imports and exports are emphasized. Width represents summed tonnage in both directions, and moving dots indicate direction. The economy panel lists cargo, distance, and harbors. Trade relationships persist through minor cost changes: established paths require a 20% cost improvement to switch, while better suppliers gain traffic gradually. War and urgent shortages override supplier inertia; the memory survives save/load. Old saved shipments without physical paths become visible again after advancing one month.

## Scope and next extensions

The present model operates at provincial and monthly resolution. Trade dots visualize monthly deliveries rather than persistent vehicles. States administer a public-inventory economy rather than separate firms and household markets. Mineral richness is renewable throughput, not a finite geological reserve. Port links are geographic approximations. Alliances grant access but do not automatically draw allies into war. The independent-region mechanic is simple and requires sustained severe unrest.

Natural next extensions are real geography imports, more granular professions and markets, persistent freight and supply lines, separate naval forces, treaty terms and war goals, a larger technology graph, and historical calibration. None is represented as implemented in this build.

Browser-local saves belong to the current origin and browser profile. Export important worlds. A suspended or closed tab does not continue simulating; a changed model version is not guaranteed to reproduce a previous build's future.
