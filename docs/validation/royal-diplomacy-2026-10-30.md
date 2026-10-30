# Royal diplomacy and capitulation validation — 2026-10-30

## Scope

Royal marriages, peaceful and imposed personal unions, inherited crown claims, subject tribute and foreign-policy authority, and four victor-controlled capitulation outcomes. Complete annexation, final signed cession and merger share one public-estate handover.

The implementation and exact rules are described in [Dynasties, influence and capitulation](../DYNASTIES_AND_CAPITULATION.md).

## Completed checks

- Production builds pass both in the shared workspace and in an isolated copy of the repository baseline with this feature applied. Vite reports its existing large-chunk warning.
- All 20 feature tests also pass in the shared workspace alongside the concurrent changes.
- 64 focused regression checks pass across `dynastic-capitulation`, `settlement-conservation`, `development-war`, `statecraft-affordances`, `institution-lifecycle` and `simulation-refactor`. Twenty tests directly exercise the new mechanics.
- Two independent settled/frontier replays agree at all eight checkpoints. Each checkpoint passes world validation; each simulated checkpoint also passes money, goods and banking audits. Persisted crown records require the updated checkpoint hashes.
- Browser interaction completes a signed marriage, one-year maturation, a signed personal union and an imposed subject settlement without a defeated-state signature. A final check against the shared workspace also applies annexation directly and verifies desktop and 390px mobile layouts with the bundled fonts.
- Accessibility scan: zero violations, zero incomplete results, 19 passes. The design-skill source detector reports no findings in the touched interface components.
- Formatting was applied; the final touched-file formatting check and `git diff --check` pass.
- A deterministic microbenchmark with 48 crowns and 96 marriage ties measured 1,000 monthly dynasty updates after 100 warm-ups: mean 0.0305 ms, p95 0.0390 ms. This measures dynasty bookkeeping, not the entire simulation tick.

## Refinement review

1. Domain boundaries: public-estate succession, dependencies, crowns, capitulation and signed royal diplomacy have separate modules. Existing commands, AI offers and the interface call the same validation and mutation paths.
2. Function review: settlement eligibility is rechecked at execution, settlement trials isolate mutable accounts and claims, and ending hostilities is separated from the settlement transaction. Withdrawal issues physical movement orders.
3. Performance: monthly work is bounded by the crown and relationship registries; marriage ties are capped at four per crown. Expensive population/account isolation occurs only when applying a settlement. The benchmark above checks the added recurring work at the maximum initial state count.
4. Documentation: domain thresholds, consent, cash and debt ownership, physical-resource treatment and the compact dynasty model's limitations are documented. Tests cover conservation and failure atomicity rather than only displayed labels.

## Shared-workspace limitations

Other work is actively changing cities, borders, military movement and trade in the same checkout. Those edits are preserved. An intermediate shared build was blocked by a concurrent military edit; the final shared build and feature tests pass. The isolated regression run distinguishes this feature from those unrelated changes.

The complete `npm test` attempt finished reporting 719 results: 705 passes, 13 failures and one cancellation. Eleven reported failures reproduce on untouched HEAD: residential construction, competitive frontier growth accounting, industrial investment, map geometry/scale, a mathematics-guide rendering assertion, residential-display records and the 480-month natural frontier-growth scenario. The local autosave endpoint test passes when run with permission to bind its loopback server. The changed checkpoint test passes after the independently validated fixture update.

The remaining `simulation.test.ts` worker, containing the 1,200-month scenario, was still computing after approximately 30 minutes and was stopped. Its result is **incomplete**, not a pass. A one-second process sample showed active property access and numerical work rather than an idle process. The full suite is therefore not green; the focused and shared-workspace results above are the completed validation evidence for this change.

## Follow-up: cabinet awareness

Both model deliberation modes now receive constitutional authority, royal eligibility and all four capitulation comparisons, with blockers and upfront costs from the execution rules. Foreign financial data stays within dated intelligence reports. The prompts explain contingent inheritance, junior-crown concessions, funded tribute, inherited debt and unilateral capitulation. The referee receives dynasty and dependency evidence without granting it a way to bypass signatures or occupation requirements.

Active model governments retain royal consent. Material changes request a strategic review; unchanged situations do not repeatedly wake the cabinet. Background plans retain the exact capitulation outcomes offered when deliberation began: a subsequently invalid quote requests replanning, while an outcome never offered remains an authority violation. Native settlement advice accounts for fiscal reserves and character.

- All 33 tests in `cabinet-sovereignty.test.ts` and `dynastic-capitulation.test.ts` pass after refinement, including 13 new cabinet cases. Model-shaped plans exercise signed marriage, signed voluntary union and each imposed settlement.
- All 35 adjacent tests in `cabinet-statecraft.test.ts`, `intelligence.test.ts` and `narrative.test.ts` pass. The combined earlier run reported 67 passes before the additional model royal-proposal case was added.
- The shared production build passes. Repository formatting and whitespace validation pass.
- A fresh full-suite attempt reported 226 passes, four failures and 89 cancellations when stopped after roughly 6.6 minutes, with other independent full-suite runs already consuming the machine. The failures were the previously documented housing-material and two frontier-accounting assertions, plus the loopback autosave endpoint's permission error. The cancellations reflect interruption, not failed assertions. This follow-up does not claim a passing full suite; the original baseline comparison above remains the available attribution for those assertion failures.
- The monthly review scan was refined to inspect existing marriages, dependencies and wars rather than reconstructing every contacted court's full briefing. A deterministic benchmark with 48 model cabinets, 560 provinces, 24 wars and 47 contacts per cabinet measured 100 complete review batches after 10 warm-ups: mean **2.45 ms**, p95 **4.44 ms**. Assertions verify all four settlement options and that unchanged situations do not reschedule review. These are batch timings under concurrent test load, not complete simulation-tick timings or an isolated speedup claim.

The follow-up completed the four refinement passes: shared domain quotes and advice boundaries; individual function and stale-authority review; monthly scan allocation and complexity reduction; and documentation, naming and formatting. Validation exercises supplied model context and accepted output, without calling an external model or evaluating its actual strategic reasoning.

## Commit verification

The complete proposed commit was assembled on the current repository baseline in an isolated directory, excluding concurrent city, border and military work. Its production build and formatting pass. All 46 tests in `cabinet-sovereignty`, `dynastic-capitulation` and `simulation-refactor` pass, including the deterministic checkpoint fixtures. The full-suite limitations above remain unchanged.
