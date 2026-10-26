# Deferred work

## Historical macroeconomic mechanics

Status: explicitly deferred on 25 October 2026 while the [adaptive-world plan](plans/ADAPTIVE_WORLD_PLAN.md) is reviewed and implemented. Preserve the failed US 1960–1985 experiment as a baseline. Do not tune it as part of the spatial refactor.

### Current evidence

The benchmark at commit `07fe925` fits a quarterly aggregate IS/Phillips/search model to 1960–1969 and evaluates 1970–1985 from a common 1969Q4 initial state. It is separate from the spatial world engine. The recorded-policy/energy arm has growth, inflation and unemployment RMSE of 9.262, 24.306 and 10.855 percentage points. The persistence/drift baseline scores 4.603, 3.141 and 3.684. The modern policy-rule arm improves unemployment fit but does not beat the baseline on all three targets.

The recorded-rate arm develops excessive deflation and unemployment. Its externally replayed nominal policy path cannot respond to the simulation's divergent expectations. This is an observed model failure, not a sufficient diagnosis of every underlying cause. The world model also retains significant food, employment and price problems in its bounded version-5 run. Version-4 200-year results do not qualify version 5.

Evidence and implementation:

- [US benchmark report](validation/us-1960-1985-v1.json)
- [Frozen data and experiment boundaries](../data/history/us-1960-1985/README.md)
- [Labor and monetary qualification](validation/labor-monetary-v5.json)
- [Validation record](VALIDATION.md)
- `src/sim/historical-macro.ts`, `src/sim/labor-market.ts`, `src/sim/monetary-policy.ts`
- `scripts/historical-data.ts`, `scripts/evaluate-us-history.ts`

### Diagnosis to resume later

1. Audit quarterly/annual rate conventions, inflation expectations, policy lags, GDP annual-rate levels, training trends and initial equilibrium conditions. Separate coding/unit errors from inappropriate economic relationships.
2. Trace the deflation/unemployment feedback under recorded rates. Examine expectations anchoring, wage and price adjustment, interest-rate sensitivity and credit transmission. Replacing the recorded path with an accommodating policy rule is an experiment, not proof that the historical replay is repaired.
3. Distinguish conditional forecasts from causal shock identification. Recorded oil prices and policy rates include endogenous responses; the model cannot treat their entire historical paths as independently identified shocks.
4. Add or test missing transmission mechanisms in controlled steps: energy as an intermediate input and substitution, sectoral exposure, productivity and labor-force participation changes, fiscal/external demand, monetary/exchange-rate regimes, wage-price controls and historically plausible expectations. Their relevance must be demonstrated, not assumed from the failed score alone.
5. Compare the aggregate benchmark with the spatial engine's actual labor, credit and national accounts. Do not label aggregate-model success as validation of firms, local markets or GDP reconciliation.
6. Diagnose spatial version-5 food access, unemployment and inflation separately from the US experiment. Do not correct either by imposing target populations, price ceilings or unemployment floors.

### Evaluation rules

Retain the original frozen dataset, source hashes, failed report and predeclared scorecard. Keep simulation future outcomes out of model inputs. Use controlled ablations, paired experiments, sensitivity analysis and a simple baseline before adding complexity.

The 1970–1985 period has now informed diagnosis and cannot be described as an untouched holdout for subsequent model design. Before retuning, declare a separate validation strategy and an additional genuinely unused period or scenario. Distinguish revised data from real-time information available to historical agents.

Run all new diagnostics with LLM assistance disabled and verify zero provider calls. First improve mechanisms and demonstrate generalization; then repeat long-run native-world tests and update the mathematical guide. Record failures as well as improvements.

### Completion criteria

A reviewed diagnosis links each material failure to a demonstrated mechanism or implementation defect. A replacement model preserves financial/physical accounting, outperforms declared baselines on new evaluation evidence, responds plausibly to isolated shocks, and survives fresh long-run tests without outcome caps. Report remaining limitations explicitly. Historical fit, causal identification, numerical convergence and accounting consistency remain separate claims.

## Cross-runtime numerical reproducibility

The phase-7 tests reproduce different floating-point results in Node 26.11.1 (V8 14.6) and Chromium 151 for `Math.log`, `Math.exp`, `Math.pow` and `Math.hypot`. Identical starting worlds diverge in their exact hashes after one native step without any camera or inspection. Transaction counters can also differ because numerical residuals create different tiny transfers. This is separate from the deferred US model diagnosis.

Pin runtime/version for exact replay and paired experiments. If bit-identical trajectories across engines or upgrades become a requirement, evaluate portable deterministic transcendental functions and record numeric-runtime provenance before changing the model. Do not hide differences by rounding accounts or weakening observer comparisons.
