# Frontier competition, demographic survival and durable ports — 27 October 2026

The `expansionist` profile is now the default. It gives the strongest useful frontier expansion among four tested parameter bundles without eliminating smaller states in the sampled worlds. This is a bounded synthetic-model selection, not a historical calibration or a global optimum. Saving, inspecting or rendering a world does not select a different profile.

## Matched 50-year comparison

All four runs use seed `Gino`, a regional frontier map, eight starting states, 28,630 people and eight claimed provinces out of 182. They receive no extra money, goods, settlers or armies. Max playback advances approximate six-month periods; the selected profile's year-50 observation comes from its 200-year run. Results below are endpoint observations, not time averages.

  | Profile      | Population | Claimed provinces | Living states | Food needs met | Unemployment | Largest share of claimed land |
| ------------ | ---------: | ----------------: | ------------: | -------------: | -----------: | ----------------------------: |
| baseline     |     24,993 |                22 |             9 |          89.1% |         6.6% |                         22.7% |
| economic     |     38,127 |                23 |             9 |          86.1% |         1.9% |                         21.7% |
| competitive  |     38,033 |                28 |             8 |          92.0% |         0.5% |                         17.9% |
| expansionist |     38,764 |                39 |             9 |          91.8% |         0.0% |                         20.5% |

The selected run records 23 funded pioneer expeditions, seven voluntary accessions and one chartered city-state by year 50. The charter is funded by the independent settlement's own savings. Nine states coexist, with effective territorial diversity of 7.14 states (inverse concentration); the largest controls 20.5% of claimed land. The world is not fully colonized: 39 of 182 provinces are claimed.

The economic, competitive and expansionist bundles include the corrected small-enterprise and demographic mechanisms. The baseline retains the old thresholds and physical-urban fertility input. Consequently this comparison measures complete behavior bundles, not the isolated causal effect of one coefficient.

## What was wrong, and what changed

1. **Incentives could not overcome impossible entry conditions.** Pioneer groups had 200 residents, but a settlement needed more than 500 before it could start a business. Stronger expansion alone produced more weak camps. Enterprise entry now begins above 60 people in the selected profile, using real owner equity. Startup requirements scale with settlement size, while full towns retain their operating-capital floor.
2. **Cheap business creation everywhere was also wrong.** An intermediate trial lowered the equity floor for established towns as well as camps. It drained household savings into underfunded competitors and suppressed city-state charters. The final size-dependent floor avoids that particular incentive. Lower charter costs alone did not fix the issue.
3. **Governments spent without preparing for opportunity or responding to peer growth.** Dated reports of richer or expanding peers now affect investment priorities and expedition savings. Economic frontier value is weighted more strongly, and quarterly reviews examine several feasible sites. All resulting expansion still needs actual people, overland access, treasury and supplies; foreign private accounts are not visible to decision makers.
4. **Compact housing was mistaken for metropolitan family economics.** Farming villages often had a physical urban share of 100%. That removed rural family incentives and imposed the full urban opportunity penalty even on settlements with only a few thousand residents. Fertility now uses the population of connected occupied footprints, gradually reaching full metropolitan exposure at 50,000 people. This does not create replacement births or target a world population. City labels, names and catalogue membership cannot change the result.
5. **Current trade was mistaken for the lifetime of a port.** The map previously derived port markers solely from this month's routes. Saved activity memory now keeps them fully visible for three quiet years, then fades them over two more. Remembering a port adds no shipments, ships or capacity.

## Selected levers

| Lever                                                |                Baseline |                                 Selected |
| ---------------------------------------------------- | ----------------------: | ---------------------------------------: |
| Economic frontier weight                             |                       1 |                                        3 |
| Reported peer-pressure weight                        |                       0 |                                      1.2 |
| Pioneers / residents retained at source              |               200 / 600 |                                120 / 300 |
| Food retained at source                              |              1.5 months |                               0.5 months |
| Normal review / candidate sites / overland range     | 6 months / 1 / 24 cells |                  3 months / 8 / 40 cells |
| Minimum food coverage / stability for founding       |                85% / 40 |                                 78% / 35 |
| Maximum expedition-saving share of intended spending |                       0 |                   25%, scaled by urgency |
| Development-priority coefficient                     |                       0 | 0.3, scaled by urgency and peer pressure |
| Accession contact / sustained mandate                |      10 years / 3 years |                      4 years / 18 months |
| Prosperity before a city-state charter               |                 5 years |                                  3 years |
| Enterprise population threshold                      |                    >500 |                                      >60 |

A selected expedition costs 24 treasury, 19.2 food, 8.4 timber, 4.2 stone and 1.2 tools. Manual founding retains its larger 600-person requirements. City-state eligibility still needs at least 500 urban residents, a majority of its province's people, food coverage of 85%, unrest below 40, cash per person above both 0.0025 and twice other independent communities, and a charter treasury funded from at most 10% of residents' savings. Culture, language, trade ties and resentment still determine attraction; richer rivals do not automatically annex land.

## Longer runs and other worlds

