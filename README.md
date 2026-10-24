# Uchrony

A living atlas of people, resources, trade, and competing futures.

Uchrony is a playable, local world-history sandbox inspired by [Aprento's Fantasy Map Simulator timelapse](https://youtu.be/aobeydG8Sd4). Generate a world, let its governments act autonomously, or intervene in any state. Population, production, transport, policy, research, and warfare share one simulation state.

This is an experimental aggregate simulation, not a calibrated historical model. It implements the interconnected systems below; it does not yet model individual people or firms, real-world geography, freeform diplomatic negotiations, or detailed naval warfare.

## Run

Node.js 22.12 or newer is recommended.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The server binds to loopback. The application runs entirely in the browser and does not need an account, API key, paid service, or backend.

```sh
npm run build         # Type-check and produce dist/
npm run preview       # Serve the production build locally
npm test              # Simulation and persistence regression suite
npm run test:soak     # Three 200-year simulations with invariant checks
npm run format:check  # Check source formatting
```

## Explore a world

1. **Play** advances time in monthly ticks. Choose 1×, 4×, 12×, or 60×; pause to advance one month or one year precisely.
2. **Select a state** from the left rail, or a **province** on the map. Drag to pan and scroll to zoom. Map buttons also support zoom and reset.
3. **Change the map layer** between politics, terrain, population, contentment, food coverage, trade, and military activity.
4. Use the **Population, Economy, Diplomacy, Military, Research, and Government** views to inspect or intervene. The chronicle records important events.
5. **Export** before trying a different history. Importing a save restores the exact random state and pauses the simulation.

Changing a policy or research focus places that government under manual control. Other states continue autonomously. “Return all states to autonomy” restores autonomous decision-making. Sandbox interventions and province investments are available while observing, too.

Keyboard shortcuts: **Space** play/pause, **1–4** speed, **L** cycle layers, **/** find a state, **Esc** clear a province or march order. Province navigation is also available through the population panel for keyboard users.

## Implemented systems

| System | Mechanisms and consequences |
| --- | --- |
| Geography | Reproducible seeded continent generation; 8,064 hex cells; about 180 provinces plus isolated islands; coasts, elevation, moisture, terrain, rivers, and resource richness. Start with 4–12 fictional states. |
| Demography | Children, adults, and elders; births, aging, health-dependent mortality, food-shortage mortality, literacy, employment, urbanization, migration, local culture, contentment, and unrest. Military recruitment removes adults from civilian work. |
| Resources and production | Eight goods: food, timber, stone, iron, coal, tools, textiles, arms. Terrain, labor, land capacity, infrastructure, damage, policy, and technology affect output. Manufacturing consumes actual inputs. |
| Distribution | Local reserves, scarcity-sensitive prices, domestic and international shipments, shortest accessible paths, road and port capacity shared by shipments, tariff friction, wartime border closures, spoilage and storage limits. |
| Government | Taxation, migration rules, production priority, conscription, weighted allocations for welfare, schools, military training, research, administration, and infrastructure; treasury, debt service, insolvency, legitimacy, and stability. |
| Diplomacy | Bilateral opinion, paid missions, trade accords, alliances, military access, war, exhaustion, armistices, and revocation of preferential access. Autonomous governments react to trade, shortages, borders, and personality. |
| Warfare | Provincial movement, port connections, recruitment, food and equipment consumption, supply attrition, morale, experience, training, terrain defense, technology, garrisons, casualties, occupation, devastation, retreat, capital relocation, and state collapse. |
| Research | Agriculture, industry, medicine, logistics, military, and governance, with six implemented levels each. Funding and literacy generate knowledge; changing focus preserves progress. |
| Emergent events | Dry and favorable years, food shortages, technological discoveries, treaties, wars, conquests, defaults, and possible independence movements under severe unrest. |
| Persistence | Versioned JSON exports, strict import validation, deterministic continuation, browser autosaves, recent monthly history, older annual history, and the latest 240 chronicle entries. |

### A few causal chains

- A drought damages local agriculture and depletes food reserves. Accessible surpluses can arrive by road or sea; transport capacity, tariffs, treasury, and war constrain delivery. A shortfall raises mortality and migration pressure.
- Recruitment consumes treasury funds and arms, then removes working-age adults from local production. The new force needs ongoing food, equipment, and funding. Poor supply damages morale and kills soldiers through attrition.
- An invasion changes ownership and damages production. The occupier inherits the local culture and higher unrest. Losing a capital reduces stability; losing every province ends the state.
- Education raises literacy, which helps production and research. Agricultural discoveries raise yields; improved logistics expands road throughput; medicine improves health.
- Low taxes can leave a government unable to fund basic services and army upkeep. Debt incurs interest; insolvency triggers restructuring and a loss of legitimacy rather than unlimited compounding.

## Model and architecture

The formulas, units, approximations, and monthly order are documented in [docs/MODEL.md](docs/MODEL.md).
The tested workflows, regression coverage, and 1,080-year run are recorded in [docs/VALIDATION.md](docs/VALIDATION.md).

```text
src/sim/types.ts        Shared state, commands, and worker messages
src/sim/random.ts       Seed hashing, PRNG, geographic noise
src/sim/generate.ts     Geography, provinces, initial states and armies
src/sim/economy.ts      Production, route graph, trade, consumption
src/sim/engine.ts       Fiscal policy, demographics, research, diplomacy, warfare
src/sim/persistence.ts  Untrusted-save validation
src/sim/worker.ts       Simulation worker and command dispatch
src/components/        Canvas atlas and country/province inspectors
src/App.tsx            Playback, selection, autosave, import/export, keyboard controls
tests/                 Behavioral and long-horizon invariant tests
```

The simulation engine is independent of React and the DOM. A dedicated Web Worker advances the world while the main thread renders the interface. Model randomness comes from a saved pseudorandom state; rendering animation never changes simulation results.

The UI uses React, TypeScript, Vite, Canvas, Lucide icons, and self-hosted Alegreya fonts. No map imagery or remote fonts are fetched at runtime. Third-party packages retain their own licenses.

## Scope and next extensions

The present model operates at provincial and monthly resolution. Trade dots visualize monthly deliveries rather than persistent vehicles. States administer a public-inventory economy rather than separate firms and household markets. Mineral richness is renewable throughput, not a finite geological reserve. Port links are geographic approximations. Alliances grant access but do not automatically draw allies into war. The independent-region mechanic is simple and requires sustained severe unrest.

Natural next extensions are real geography imports, more granular professions and markets, persistent freight and supply lines, terrain-aware sea routing, separate naval forces, treaty terms and war goals, a larger technology graph, and historical calibration. None is represented as implemented in this build.

Browser-local saves belong to the current origin and browser profile. Export important worlds. A suspended or closed tab does not continue simulating; a changed model version is not guaranteed to reproduce a previous build's future.
