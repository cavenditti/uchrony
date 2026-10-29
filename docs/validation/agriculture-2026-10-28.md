# Agricultural response — 28 October 2026

Model 7 connects food shortages to native government policy, farm research and actual public investment. It also lets existing paid productive capital raise farm output, with diminishing returns. This addresses missing responses and an arbitrary nominal construction barrier; it does not guarantee universal food access or empirically calibrate agricultural yields.

## What was wrong

- Creating diplomacy records disabled the old domestic-policy fallback even when no model agent was governing. Hungry states could remain on balanced production and unrelated research indefinitely.
- The fixed 450k farm charge did not scale with local wages, prices or project size. In the inspected month-138 save, all 32 states had less than 450k in their treasury, and none had agricultural technology.
- Paid productive capital improved manufacturing but did not improve food production. The ordinary investment loop therefore could not relieve farm capacity constraints.
- Manual farm purchases changed fertility immediately. They had no construction delay or paid construction labor.

The inspected save had abundance **0.85** and population-weighted food coverage **52.17%**. It was not a maximum-abundance save. Coverage measures household consumption relative to needs, capped within each stratum before aggregation: sufficient global production alone cannot establish that every household can afford or receive food.

## Implemented response

Native cabinets review policy every six months. Below 97% coverage they prioritize agriculture and switch research to agriculture until level six, preserving other research progress. Human governments remain authoritative; a recent accepted model decision defers the native fallback for six months.

Hungry native states review investment quarterly, funding at most one feasible district project per review. The budget is 2% of existing treasury per month compounded over the review interval: **5.88% at a quarterly review**, or **11.42% during a six-month Max step**. No automatic borrowing is added. Actual spending also requires materials, available workers and remaining soil-development capacity.

A complete improvement consumes **5 t timber, 7 t stone and 100 construction person-months per terrain cell**, priced locally. Smaller fractions are funded when resources are limited. Materials and wages are paid and accounted for; fertility rises by up to 0.12 only after six months, capped at 1.2. Recorded cell ownership of the improvement preserves its benefit through district remapping and conquest. Manual and model-issued farm orders use the same mechanism.

Farm output now also receives the multiplier `1 + 0.5 × log(1 + effective productive capital)`. This represents existing farm equipment; new capital still requires the existing paid investment process. Land and labor remain necessary, and marginal equipment gains diminish.

## Matched late-game experiment

Both arms resume the same Gino checkpoint at year 400 and run to year 450 at six-month integration, default abundance 0.85, with identical decision coefficients except the agricultural response switch. Their simulation source fingerprints match. The switch controls the entire new package, so this experiment does not attribute the result separately to policy, equipment or public works.

| Measure | Response disabled | Response enabled |
| --- | ---: | ---: |
| Mean food coverage over 50 years | 92.50% | 93.43% |
| Final food coverage | 84.69% | 91.98% |
| Final population | 280,213 | 296,366 |
| Mean unemployment | 3.56% | 4.31% |
| Funded farm projects | 0 | 209 |
| Final claimed provinces | 98 | 98 |
| Wars begun / peace settlements | 1 / 1 | 2 / 2 |

The population gain relative to the control is 5.76%; the mean food improvement is 0.93 percentage points. The larger final food difference is an endpoint, not the average effect. Unemployment is slightly worse in this comparison, and annual food samples still fall into the low 70s. These results support restoring the missing response, not declaring food distribution or employment solved.

Both arms passed population conservation, annual money/goods/banking checks and compressed-save continuation. The [machine-readable evidence](agriculture-2026-10-28.json) retains annual samples, coefficients, settings, source fingerprints and a checkpoint hash.

Reproduction uses `scripts/evaluate-expansion.ts` with `--profile expansionist --resume <year-400-checkpoint> --months 5400`. Select `--decision dynamic` for the enabled arm. For the control, pass a policy JSON containing the same recorded coefficients and `agriculture: false` through `--policy`.

## Fresh-world checks

| Run | Mean food coverage | Final food coverage | Population change | Funded farm projects |
| --- | ---: | ---: | ---: | ---: |
| Maritime, maximum abundance 1.6, 50 years at Max | 98.79% | 97.54% | +82.53% | 0 |
| Winter, default abundance 0.85, 10 years monthly | 98.65% | 98.40% | +16.64% | 1 |

Both completed population, accounting and save-continuation validation. The abundant world did not need public farm construction; equipment and ordinary production were sufficient to maintain high coverage. This demonstrates that the corrected model has no universal 50% ceiling. It is not a matched estimate of the abundance slider's effect, since these runs use different seeds and integration modes. The monthly run verifies the ordinary integration path rather than equivalence with Max. Their source fingerprint differs from the earlier late-game pair because concurrent urban work was present when they began; each report preserves its own fingerprint.

Reproduce with `--profile expansionist --decision dynamic --seed Maritime --abundance 1.6 --months 600`, or `--profile expansionist --decision dynamic --seed Winter --mode monthly --months 120`.

## Validation boundaries

Focused tests cover native and model control, paid materials and labor, money/goods/GDP conservation, nominal-price scaling, six-month labor units, delayed completion, save restoration, land remapping, conquest, investment limits and diminishing equipment returns. The broader focused suite and production build passed.

The larger month-138 saved-world pair was stopped after excessive runtime without completed results. It is **not qualified** by this report. Chrome loaded an isolated preview, but concurrent browser activity prevented completing its six-month interaction check; browser interaction is not counted as a pass. The user's existing world was not deliberately reloaded or altered by this task.

The soil-works model remains an abstraction: it does not simulate crop choices, irrigation networks or an explicit depreciation schedule for improved soil. High aggregate food coverage can still coexist with poor access in particular communities.