The final physical-footprint implementation reaches **95,930 people after 200 years**, from 28,630, with 9 living states, 39 claimed provinces and 757.3 tonnes of monthly trade. Endpoint food coverage is 78.1%. A prior matched Gino run with the selected economic settings but the old fertility input ended at **15,108** people. That ablation predates the later port-memory and extinction changes; its complete parameter set and source fingerprint are retained in the data rather than presented as a perfectly isolated final-source experiment.

| Seed     | Start and stepping | Years |             Population |    Claims | Living states | Endpoint food |
| -------- | ------------------ | ----: | ---------------------: | --------: | ------------: | ------------: |
| Maritime | frontier, coarse   |    50 |        28,705 → 33,009 |    8 → 35 |             8 |         78.1% |
| Winter   | frontier, coarse   |    50 |        28,587 → 36,737 |    8 → 50 |             8 |         89.8% |
| Gino     | frontier, monthly  |    10 |        28,630 → 32,557 |    8 → 34 |             9 |         83.7% |
| Gino     | settled, coarse    |    10 | 9,783,002 → 10,700,628 | 182 → 182 |             8 |         90.5% |

`Maritime` and `Winter` are exact seed strings, distinct from earlier exploratory seeds `Maritime republics` and `Long winter`. The monthly Gino run reaches 34 claims and 9 living states after ten years, confirming expansion outside Max playback. Coarse and monthly simulation are different approximations and need not have identical trajectories.

**Remaining limits matter.** In the final 200-year Gino run, unemployment ends at 23.2% and mean state stability at 38.6; territorial expansion plateaus well before the end. Cash, departure supplies, geography and mature labor demand remain binding. None of these sampled runs produces a war, so they do not qualify conquest balance or the military escalation tuning. Not every seed produces a new city-state. These results support the selected frontier default and remove the identified early demographic trap; they do not establish indefinite sustainability, full-map colonization or a complete historical cycle. Job creation, capital demand and later military competition are the next calibration targets.

## Zero population and lifecycle behavior

The inspected autosave at month 1,039 contained 10,162 people; authoritative and displayed census totals agreed. Later, Chrome showed the running world at month 31,099 with genuinely zero people. The old overview still listed eight active states, despite the map's zero-state count. The updated overview correctly shows zero active states.

A read-only restoration of that empty save followed by lifecycle cleanup released all 19 remaining territorial claims and marked the eight states extinct, with identical money balances and physical goods. World, money, goods and banking validation passed. The source save was not rewritten by this check. Population fixes cannot resurrect an already empty history.

States retire only after their last civilian **and military** residents are gone. Active governments, claims and diplomacy end, while stable historical IDs, buildings and financial claims remain. Observer mode cannot revive their AI. Empty cities become historical records; a city falling below the 500-person naming threshold keeps its remaining census instead of displaying a false zero.

## Verification and reproduction

- All **37 focused tests** passed: reported peer competition, funded pioneers and enterprise entry, accession, city-state emergence, birth-model exposure, city/state extinction, harbor persistence, routes and river-road save behavior.
- All **33 physical settlement tests** passed, including city-label independence, morphology, influence, housing and lifecycle checks (four lifecycle tests overlap the group above).
- The broader economy, labor, fast-forward, diplomacy, intelligence, authority, influence, organic growth and view suite passed **86 of 87** checks. The failing geometry fingerprint in `tests/map-memory.test.ts` was reproduced unchanged in an isolated checkout of `HEAD`; it is a pre-existing fixture mismatch. It was not silently regenerated.
- Production TypeScript checking and build passed. The existing bundle-size advisory remains.
- Every reported run checks exact global births/deaths conservation, annually audits world validity, money, physical goods and banks, and compares an additional step against a restored compressed save. A discovered road-point alias was fixed: road geometry now copies only coordinates rather than retaining mutable residential census objects.
- Chrome confirmed the zero-population and zero-active-state overview. The separate `/tests/browser/quadtree.html` fixture advanced from month 0 to month 6, returned its enabled advance control with no alert, and displayed the updated map in Chrome. That fixture makes no saves or model calls; its test tab was closed afterward. No saved world was replaced for testing.

```sh
npm run evaluate:expansion -- --profile baseline --seed Gino --months 600 --output /tmp/baseline.json
npm run evaluate:expansion -- --profile expansionist --seed Gino --months 2400 --output /tmp/long-run.json
npm run evaluate:expansion -- --profile expansionist --seed Maritime --months 600 --output /tmp/maritime.json
npm run evaluate:expansion -- --profile expansionist --seed Gino --mode monthly --months 120 --output /tmp/monthly.json
npm run evaluate:expansion -- --profile expansionist --seed Gino --start settled --months 120 --output /tmp/settled.json
```

[Machine-readable runs, parameters, annual observations and source fingerprints](expansion-tuning-2026-10-27.json) retain exact seed spelling and experiment scope. Source fingerprints include formatting; elapsed times were collected under concurrent test workloads and are not throughput benchmarks. No model requests were made by these experiments.
