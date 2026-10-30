# Outstanding validation issues

Recorded on 2026-10-30 while implementing continuous identity policies and community politics.

The final production build and formatting passed. The final focused run of
`tests/identity-policy.test.ts`, `tests/configuration.test.ts`, and
`tests/simulation-refactor.test.ts` passed **45/45 tests**. Desktop/mobile controls
and keyboard-driven preset/custom transitions were inspected in an isolated browser fixture.

The full `npm test` run was started earlier during implementation. It reported the
failures below and still had long-running tests in progress at this handoff. It is
not a passing final full-suite result. Re-run the complete suite after triage.

## Confirmed failures on the preceding code

Each unchecked item in this section also failed in an isolated `git archive`
checkout of **a2cd915**, without the identity-policy changes. They are recorded
here rather than repaired as part of the identity-policy commit.

- [ ] `tests/adaptive-economy.test.ts`: **housing requires paid labor and real materials, and capacity appears only on completion**. `advanceLandUse` reaches `createResidentialParcel` through the urban survey and throws `Residential parcel must lie on its owner’s land`.
- [ ] `tests/competitive-pressure.test.ts`: **a more assertive frontier still pays for materials, relocates people and respects player control**. Founding treasury assertions disagree with the actual charge (`498.56` versus expected `468` in the baseline run). Check current expedition pricing and update the contract only after verifying conservation.
- [ ] `tests/competitive-pressure.test.ts`: **coarse frontier reviews account for multiple scheduled decisions without adding resources**. Treasury assertions use an outdated or inconsistent expedition charge (`499.64` versus expected `452` in the baseline run).
- [ ] `tests/economic-model.test.ts`: **industrial investment is queued and unfunded capacity does not grow automatically**. The assertion expecting one queued producer project fails. Check current investment ownership and project placement before changing the expectation.
- [ ] `tests/map-memory.test.ts`: **bounded map lookups retain exact coastline geometry and freight traversal order**. The geometry/traffic fingerprint differs from its stored expectation. Determine whether the maritime changes require a validated fixture refresh.
- [ ] `tests/map-scale.test.ts`: **world scale adds physical distance, connected provinces, independent states and a sparse navigable shipping network**. A scale/network assertion fails; investigate against the current maritime model.
- [ ] `tests/model-mathematics.test.ts`: **every published guide equation renders with accessible MathML**. The section `Public productive investment and supplier compensation` has no mathematical notation. Add the relevant equation or deliberately revise the guide's section contract.
- [ ] `tests/settlement-dynamics.test.ts`: **funded expansion creates a within-cell parcel only after payment; capacity waits for construction**. Reconcile funded parcel growth with the current residential geometry/accounting rules.
- [ ] `tests/settlement-dynamics.test.ts`: **several centres in one pool can fund housing without duplicating projects or creating money**. The observed pair of capacities is `[21919.2, 21919.2]` versus expected `[21983.2, 21983.2]` in the baseline run. Verify project deduplication and delivered capacity.

To reproduce individual failures, run:

```sh
node --import tsx --test --test-name-pattern '<exact test name>' tests/<file>.test.ts
```

## Environment issue and incomplete classification

- [ ] `tests/autosave.test.ts`: **the disk endpoint requires same-origin writes and isolates browser save slots**: the full sandboxed run failed this local HTTP endpoint test. Repeat with loopback networking permitted before classifying it as a product regression.
- [ ] `tests/frontier-growth.test.ts`: **an ordinary frontier expands and produces a funded new state without injected resources**. The implementation-time full run failed this long-horizon scenario. A separate baseline run was started but had not returned a result when this list was written. Compare baseline and final code before attributing the failure; do not weaken the funded-growth and population invariants merely to obtain a pass.
- [ ] Complete a final full-suite run. Long simulation tests were still running when the commit was requested; the focused passing run does not replace them.

## Resolved during this change

- [x] Shared policy validation tests now use each numeric field's actual bounds, accommodating identity intensities in `[0, 1]` alongside percentage budgets.
- [x] Cabinet trajectory fingerprints were refreshed after two independent replays agreed at all eight checkpoints and each checkpoint passed world validation. The refreshed fixture passed the final focused regression run.
