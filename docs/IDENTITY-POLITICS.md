# Identity policy and political consent

The model uses eight continuous state policy fields (0–1), five learned community attitudes, and slow local implementation. These are synthetic mechanisms, not historically calibrated estimates.

## Policy dimensions

| Field                  | Meaning                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `languageEducation`    | Common-language teaching allocation                                    |
| `localLanguageSupport` | Local-language teaching and continuity allocation                      |
| `languageAssimilation` | Pressure to replace native speech with official speech                 |
| `languageExclusion`    | Opportunity restrictions for insufficient official-language competence |
| `culturalAssimilation` | Promotion of the official cultural identity                            |
| `culturalExclusion`    | Privileges reserved for the official culture                           |
| `stateFaithSupport`    | Public support for the official faith                                  |
| `faithRestrictions`    | Restrictions on other faiths                                           |

The old citizenship/language/belief enums are preset commands and import fallbacks. Runtime effects read continuous fields only. Preset commands overwrite only their own axis; custom controls preserve other settings. The inspector derives the displayed preset from actual values.

Local implementation adjusts by 4% of the remaining gap each month. It starts at zero where no implementation is recorded. Purchased education services limit teaching capacity; common and local allocations share it. Purchased administration and policing services limit implementation of other interventions. Service output is normalized per 10,000 residents, with a minimum denominator of one. These settings redirect existing capacity; they do not create funds, teachers, or police. If capacity disappears, implementation decays. There is currently no separate religious-institution budget or identity-specific exception list.

Districts own implementation records. Identity evolution uses their population-weighted provincial aggregate for exposure and each community's resident district for learning and adoption. Provinces without a district economy use their own implementation. Declarations alone cannot fund conversion pressure.

## Community politics

The independent axes are pluralism, group identification, acceptance of authority, preference for local autonomy, and preference for religion in public life. Initial values follow political movements, never cultural or religious labels. Thereafter they approach movement attitudes at 0.1% of the remaining gap monthly. Exclusion can increase group identification; it does not automatically increase pluralism.

Compatible communities merge population-weighted attitudes, government support, and household-language transmission. None of these attributes becomes a census key, avoiding combinatorial fragmentation. Existing dated age and sex cohorts remain unchanged by political evolution.

## Shared policy evaluation

`evaluateIdentityPolicy` exposes recognition, privilege, exclusion, coercion, autonomy, and total consent. Aligned, strongly group-identified, nonpluralist communities can appreciate exclusive policies. Pluralists can oppose exclusion of other groups. Public religious preferences are independent of pluralism. Localists can oppose central uniformity even when culturally aligned.

Language exclusion decreases continuously with competence and reaches zero at 0.5 official-language fluency. Keeping another mother tongue does not itself trigger that penalty. Social pluralism attenuates exclusion by up to 45%; it does not erase restrictive institutions.

Government support adjusts at 4% of the remaining gap monthly, based on living conditions and identity-policy consent. State loyalty adjusts more slowly (0.8% monthly), also considering legitimacy and grievance. Their response rates describe model dynamics, not real-world estimates.

Common-language learning, native-language adoption, and household transmission are distinct. Funded local provision and household transmission reduce native replacement pressure. This is an aggregate continuity mechanism: the model does not track individual parents, mixed marriages, or a complete multilingual repertoire.

## Foreign attraction

Migration and frontier accession use the same community policy evaluation, alongside their existing economic, geographic, housing, trade, and security requirements. Foreign appeal considers cultural, linguistic and religious affinity, treatment under the proposed state's policies, and state stability/legitimacy. It assesses advertised policy discounted by credibility, rather than assuming foreign institutions are already operating in the community's home district.

Identity evolution compares only states reached through neighbors and trade contacts. A sufficiently better alternative can gradually gain allegiance among low-loyalty communities. This changes political affiliation, not territorial ownership. Existing organization, force, restoration and accession rules continue to decide sovereignty; arbitrary foreign allegiance does not itself authorize annexation.

Automatic governments approach leadership-derived identity targets in bounded 0.04 steps at their existing six-month policy reviews, respecting explicit cabinet reservations. Community attitudes also influence the existing public character calculation. Agent/human commands share numeric validation.

## Persistence and inspection

Political and implementation fields are validated when present and preserved by packed saves. Only current-schema worlds can be restored. New local implementation ramps from zero. Packed saves preserve political and implementation fields.

Snapshots include population-weighted attitudes and government support. The community dossier displays each large group's response to declared policy, explicitly distinguished from its actual local implementation and material welfare. An approval score is never interpreted as a share expelled or converted.

Regression tests cover independent policy dimensions, preset/custom transitions, numeric boundaries, majority/minority responses, bilingual learning, political inertia, foreign appeal, census merging/conservation, local capacity, saved state, autonomous adjustment, and rendered controls. Browser fixtures use isolated generated worlds and never load user saves.
