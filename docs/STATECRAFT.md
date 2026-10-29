# Sovereigns and cabinets

Every autonomous state has a persistent cabinet. It continues running whether
language-model assistance is enabled, unavailable or waiting for a response.
Human-controlled governments retain control: automatic cabinet decisions require
`nation.ai`. Optional model leaders direct strategy and issue bounded operational
overrides through the same commands used by the simulation.

## Responsibilities

| Layer                     | Decisions                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| Native or model sovereign | Strategic posture, rival, diplomatic terms and explicit interventions                       |
| Domestic cabinet          | Fiscal adjustments, research priorities, funded public works and provincial crisis response |
| Existing economic desks   | Farm improvements, enterprise subscriptions and five-year development accounts              |
| General staff             | Mobilization, frontier staging, reported theater objectives and occupation garrisons        |

`cabinet-state.ts` holds persistent intent. `cabinet-policy.ts` contains research
and fiscal utility functions. `cabinet-ai.ts` coordinates domestic execution;
`campaign-ai.ts` coordinates preparations, objectives and memories of peace.
These planners do not award people, funds, materials, access or victory.

## Persistent agendas and overrides

Postures are `consolidate`, `colonize`, `industrialize`, `prepare-war`, `wage-war`
and `pacify-crisis`. Normal mandates last 24 months. War preparation lasts at most
18 months and must last at least three months before a declaration. Actual war
or a provincial emergency can interrupt an economic agenda.

A model sends `kind=strategy`, `key=<posture>`, `target=<rival state ID>` for a
military mandate, or a province ID / `-1` for an economic mandate. `value=0` and
`text` supply a short explanation. A preparation directive delegates recruitment,
staging and a conditional declaration; `wage-war` alone does not declare war.
The cabinet still checks authority, truces, actual frontier deployment, supply,
morale, food coverage and perceived allied deterrence. An expired or deterred
preparation is abandoned, followed by a cooldown.

Explicit policy, research and army orders reserve only their affected setting or
formation for six months. Routine farming, enterprise activity and other cabinet
work continue. Recent model leaders retain ordinary offensive and peace choices;
severe exhaustion or territorial defeat permits emergency native peace proposals.
Every government must still consent to a treaty. Human signatures are never
supplied automatically.

## Domestic choices

Research scores all six fields using food and material shortages, population
health, literacy, unrest, transport utilization, leadership and strategic posture.
Each successive discovery reduces the relative utility of that field; completed
fields are excluded. Famine can prioritize agriculture immediately. The five-year
output mandate and its financial accounts persist independently of shorter-term
research reviews.

Fiscal targets use actual treasury runway, inflation, unemployment, scarcity and
mobilization. Funded public works compare local benefits per crown and retain a
six-month income/spending buffer. Food and severe material shortages leave funds
to the farm and enterprise desks. Roads, schools, paved roads, railways and ports
use the same eligibility and cost checks as explicit orders. Road and school
changes propagate to local districts so aggregation does not erase them.

Provincial protection warnings trigger tax relief and available, reachable
garrisons. When no unreserved formation is available, an organizing or contested
noncapital province can receive a recorded devolution charter. This is a response
to observed conditions, not a guarantee that a rebellion is prevented.

## Campaigns and peace

The general staff retains one reported objective per enemy front for six months,
concentrates reachable formations, and keeps the force needed to hold occupied
provinces. Armies still move and fight through ordinary land routes, logistics,
terrain and combat rules. An equally strong opponent no longer makes every
frontier formation entrench automatically.

War memory survives the end of the five-year truce. Repeating a previous war
requires increased grievance, a renewed claim with fresh friction, or a decisive
perceived change in relative power. Old grievances alone do not restart the cycle.
Native peace proposals distinguish exhaustion without occupation from limited
territorial settlements and decisive occupation. Concessions and indemnities are
bounded and revalidated at settlement; proposals do not confer another state's
consent.

## Model action menus

`statecraft-affordances.ts` supplies individually validated recruitment, public
works and pioneer founding options, together with bilateral peace situations.
Quotes share actual funds and supplies, so they are alternatives, not a batch
purchase reservation. Commands recheck current conditions after deliberation.

- `recruit`: `target=canRecruitIn.id`; frontier economies can raise at least 50
  soldiers at six months of current domestic wages per recruit. Legacy economic
  policies retain the 500-soldier minimum and historical price.
- `build`: `target=canBuildIn.id`, `text=canBuildIn.building`.
- `found`: `target=canFoundTargets.cell`, `key=''`, `value=0`, `text=''`. This is a
  **terrain cell ID**, not a province ID. Pioneer costs and settlers match native
  expeditions. The existing manual founding command retains its default expedition.

Menus contain no private foreign treasury or military ground truth. The frontier
search is bounded to eight surveyed neighboring provinces and the configured
site count per province. Model context retains the latest twelve action receipts,
including normal resource failures. A founding quote that becomes stale does not
incur an integrity penalty.

## Persistence and validation

Old saves may omit cabinet memory and acquire it on the next autonomous review.
Present agendas, dates, overrides, war memories, theater objectives and action
receipts are validated on load. Monthly and coarse reviews use simulation time.
The regression coverage is in `tests/cabinet-statecraft.test.ts`, alongside the
existing agriculture, development, diplomacy, founding and military tests.

These are deterministic planning rules and validated action contracts. They do
not establish long-run historical calibration or live-provider output quality.
