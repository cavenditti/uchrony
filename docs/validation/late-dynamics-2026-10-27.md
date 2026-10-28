# Late-game dynamics — 27 October 2026

This follow-up separates model defects from parameter calibration. Runs use the full simulation, native cabinets, deterministic seeds, and six-month Max integration unless marked monthly. No external model calls, resource grants, forced wars, or intervention in the user’s saved world are used.

## What was wrong

- **Idle cash and employment:** wholesale cash accumulated beyond operating needs while household demand weakened. Surplus distributions now retain six months of observed operating costs and outstanding construction commitments, then release a bounded monthly share to actual owners.
- **Unbounded food demand:** the previous linear expenditure rule let wealthy households order unlimited quantities of food. Increasing circulation alone reduced unemployment by starving people. Food quantity now saturates at 1.5 subsistence baskets; extra spending shifts to other goods. Purchases remain affordable and rationed against real supply.
- **Broken production chains:** households could empty all intermediate inventories. At the next hiring decision workshops saw zero inputs and hired no industrial workers, perpetuating zero tool and weapons output. A wholesaler can retain up to half its stock against forecast business-input orders. This reserve excludes food.
- **Crowded-out investment:** productive capital projects were considered after public hiring, consumption and housing construction. Funded productive investment now gets an earlier opportunity to purchase materials and hire available artisans. Projects still require positive returns above financing costs, actual workers, cash and materials; capital is not granted. A final timing correction also counts unsatisfied retail forecasts bounded by inventory already held; assessing incomplete cash receipts before retail otherwise penalized firms selling directly to households. Forecast revenue never supplies project funding.
- **Nominal barriers:** recruitment and settlement demanded fixed opening-world currency amounts after decades of deflation. Their labor obligations now follow domestic monthly wages. An automatic settlement pays six months of wages per pioneer; recruitment training also costs six months per recruit. Food, weapons, materials and people remain physical constraints.
- **Military financing and timing:** half the military appropriation is retained for operations instead of being spent entirely on civilian service workers first. Armies procure supplies and replacements before household consumption. Payroll readiness uses current wages rather than a fixed nominal threshold. Small cadres can form before a country can afford a large army.
- **Optional agents accidentally gated native diplomacy:** offensive reviews required a pre-existing diplomacy record, normally created when optional model agents were enabled. Creating such a record also disabled the old native peace and commerce paths. Native offensive offers now initialize their own records; autonomous signatories can negotiate peace, trade and alliances through the normal consent rules. Human-controlled governments are never signed automatically. War exhaustion scales with elapsed months. An intermediate offensive-only trial was stopped after revealing its missing peace path; it is not counted as a completed qualification.
- **Skipped cabinet decisions:** checking `month % 3 === nation.id % 3` permanently skipped two thirds of cabinets at six-month playback. Reviews now check whether the interval crossed their scheduled date. Ambition, domestic mandate, known threats, food, stability, funds and actual force readiness still govern declarations.
- **Frontier search:** occupied sites are excluded before applying the bounded candidate limit; governments no longer retry only the same blocked sites.

## Search design

The experiment is a small offline evolutionary parameter search, not a language-model fine-tune or an online reinforcement-learning agent. Four bounded economic coefficients are mutated: surplus distribution, work disutility, investment cash share and capital adjustment speed. Other policy and physical rules remain fixed during each search. Each candidate runs in a separate process from the same mature checkpoint, with source fingerprints checked for consistency.

Reward: `2 log(population growth) + log(total real output growth) + 0.3 log(claimed territory growth) - 0.8 mean unemployment - 5 max(0, 0.9 - mean food coverage)`. Candidates must keep population above 97% of its starting value, mean food coverage at least 85%, and at least two living states. Wars earn no reward. These are explicit design preferences, not empirically estimated social welfare.

