# Military access and trade restrictions

The bilateral diplomacy dossier now separates commerce from the host's permission for foreign forces. Policies are directional, stored on each side of a relation, and survive save/restore. War overrides every peaceful grant. Unspecified border policies follow the current treaty rules.

## Permissions and agreements

- **Transit** permits passage and a visit of up to three months, without resupply.
- **Transit and resupply** adds supply corridors and purchases at eligible depots and ports.
- **Basing** permits permanent deployment as well as transit and resupply.
- **Follow agreements** uses active clauses, alliances, eligible defense institutions and common sovereignty. **Deny access** overrides those grants.

Signed `transit`, `access` and `basing` clauses are granted by `from` (host) to `to` (visitor). A nonempty `regions` list limits the grant to host provinces; an empty list covers the host. `duration=0` creates a standing agreement. Consent and preparation use the existing diplomatic process. Revocation or an expired visit orders a physical withdrawal: armies cannot teleport through a hostile encirclement. Peaceful overstayers lose resupply, and fleets seek an accessible permanent base.

**Normal trade** uses ordinary tariffs and active agreements. `preferential-trade` halves normal tariffs; `trade`, alliances and eligible customs institutions remove them. Existing `goods` clauses continue to define commodity supply obligations. **Restricted trade** prohibits arms, restores normal tariffs plus 25 percentage points and limits each commercial route's monthly capacity to 20%. **Embargo** closes formal imports, exports and transit in either direction. These explicit restrictions override commercial privileges without deleting the agreement.

Formal trade between belligerents stops completely; smuggling is not modeled. Both market resolutions check the buyer, seller and every land/harbor host, including long surveyed routes and neutral intermediate markets. Goods promises cannot bypass closures. Paid cargo in transit stays in its conserved inventory until its route reopens. This is a route-level model, without a separate origin-tracing customs system for goods resold in a later month.

The animated map rechecks current war, embargo, restricted-arms and naval-closure rules before displaying recorded shipments. Completed trade remains in accounting history, but no longer animates across a newly closed route. Remembered roads remain visible without spawning carts unless current cargo uses them.

## Blockades and sacking

A blockade requires warships and war with the target port owner. Its strength depends on crews, hulls, morale, provisions, ammunition and technology. Only vessels within four traversable water-cell spans contribute; pressure cannot cross land. A sufficient cordon closes the port to trade and troop access, including neutral traffic. Defending and escorting fleets can contest it. Distant, starved or disarmed fleets cannot maintain a closure, and peace cancels it immediately.

The army conduct **Sack hostile trade routes nearby** intercepts cargo crossing the army's province without requiring secure occupation. The naval **Sack hostile sea trade routes** mission intercepts nearby waterborne consignments. At least one cargo endpoint must belong to an enemy. Neutral-only trade is spared. Local guards and escorts reduce interception.

Raids use a shared aggregate interception rate and a finite monthly tonnage budget per formation. Captured food and ammunition enter carried stores up to three months of food or four months of army ammunition; other intercepted cargo is destroyed. The physical-goods ledger records the loss, national accounts record asset transfers/destruction, and no new money is created. Purchases still settle: merchants bear the cargo loss. Raid reports show actual captured and destroyed quantities. Raiders leave a risky sea lane open rather than closing all traffic before there is anything to intercept.

## Destructive army raids

The army conduct **Raid cities, roads and production facilities** (`raze`) requires **Hold and recover** or **Prepare defensive positions** in securely occupied enemy territory. Supplied, orderly troops spend carried ammunition. Their pooled effective strength determines damage, capped at 25% of remaining assets per month; small remnants eventually collapse completely. Splitting formations cannot multiply damage, and the province's saved report prevents repeating a raid in the same month.

Raids reduce actual housing capacity, building floor area, merchant and enterprise capital, unfinished capital projects, road infrastructure and surveyed lanes. Destroyed buildings lose their footprints; destroyed road upgrades lose their transport bonuses. Pending housing and urban redevelopment projects are cancelled so an old blueprint cannot restore demolished assets for free. Neutral territory, sea routes and natural resource deposits are unaffected. Existing deposits, loans and population remain: destroyed housing leaves people without enough accommodation, while devastation and grievance increase. Paid reconstruction can restore assets later.

The army panel and world events report housing and capital losses plus demolished buildings and road segments. Existing cargo sacking and deposit pillage remain separate orders.

## Isolated territory

Capital connections follow the same physical transport network and political closures. A neutral open corridor or an accessible sea route can sustain an exclave. After three disconnected months, civil reach deteriorates over twelve months, reducing its civil-protection contribution by up to 65% and gradually increasing grievance and unrest. Local forces and institutions still matter. Reconnection reduces the isolation counter by two months per tick, but does not erase past grievances. Existing sovereignty rules determine any eventual revolt or territorial loss; isolation alone does not automatically annex a province.

## Implementation and validation

Access grants and political route views are indexed once per phase. Physical route owners are cached within that phase; mutations and later months rebuild the view. Naval reach is bounded, and raiders/guards are indexed by location. Supply, markets, commands, diplomatic clauses, agent orders, persistence and dossier controls share the same policy vocabulary.

Focused regressions are in `tests/border-access.test.ts`, `tests/trade-interdiction.test.ts` and `tests/military-routing.test.ts`. They cover direction, scoped/expired grants, embargoes, neutral detours, closure and reopening, actual cargo conservation, counterforces, temporary visits and save validation. `tests/browser/border-access.html` provides an isolated interface fixture using real commands.

### Validation on 30 October 2026

- `npm run build` and `npm run format` completed successfully.
- 47 distinct focused regressions passed across border access, trade interdiction, military routing and saves, diplomatic access, trade inertia, corridors, and the cabinet's reserved army order. The border suite additionally verifies the shared 20% route quota at both market resolutions and resets isolation when sovereignty changes.
- Browser checks exercised policy changes, a preferential-trade proposal, wartime disabling, and army/naval raid orders. Desktop and 390px mobile layouts were inspected; the mobile page had no horizontal overflow or unlabeled form controls. The design detector reported no findings in the changed control components.
- The full `npm test` run was **not clean** in the shared working tree. It encountered concurrently changing settlement modules (`settlement-morphology`, `FIELD_SPAN`, `refreshCityLabels`), unrelated assertions, and a local-server permission failure. Feature regressions exposed during that run were repaired and their affected suites rerun. The focused results do not certify the entire concurrent checkout.

The four refinement passes covered the changed boundaries and functions: shared host-policy and route rules, physical withdrawal and cargo conservation, phase-local indexes and bounded naval reach, and explanatory comments and formatting. The route-owner regression verifies that repeated political checks scan each physical route once per phase and skip cell reads entirely for unconstrained states.
