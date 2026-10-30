# Dynasties, influence and capitulation

The bilateral state dossier exposes royal diplomacy at peace and **Dictate capitulation** during war. These mechanics execute locally; model agents may use the same operations, but no model referee is needed for a signed royal agreement or a valid imposed settlement.

## Defeat and the victor's decision

The victor can impose a settlement when it securely controls **every remaining enemy province** and has at least twice the defeated state's effective field-army strength. This includes a state reduced to one province. Control uses the ordinary supplied, organized garrison requirements; a control marker without a real holding force is insufficient. Effective field strength is soldiers × supply × morale × cohesion. Fleets do not hold land.

There is no defeated-government signature and no six-month wait for complete capitulation. A surviving field army above the strength threshold can still contest defeat. Ordinary partial annexation retains its six-month requirement. Native peace negotiations cannot remove a human victor's available capitulation choice automatically.

The victor chooses:

| Outcome                | Territorial and political effect                                                                      | Financial and military effect                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Annexation             | Absorb all remaining provinces; local resistance remains                                              | Inherit the entire public treasury, debt, supplier obligations and government ownership claims. Demobilize defeated armies and fleets. Pay the ordinary administration cost. |
| Subject state          | Preserve a separate government; offensive foreign policy requires the superior's authorization        | Collect a selected 0–100% cash indemnity; demobilize the defeated forces; collect 15% of subsequent public receipts, limited by available cash.                              |
| Personal union         | Two monarchies share the victor's ruler and foreign-policy authority                                  | Collect the selected indemnity, while preserving separate treasuries, debts and military ownership.                                                                          |
| Independent settlement | Restore independent government with a five-year truce and withdrawal of the victor's occupying armies | Collect the selected indemnity and demobilize defeated forces.                                                                                                               |

Indemnities transfer existing money. Local merchant and household wealth remains private. Resources and buildings remain at their physical locations. Demobilized people and military supplies return to the civilian market at their location; they are not deleted. The original state identity remains in history after absorption. Withdrawal issues marching and sailing orders; troops and fleets still need traversable routes and time to return home.

Imposed subordination can replace a defeated state's previous overlord; restoring independence removes that earlier subordination. Voluntary unions cannot override an existing superior. A subordinate victor cannot acquire its own subjects, and a defeated superior must resolve its existing dependencies before becoming a subject or junior crown, keeping authority free of chains and cycles.

The same public-estate handover applies when ordinary annexation takes the final province, when a signed cession removes the final territory, and when states merge. In a multi-recipient cession, the recipient of the last recorded cession inherits the remaining public estate. Mergers retain and reassign the predecessor's forces, whereas conquest demobilizes them. A disappearing superior's subject relationships follow its successor without creating chains; personal-union claims cannot pass to a republic.

## Royal marriages and succession

Royal marriage joins two consenting monarchies through named adult royal representatives. Each house can maintain up to four marriage alliances, with different representatives. Both states must sign and diplomatic preparation must complete. Native courts require relations of at least +25 and their own legitimacy of at least 35; a human government supplies its own consent.

A marriage immediately improves relations by 10 and supports another 0.15 opinion per monthly evaluation. It does not transfer territory, cash or command of armies. The displayed influence score combines positive relations and the marriage tie; subject and union authority produce stronger influence. Actual consequences are the relationship improvement, inheritance claim, military access and foreign-policy authority, rather than an extra resource created by that score.

After a marriage has existed for a year, the partners may sign a personal union. `from` becomes the senior crown and `to` the junior. Native junior courts require relations of at least +65, senior legitimacy of at least 60, their own legitimacy of at least 40 and leadership dominance below 0.65. Marriage alone cannot force this voluntary transfer.

Each monarchy records a house, ruler, designated heir or absence of a direct heir, and a succession date. Reigns last a seeded 15–35 years; one fifth of generated reigns have no designated direct heir. These are synthetic parameters, not historical calibration. The next ruler and succession date cannot be rerolled by saving, loading or requesting a preview.

At succession, a designated heir inherits locally. Without a direct heir, an established marriage can supply a claim to a living independent partner with nonnegative relations and legitimacy of at least 40. The best relationship wins, with stable state-ID ties. Existing dependencies cannot form a cycle or a chain. If no eligible claim exists, a new local dynasty takes over. The senior ruler's later succession also updates the junior crown. War or a change away from monarchy ends a personal union. War or a change of house ends a marriage alliance.

This is a compact house-and-claim model, not a complete family tree, fertility model or historical succession-law system. Royal representatives are named, but the simulation does not maintain their individual ages, children or biological relationships.

## Cabinet deliberation

Routine and strategic model briefings include `sovereignStrategy`: current crown and heir, direct dependencies and offensive authority, contacted royal partners, marriage and union eligibility in both directions, and all four wartime settlement options. Each option exposes its current legal blocker, administration cost, financial consequences, force disposition and lasting risks. Legality uses the same rules as execution; an eligible settlement is not automatically desirable.

The cabinet sees foreign treasury and debt only through dated intelligence estimates, including confidence and uncertainty. Missing reports do not mean zero wealth or zero liabilities. Internal succession dates are not exposed as predictions. Marriage offers a contingent claim; a direct heir and competing claims can prevent inheritance. Becoming a junior crown is explicitly assessed as replacing its ruler and surrendering offensive foreign-policy authority, even without territorial loss.

An active model sovereign retains the decision to sign a royal agreement. Native consent resumes under the existing six-month fallback rule; human-controlled governments never receive automatic signatures. Changes in crown, dependency authority, mature union opportunities or available capitulation outcomes request a fresh strategic review. An unchanged situation does not request another review every month; loading a save may request one fresh review. A capitulation that was available when deliberation began but becomes invalid requests replanning instead of penalizing the cabinet for stale information.

The state and referee prompts explain the consent boundary: negotiated royal and territorial agreements need signatures, while complete military defeat permits a validated unilateral capitulation order. Annexation carries public liabilities and an upfront administration cost; subjects pay funded tribute; unions retain separate accounts and forces; restored independence permits later rearmament. Native settlement advice also considers the leader's priorities and risk tolerance, reserving six months of the current fiscal deficit before recommending direct annexation to a cautious leader. This advice does not bind a model sovereign.

## Validation and limits

Settlement application uses isolated financial, military, population, dynasty and dependency state. Ineligible or unaffordable settlements fail before committing. Save validation rejects invalid references, duplicate marriage pairs, malformed fiscal shares and dependency chains or cycles. Older saves acquire crown records without changing their existing residents, treasury or ruler.

`tests/dynastic-capitulation.test.ts` covers the four imposed settlements, complete-annexation succession, consent, native ratification, heirless inheritance, separate union accounts, foreign-policy authority, conservation, saves and the bilateral controls. The existing settlement, war and institutional suites exercise the surrounding contracts.

`tests/cabinet-sovereignty.test.ts` covers briefings and information boundaries, senior/junior union assessments, retained model consent, strategic review triggers, all four outcomes through the model-plan execution path, stale decisions and native fiscal advice. These checks validate the model's inputs and executable outputs, not the quality of an external model's actual reasoning.