This approach is related to direct policy search with [evolution strategies](https://arxiv.org/abs/1703.03864). It is appropriate for a small deterministic simulator policy without differentiating through its engine. These short training windows cannot establish a globally optimal or historically realistic policy; longer continuations and a separate world seed are required.

## Diagnostic comparisons

The shared recovery checkpoint is Gino at month 2400 with 92,136 people. It predates the final physical-footprint demographic qualification in the earlier expansion report; its population must not be confused with that report’s 95,930-person endpoint.

An economics-only 200→400 year comparison ended at 219,547 people and 2.20% unemployment with the circulation and food-satiation fixes, versus 61,755 people and 10.61% unemployment with the previous economic policy. Neither branch had wars or new expansion in that interval. These runs diagnose economics; they do not qualify the later military and inventory changes.

The first circulation trial without food satiation lost 44% of its population in twenty years despite low measured unemployment. It was rejected. This is why employment alone is an unsafe tuning target.

## Failures found by stress testing

The first complete-policy recovery trial stopped at month 3942 when intelligence tried to create a foreign-expansion report for newly unclaimed territory. That transition now updates the map without inventing a sovereign dossier. A focused regression exercises a previously known province becoming unclaimed.

The first dense Borderlands trial stopped at month 960 because the validator allowed only 150,000 census profiles on a Regional map. The record count was legitimate in a growing, mixed population. The bound now also scales with the checked resident census (one profile budget unit per 64 residents), retaining the absolute one-million-profile ceiling, existing map allowance, per-holder limits, uniqueness, and exact age/cohort reconciliation. A dense 165,000-profile fixture passes while malformed totals and an oversized sparse import remain rejected. Generated negative-zero opinions are also normalized so JSON restoration preserves exact state.

The corrected dense run reached year 100 and saved its 22.4-million-person world, but the final continuation comparison exhausted the test process’s 4 GiB heap while retaining extra census copies. The evaluator now compares plain world records directly. Restoring the preserved save and running through year 101 with a 6 GiB test heap passed accounting and exact compressed-save continuation. This qualifies the preserved world; it does not establish a browser memory bound.

Both original failed records are retained. Repeated runs with these corrections are reported separately; neither failed run is described as a completed 400- or 100-year qualification.

## Measurement and validation

`measurementVersion: 2` fixes an experiment-reporting error: national-account real output is already monthly, so the old evaluator divided it by the six-month interval twice. Comparisons in this report use the corrected measure. Previous report values should not be mixed without conversion.

Every completed experiment checks population conservation each interval, money/goods/bank consistency and world validity annually, and an exact semantic continuation after compressed save/restore. Ownership-transfer counts in older evaluator output named `conquests` include peaceful transfers; they are not a count of military victories.

## Selected weights

The initial search evaluated seven candidates on the same 200→220-year checkpoint. All passed the stated welfare guards. Candidate 5 scored 1.04858 versus 0.87329 for the starting policy. It ended with 107,217 people (+16.37%), total real output 2.157 times the starting value, 4.80% mean unemployment, 92.10% mean food coverage, and two additional claimed provinces. These training results preceded the final business-inventory and native-diplomacy corrections, so longer tests below qualify the complete model separately.

| Coefficient | Starting policy | Selected `dynamic` policy |
|---|---:|---:|
| Monthly excess merchant cash release | 0.025 | 0.02564 |
| Work disutility | 0.5 | 0.40758 |
| Firm cash share available for investment | 0.35 | 0.23396 |
| Monthly capital adjustment | 0.04 | 0.03502 |

This is a selected candidate from a small search, not an established optimum. Military readiness (0.01), war threshold (0.8), and food satiation (1.5) were held fixed, so the search did not learn a preference for more wars.

## Long-run outcomes

These runs include native war/peace and the selected economic policy. Except for the recovered dense checkpoint and the final 400→450 continuation below, they precede the last inventory-backed retail return estimate. Source fingerprints and stage labels are retained in the companion JSON.

| World and interval | Population at end | Mean unemployment | Unemployment at end | Mean food coverage | Wars / peace agreements | Claimed provinces at end |
|---|---:|---:|---:|---:|---:|---:|
| Gino, old policy, years 200–400 | 61,755 | 14.38% | 10.61% | 85.00% | 0 / 0 | 26 |
| Gino, revised rules, years 200–400 | 233,872 | 4.56% | 6.20% | 90.91% | 2 / 2 | 72 |
| Gino, revised rules, years 70–300 | 190,769 | 3.02% | 9.42% | 90.12% | 9 / 9 | 105 |
| Maritime, revised rules, years 200–250 | 186,347 | 3.52% | 7.55% | 90.01% | 0 / 0 | 92 |
| Winter, ordinary monthly steps, years 0–10 | 32,683 | 0.01% | 0.00% | 95.39% | 1 / 1 | 74 |

The dense, already settled Borderlands world reached year 100 with **22,402,567 people, 1.91% unemployment, 31 war starts, 30 peace agreements and 73 province ownership transfers**. The latter include peaceful transfers and must not be described as 73 military conquests. Eight states survived; one war remained active. Its final snapshot was preserved despite the test-memory failure described above. The separate year-100→101 recovery ended with 22,676,740 people, 2.00% unemployment and no active wars, and passed all continuation checks. Its mean unemployment applies only to that recovery year, so it is not substituted for the unavailable full-century average.

The matched year-70→300 control without the native diplomacy repair remained warless, ended with 224,789 people and 114 claims, and had 2.97% mean unemployment. The repaired branch had nine wars and armistices, 190,769 people and 105 claims. Restoring conflict therefore has real economic costs; the test does not assume that maximizing wars improves welfare.

## Final 400→450-year paired continuation

Both branches start from the same qualified year-400 snapshot and use the selected coefficients. Their only simulation difference is the bounded retail-return estimate for early investment; each passes conservation, annual accounting, and compressed-save continuation. The latest model reaches year 450 with continuing settlements, trade, another war and another armistice.

| Result | Before retail-return correction | Latest model |
|---|---:|---:|
| End population | 267,796 | 280,213 |
| Mean unemployment | 3.03% | 3.56% |
| End unemployment | 1.21% | 7.06% |
| Mean food coverage | 91.33% | 92.50% |
| Claimed provinces | 96 | 98 |
| Wars / peace agreements | 1 / 1 | 1 / 1 |

The final correction removes a timing bias demonstrated by the regression fixture; it is **not** an unemployment improvement in this paired world. Population and mean food coverage improve, while mean and endpoint unemployment are worse and endpoint real output per person is lower (0.0007567 versus 0.0008717). A single stochastic trajectory cannot establish the welfare effect. It is retained for the coherent investment decision and qualified as a trade-off, rather than silently presenting the better unemployment endpoint from its control as the final result.

## Interpretation and limits

The complete 200→400 recovery reduces mean unemployment by about 68% relative to the previous policy while sustaining population, trade and renewed settlement. The starting 92,136 people grow to 233,872 rather than declining to 61,755. Economic inactivity was substantially a broken-circulation and sequencing problem, compounded by costs fixed in obsolete nominal units.

The model still has late labor and food cycles. Gino’s year-300 endpoint has 9.42% unemployment and 77.29% food coverage; the recovery branch’s year-400 food coverage is 78.51% despite a 90.91% mean. These are unresolved scarcity/distribution dynamics, not evidence that every endpoint is prosperous. Some worlds remain peaceful: Maritime produced no wars in its additional fifty years. A model that requires a war quota would conceal this variation.

The policy search is deliberately small and trained on one checkpoint. Longer runs and a separate seed provide useful qualification, but cannot establish historical realism or an optimal economic policy. A larger future search should train across several mature worlds, score household food/material welfare and sustained employment, and validate on held-out seeds. The physical and consent rules should remain outside the learnable policy.

## Verification and reproduction

Focused economic, military, diplomatic-consent, demographic-validation and save-continuation regressions were exercised. Tests exposed fixture mismatches and a generated negative-zero save mismatch; these were corrected and the affected suites passed. The final investment change passes its inventory-backed return regression, financing-cost tests, and monthly/Max integration checks; the published equations also render correctly. Production build passes. The Chrome isolated worker fixture generated a world and advanced from month 0 to 6; the user’s live save was not replaced. A later main-page check could not finish because macOS locked.

Run the evaluator with `--profile expansionist --decision dynamic`; its default `legacy` decision profile intentionally preserves prior experiment commands. `--resume` accepts a saved checkpoint and `--months` is the absolute ending month. For example:

```sh
npm run evaluate:expansion -- --profile expansionist --decision dynamic --seed Gino --months 3600 --output /tmp/gino-300.json --snapshot /tmp/gino-300-world.json
npm run tune:decisions -- --resume /tmp/gino-300-world.json --months 3840 --rounds 2 --offspring 3 --output /tmp/decision-search
```

Every run records its simulator-source fingerprint and coefficients. The search checks that all candidates used the same source fingerprint. Comparison summaries, failed runs, annual measurements, and the complete search results are in [the companion data](late-dynamics-2026-10-27.json). Large local checkpoints and original detailed logs remain under `/tmp/uchrony-dynamics-*`; they are not repository fixtures.
