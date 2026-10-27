# Frontier growth and social influence — 27 October 2026

The previous mechanics passed controlled accession and charter tests but did not reliably become reachable in normal play. Reading the latest Gino autosave found a population of zero at month 3013. Earlier history showed prolonged food shortages and demographic decline after each state founded its first additional settlement. No autosave was modified.

The correction evaluates hiring against executable production, allows farmers and extractive workers to use their actual land and resources independently of workshop premises, and stops unavailable manufactured goods from inflating the subsistence wage basket. Firms distribute idle cash above an operating buffer to their owners. Automatic frontier expeditions now move 200 actual residents, retain 600 at home, and pay for their food, materials and construction. Manual 600-person founding remains available.

New frontier worlds include a few independent market settlements. City-state wealth is compared against other independent communities, excluding the candidate itself. Five years of accumulated financial prosperity can support a charter when food coverage is at least 85% and unrest is below 40. The initial treasury comes from real household contributions, limited to 10% of savings. No people, money or army are created at chartering.

## Ordinary engine runs

All runs below use a newly generated regional frontier with seed `Gino`, eight initial states and normal starting resources. No funds, populations, policies or eligibility conditions were injected.

| Run | Elapsed simulation time | Claimed provinces | States | Population |
| --- | ---: | ---: | ---: | ---: |
| Initial ownership | 0 | 8 | 8 | — |
| Monthly playback | 120 months | 18 | 8 | 30,334 |
| Six-month aggregate playback | 318 months | 20 | 9 | 28,527 |

At month 318, **Free City of Soldale Ford** emerged with 1,056 residents and a treasury of 1.0819469581206165, entirely matched by ledger transfers. Saving, restoring and advancing another six-month interval produced identical serialized worlds. Population validation and money, goods and banking audits passed before and after continuation. Monthly playback also passed these audits at month 120; world food coverage was 91.4%.

These are observed outcomes for a reproducible seed, not promises that every world will expand or charter a city on the same date. The two playback modes use different integration intervals and do not produce identical histories.

## Social influence

Trade contacts build from actual goods exchanged per resident, using monthly volume even during aggregate playback. They persist across saves and decay after trade stops. Contacts increase cultural adoption and unrelated secondary-language learning while retaining native languages. Seeded probabilistic adoption lets small communities change without rounding every adjustment to zero.

Mobilization, requisition, land battles and naval combat generate separate fear and opposition among participants and nearby witnesses. Fear increases defensive urgency and deterrence. Opposition lowers opinion, increases grievances, and reduces voluntary accession and cultural receptiveness. Fear decays faster than opposition; distant unobserving states do not receive local battlefield knowledge.

## Reproduction

The focused suite covers influence, identity geography, frontier politics and founding, labor, firms, banking, military saves, sovereignty and both playback modes. `tests/frontier-growth.test.ts` runs the full engine without fixture intervention until a new state emerges or 40 years elapse, then checks continued expansion, viable population and accounting consistency. The production build is checked separately.

Existing viable saves retain their people and identities and use the new mechanics on subsequent ticks. New cultural homelands and opening market settlements apply to newly generated worlds. A save whose population has already reached zero requires a new world or an earlier viable save; the simulation does not fabricate replacement residents.
