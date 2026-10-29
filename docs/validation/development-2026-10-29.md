# Development, reserves and negotiated war — validation

Completed 29 October 2026. Changes are local and uncommitted.

## What changed

- Cabinets keep five-year objectives targeting 10% more real output per resident. Research, infrastructure and enterprise investment consume paid labor and actual materials. Food shortages redirect current activity without casually discarding the objective.
- States can subscribe equity in farm equipment, tool workshops and textile workshops at local prices. Existing owners retain their book claim; public dividends require actual enterprise cash. Small fractional projects replace the fixed 900k industry barrier.
- Productive strategic-material firms target at least six months of expected sales, subject to the existing larger coarse-period buffer. Up to 25% profit-tax relief rewards new productive output retained within an unfilled reserve. Sold output and old inventories do not earn reserve relief. Incentives pause below 97% food coverage.
- Taxes remain in crowns. Farm and productive-enterprise projects can acquire surplus materials from private local merchants on supplier credit. Protected consumption/input buffers remain unavailable. The supplier receives an asset and the state incurs an equal liability; neither receives newly minted cash. Repayment transfers treasury funds. Other procurement paths retain their existing rules.
- Bank borrowing is limited by current revenues, debt servicing and bank capital. Supplier credit has a separate twelve-month revenue limit, counts in public debt and reduces borrowing headroom. Bank principal and supplier principal amortize at different, explicit declining-balance rates.
- Military control leaves legal ownership unchanged. Pillage transfers existing wealth and creates damage and opposition. Annexation requires sustained control and a separate paid decision. Peace can combine compensation and territorial concessions; both governments must consent.
- The overview distinguishes value added from fiscal balance, shows small balances to three decimals in thousands, and separates cash, supplier debt, investment and dividends.

## Matched long-run experiment

Seed `Reserve trade`, eight starting governments, regional frontier generation, expansionist profile, 1,800 months in six-month steps. The control uses the dynamic decision policy with development disabled and agriculture retained. Frozen source copies prevent edits in the shared checkout from changing a running experiment. The revised trial differs from the control source only in the food gating of productive investment and reserve incentives, both dependent on development. Both runs audit population conservation every step and financial/goods/bank invariants annually, then verify save/restore continuation.

| Measure | Control | Development trial |
|---|---:|---:|
| Final population | 115,504 | 141,698 |
| Food coverage, mean over final decade | 93.91% | 98.95% |
| Unemployment, mean over final decade | 4.10% | 3.60% |
| Final unemployment | 3.44% | 5.23% |
| Final food coverage | 94.91% | 99.81% |
| Real output/person/month, final-decade mean, base-price crowns | 0.691 | 0.920 |
| Public fiscal balance/month, final-decade mean, k crowns | 0.015 | 0.075 |
| Final treasury, k crowns | 224.260 | 747.095 |
| Final public debt, k crowns | 7.671 | 0.000 |
| States with positive final monthly balance | 1 | 1 |
| Funded productive projects | 0 | 1620 |
| War starts | 25 | 35 |

The final-decade output difference is 33.2%. This measures the combined development package; it does not isolate tax relief or establish a universally optimal parameter set. Employment gains are not monotonic: unemployment in the development trial rises in the closing years, ending at 5.23% versus 3.44% in the control. This remains a calibration concern; the package is not a permanent full-employment guarantee. Final-point values and every annual sample remain in the raw records. Substantial starting cash can finance deficits for decades, so zero debt alone is not evidence of zero spending.

An earlier trial was rejected because unrestricted industrial investment and reserve production competed with food. Its samples and rejection reason are retained in [the first-trial record](development-reserves-first-trial.json).

## Final-source boundary

The full 150-year experiment predates the final short-term food-priority override, exclusion of sold output from reserve tax relief, native peace bookkeeping correction, and the scaled battle-victory threshold. These changes have focused tests and a separate final-source monthly continuation from month 960 to 984. That continuation passed population, annual financial/goods/bank audits and deterministic save/restore. It is not a second 150-year calibration and should not be presented as one.

The final source also completed a fresh six-year monthly run. Mean food coverage was 98.12%, mean unemployment was 0.25%, and population/accounting/save-continuation checks passed. This directly checks the initial food-priority problem under the final rules. The final mature-world continuation ended with 95.93% food coverage, 0.04% unemployment and a combined monthly public balance of 0.300k; 3 of eight states were positive. Mode changes affect the trajectory, so these values are not a matched comparison with the coarse experiment.

The scaled military threshold followed a concrete long-run finding: at month 960, the seven surviving armies contained 4–62 troops and none could cross the old 200-troop victory cutoff. Victory now uses the occupation requirement of at least 20 effective troops or 0.1% of province population, adjusted by morale and supply, while retaining combat superiority checks. A real-battle regression verifies that an 80-person army can establish control without automatic annexation. The long-run conquest counts precede this correction.

- Control simulation source SHA-256: `9cb80b77b09f3319f3cf0009d64d8cfdb24f66cc794037d6060e6d2b73b2aff9`.
- Development trial simulation source SHA-256: `ab3090ae30d946ba24cde262237c3220edd0e7bcdfb64c3cddbc62966a3c2d1d`.
- Final monthly continuation simulation source SHA-256: `218fac319b9074fc5e8eeeea0cfc02a40e3385a09d45ca1611d76cd9b97c3a9d`.
- Current shared-checkout files can include unrelated concurrent edits; these hashes identify the tested simulation snapshots, not a Git commit.

## Focused and browser checks

- 43 focused development, agriculture, banking/enterprise/GDP checks passed, including saved creditor claims, district remapping, conservative cash/goods accounting, bounded borrowing, material shortages, real dividends, occupation, pillage, signed peace and atomic settlement rollback.
- 28 development/military-save checks passed after the scaled control correction; 17 overlap the group above.
- 17 government/model-policy checks passed. Earlier targeted diplomatic access/friction and fast-forward checks also passed.
- Production build and explicit TypeScript checks passed. A save-continuation check exposed optional `capitalOwner: undefined` fields in housing subdivision/survey; absent owners now stay absent, preserving deterministic restored records.
- Actual components were exercised in an isolated **Google Chrome** session. Pillage conserved transfers, explicit annexation worked, and a signed peace transferred 10k and one province after preparation. Desktop and 390px phone layouts were inspected. The economy fixture verified a 0.003k positive balance, 0.003k supplier claim and 0.004k total debt remain visible. No user's live save was changed. See [browser evidence](development-peace-browser-2026-10-28.json).

## Economic recap

The main mistake was treating an economy's ability to build as a fixed nominal cash threshold. Prices and wages evolved, but the 900k entry price did not, leaving productive capacity inaccessible. Paid research was also too weak to sustain capability growth. Local construction costs, fractional projects and persistent funded programs make investment feasible without creating resources.

The second mistake was conflating economic value, fiscal revenue and liquidity. GDP is not a government surplus; inventory is not crowns; a supplier's unpaid claim is not spendable money. Explicit stocks, payments and liabilities let an economy hold useful surplus and still experience limited market access.

The useful tuning controls are investment scale, research conversion, debt-service limits, working-stock targets and conditional tax relief. The first rejected trial showed why they need feedback: strategic stockpiling can divert scarce labor from food. Food-first priorities and finite inventory targets constrain that competition. Growth and fiscal surpluses remain outcomes to measure, not rewards granted for adopting a plan.

## Evidence

- [Control, 150 years](development-reserves-control-150-years.json)
- [Development, 150 years](development-reserves-150-years.json)
- [Final-source monthly continuation](development-reserves-final-monthly.json)
- [Final-source six-year startup](development-reserves-startup-monthly.json)
- [Earlier monthly continuation](development-reserves-current-monthly.json)
- [Compact comparison](development-2026-10-29.json)

Reproduction uses `scripts/evaluate-expansion.ts --profile expansionist --seed 'Reserve trade' --months 1800 --decision dynamic`; the control replaces `--decision dynamic` with `--policy control-policy.json` containing the dynamic policy with `development: false`. Frozen source snapshots and exact control policy are retained under `.uchrony/validation/`. Final monthly replay uses `--mode monthly --resume continuation-control-start.json --months 984` in the final frozen snapshot.
