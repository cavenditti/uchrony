# Simulation performance

The monthly rules, settlement order, population accounting and random streams remain deterministic. The performance work targets repeated searches, temporary objects and derived spatial data. It does not skip economic months, reduce the physical building detail, or change the spatial influence tolerance.

## Changes

- **Mesh balancing:** identify unbalanced quadtree neighbors through Morton intervals instead of allocating and sorting a complete face graph. Trees deeper than the 32-bit address range retain the general face sweep. Keep leaves in Morton order throughout balancing and screen out faces that cannot touch an oversized neighbor. During the existing dwell period, reuse source geometry and refine from retained leaves; changes to geography, mode, minimum span or expired dwell history fall back to a full rebuild.
- **Geometry:** fine squares materialize their polygon vertices only when a geometry query needs them. Physical interfaces and adjacency are also lazy. These objects are runtime projections; saved terrain, buildings and mesh addresses retain their existing format.
- **Spatial totals:** remember site-to-leaf membership until the site moves or the mesh changes. Clear and refill only previously occupied leaves; empty fine cells have no accounts, jobs or residents to aggregate.
- **City connectivity:** index occupied plots in spatial buckets and retain exact distance, footprint and walking-access tests, with stable ID ordering. City labels no longer require constructing the full numerical mesh index.
- **Founding:** settle government decisions in their original order, updating people, inventories, funds, ownership and city names immediately. Rebuild the numerical mesh once after the founding phase, retaining its revision count. Within a founding round, reuse unaffected countries’ building components while preserving every ordered naming update; mixed legacy housing uses a full refresh. Equivalent tree-change keys can have a different JSON insertion order.
- **Physical searches:** use phase-local site indexes independent of the number of empty numerical leaves. Housing surveys index nearby obstacles and street segments before their exact footprint tests.
- **Population:** cache identity keys with all mutable identity fields checked, combine census rollups in one ordered pass, and partition dated cohorts only across their actual recipient districts. Migration shares destination utility and travel costs across households while preserving floating-point addition order.
- **Routing:** accessibility and time queries use the same shortest-path tree without constructing discarded path arrays. Stop testing destinations in a housing pool once its accessibility is established. Reuse physical commuting edges within the existing route-cache lifetime while continuing to read current ownership, devastation, infrastructure and traffic. Skip job searches without labor supply and migration searches without another eligible housing pool.
- **Housing and firms:** index pending construction once per phase and avoid rebuilding the full firm index during each initial district allocation.
- **Payments:** cache immutable account addresses, resolve their current account objects, and retain the bounded transaction tail in reusable numeric/string columns during a synchronous tick or startup. Materialize its final 1,024 entries before returning, including after an exception; intermediate history is not observable within that scope. All payments, bank settlements and accounting totals remain recorded.

## Reproduce

```sh
npm run test:performance -- --scale regional --start frontier --months 12 --repeats 2 --progress
npm run test:performance -- --scale world --start frontier --months 6 --repeats 1 --prepare --fingerprints --progress
npm run test:performance -- --scale world --start settled --months 3 --repeats 1 --prepare --fingerprints --progress
npm run test:performance -- --scale world --start frontier --months 0 --repeats 1 --prepare
npm run test:performance -- --save /path/to/export.json --months 12 --repeats 1
```

The benchmark never writes a save or calls an external model. A single timing trial retains one live world; repeated or side-by-side replay trials clone the starting state. Timings cover monthly ticks; loading/generation, cloning, census assertions, full-state fingerprints and final save validation are outside the timed interval. `--warmup N` advances the shared starting state before measurement. `--seed` changes the deterministic scenario. `--prepare` measures initial simulation preparation separately; `--fingerprints` also records its complete prepared state and every monthly state; `startupMs` is generation plus preparation. It excludes module loading, display snapshot transfer and rendering. `--months 0 --prepare` measures startup only. `--engine-root` selects both generation and the engine from that source tree.

To compare another source tree against the same starting world:

```sh
npm run test:performance -- --scale regional --start frontier --months 12 --repeats 1 --compare-root /path/to/before
```

This checks the complete state after every month. If serialized key order differs, it falls back to deep structural equality without excluding any subsystem or mesh metadata. `finalHash` and `monthlyHashes` are serialization fingerprints, so insertion order matters to those strings.

At World scale, run the two versions in separate processes with `--engine-root` and `--fingerprints`, then compare their monthly fingerprints. Keeping two large worlds and both implementations' runtime caches alive together can exceed the default Node heap limit; that comparison overhead is not the memory requirement of a single simulation. Use separate timing runs without `--fingerprints`: hashing a large census creates temporary memory that can affect the following tick even though hashing itself is outside the timer. Run timing trials without other CPU-heavy jobs for a clean comparison. `cpuMs` and `tickCpuMs` report process user plus system CPU time, including helper threads. `processPeakRssMiB` covers the entire benchmark process, including setup and final hashing; it is not a tick-only allocation measurement.

For a CPU profile:

```sh
node --cpu-prof --cpu-prof-dir=/tmp --import tsx tests/performance.ts --scale regional --months 6 --repeats 1
```

## Initial validation

The machine-readable measurements and source hashes are in [the October 27 report](validation/simulation-performance-2026-10-27.json). The baseline is the working tree at the start of this task, including its existing uncommitted frontier and map work, not merely the HEAD commit.

Measured on Node 26.11.1, macOS arm64, with seed `performance-ledger`:

| Scenario                     |                                         Baseline tick time | Updated tick time | Comparison                                                                  |
| ---------------------------- | ---------------------------------------------------------: | ----------------: | --------------------------------------------------------------------------- |
| Regional frontier, 12 months |                                                   47.600 s |          18.924 s | **2.52× throughput**, complete state equality after all 12 months           |
| World settled, 3 months      |                                                  134.830 s |          96.474 s | **1.40× throughput**, identical complete monthly fingerprints               |
| World frontier, 6 months     | Profiled baseline exhausted its ~4 GiB heap before month 1 |         107.192 s | Completed and passed census/save validation; no finite baseline speed ratio |

The World frontier's ordinary fourth and fifth months took about 7 seconds each; the sixth-month remesh took 12.4 seconds. Its initial month still took 35.6 seconds. These are single shared-host trials, not isolated hardware limits or a guarantee for every seed and age.

The final focused suites ran **90 checks: 88 passed and two pre-existing failures were reproduced independently in the baseline**. Type checking, the production build, formatting of changed code and whitespace checks passed. The full repository test suite and 200-year qualification were not rerun.

Focused checks cover ledger wraparound and failure cleanup, replacement account objects, neighbor ordering and mountain corners, Morton balancing against physical face sweeps, exact fine-square geometry, adaptive spatial queries, settlement conservation, organic growth, frontier expansion, financial accounting, saved continuation and serial/parallel influence equivalence.

The existing `firms, banks and GDP survive deterministic save continuation and paid construction` test has a pre-existing structural mismatch: the original world contains `adaptive.lanes: undefined`, while JSON restoration omits that property. The same failure was reproduced in the untouched baseline. This performance change leaves that unrelated migration behavior intact.

The existing `a representative commute starts at its sampled home and uses its own travel time` fixture also fails in the untouched baseline because it does not produce the expected inspection routine. The physical commuting and settlement-access regression checks are reported separately.

These synthetic timing and replay checks do not establish long-run historical calibration or a 60-months-per-second rate. World-scale initialization, remeshing and founding remain more expensive than an ordinary month.

## World-scale follow-up

The follow-up reruns the preceding optimized source in separate processes, with startup measured independently. It does not compare these new runs directly with the older, differently loaded trials above. The [follow-up report](validation/world-scale-performance-2026-10-27.json) contains both runs, complete fingerprints and source hashes.

| Scenario                                 | Previous optimized version | Current version |       Gain |
| ---------------------------------------- | -------------------------: | --------------: | ---------: |
| World frontier, six monthly ticks        |                    97.01 s |   36.47–36.76 s | 2.64–2.66× |
| World frontier, generation + preparation |                    19.32 s |     8.44–8.54 s | 2.26–2.29× |
| World settled, three monthly ticks       |                    57.11 s |         47.85 s |      1.19× |
| World settled, generation + preparation  |                     8.12 s |          7.00 s |      1.16× |

Both World scenarios produce identical prepared states and every monthly fingerprint matches the prior implementation. A 14-month regional frontier replay also matches the complete state through the end of the mesh dwell period. The two frontier trials are independent processes; timing remains sensitive to shared-host load.

The follow-up validation covers **96 unique checks: 94 pass, with the same two baseline failures described above**. New checks cover spatial bucket boundaries, phase-local queries across movement and retirement, mutable identity keys, time-only route equivalence, and retained mesh geometry versus a full rebuild through changes in activity, minimum span, geography and dwell expiry. Type checking and the production build pass.

The largest gain is in frontier startup, founding and remeshing. The settled scenario improves more modestly and remains dominated by economic and demographic work. These results retain full building detail and monthly accounting; they do not establish browser frame rates or long-run throughput.

## Settled-world economic and population work

This pass keeps every payment, bank settlement, household choice, dated cohort and random draw. It targets the settled case's economic matching, migration, population transfers and retained search data.

- Payroll uses ordered numeric proposal arrays and resolves account holders once inside the fixed payroll phase. Retail settlement uses the same prepared-payment primitive. Banks are enrolled only on the first positive payment, and ordinary commands continue to resolve live account objects.
- Commuting searches share edge costs only inside phases where terrain, ownership, roads, congestion and technology cannot change. Dijkstra uses reusable numeric workspaces and heap cursors; retained trees store exact distances and parent directions in compact typed arrays. No route tolerance or travel cutoff changes.
- Housing choices reuse access walks and lazy origin lookups. Distant rejected alternatives no longer construct neighbor lists. Point-index queries avoid allocating deduplication sets after unique site membership has been established.
- Population allocation retains the original largest-remainder arithmetic and index ties, with a specialized two-sex split. Mortality and fertility accumulate age totals during their existing passes. Cohort copies keep arbitrary social metadata isolated while directly copying numeric birthday tuples.
- Trade traverses only open branches of each buyer's existing shortest-path tree. Sellers beyond exhausted paths cannot execute a shipment; remaining offers retain their delivered-price and ID ordering. Credit limits are reused only until the buyer's acquisition price changes.
- Provincial authority assessments index district membership once and continue reading live funded-service values. Startup constructs empty district accounts directly instead of deep-cloning assets that are immediately discarded.

The regression suite compares allocation with the original implementation across 10,000 bounded/unbounded cases; checks exact mortality/fertility results and random states; exercises partial payments, lazy bank enrollment, nested journal failure cleanup, heap ties, mutable services, and housing accessibility.

Concurrent city, housing and event-history work was kept separate in the frozen performance comparison. Additional matched snapshots include those changes in both implementations for integration replays. Source hashes and final measurements are recorded in [the settled-world report](validation/settled-world-performance-2026-10-27.json).

Two separate process trials per version, run in reference/current/current/reference order, produced these results on the shared machine:

| Measurement | Previous version | Updated version | Comparison |
| --- | ---: | ---: | --- |
| Settled World, three monthly ticks | 64.94–77.08 s | 48.01–48.44 s | **1.47× mean elapsed throughput**; paired ratios 1.34–1.61× |
| CPU consumed by those ticks | 74.93–79.50 s | 58.35–62.54 s | **1.28× mean CPU efficiency** |
| Opening commuter matching and payroll only | 14.06–14.26 s | 6.77–7.90 s | **1.93× mean elapsed throughput** |
| Generation plus preparation | 7.72–9.63 s | 6.74–9.12 s | Overlapping trials; no reliable large startup gain |

The payroll component produces the same **587,541 commute records and 5,862,580 cumulative transactions**, with identical complete resulting worlds in all four trials. Its setup is a prepared World with monthly account initialization and local firm hiring; other monthly phases are excluded. It measures the payroll rewrite independently of unrelated monthly work.

The full World replay retains the prepared fingerprint and all three monthly fingerprints of the reference. A 12-month regional settled replay matches complete states after every tick. Separate six-month settled and frontier replays also match with the concurrent city, housing and event-history changes included in both versions.

The final focused suites ran **117 checks: 115 passed**, with the same two previously reproduced failures documented above. Production build, formatting and whitespace checks passed. The payroll benchmark's reusable harness also passes its regional replay check.

The clear gain is in monthly economic work. Total simulation time improves less than the payroll component, and these noisy startup trials do not establish a substantial startup improvement. The measurements do not establish long-run throughput or a twofold improvement for the complete monthly simulation.

To reproduce the payroll-only comparison (allow enough heap for the reference world, a trial copy and runtime caches):

```sh
node --expose-gc --max-old-space-size=8192 --import tsx tests/performance-payroll.ts --compare-root /path/to/before
```

For elapsed-time qualification, omit per-month fingerprints and run each version in its own process; then run a separate fingerprinted replay for exact results:

```sh
npm run test:performance -- --engine-root /path/to/before --scale world --start settled --months 3 --repeats 1 --prepare
npm run test:performance -- --scale world --start settled --months 3 --repeats 1 --prepare
npm run test:performance -- --scale world --start settled --months 3 --repeats 1 --prepare --fingerprints
```

## Initial playback controls and approximate Max — 27 October 2026

Historical implementation and measurements; the coarse clearing below supersedes this Max path.

The clock now provides play/pause and direct **1×, 2×, 4× and Max** buttons. A speed button starts playback; Space toggles playback, and keys 1–4 select those four modes. Numeric speeds target one, two or four monthly steps per second, subject to the machine's capacity. Max has no pacing cap. It publishes the map at six-month boundaries and sends lightweight progress updates between them. Work yields between expensive months; pause cannot interrupt a month already being calculated.

Max is an explicitly approximate, multirate model, approved for this mode. It does not invent causes after jumping the date:

- Production, wages, taxation, goods, bank payments, births, deaths, politics and military activity still settle each month.
- Between six-month reviews, commuter matching reuses known journeys and current workers, vacancies, wages and funding. Full job search returns at the review.
- Migration and occupational changes run at the review with accumulated transition probabilities and actual housing capacity. Identity changes and residential location choices are reviewed then; these can differ from monthly decisions.
- Housing demand uses aggregate local shortages, subtracting funded capacity once. Infill uses actual resources and paid labor. New plots are surveyed at the review; normal playback keeps the full multi-centre housing-demand calculation.
- Returning to normal playback reconciles an incomplete interval on the next monthly step. Pausing alone does not advance or alter the model. Partial interval state and approximation provenance survive compressed saves, and the clock keeps an **Approx. history** label after leaving Max.

The profile also found an exact optimisation: `housingCentres` rebuilt the global construction membership set for every housing pool. That immutable index is now shared across the phase, without changing ordering, choices or arithmetic. The sampled World run spent about two-thirds of monthly work in housing investment before this fix.

Observed settled World timings, seed `performance-ledger`, 129,024 cells and 32 states, for six months:

| Mode | Elapsed time | CPU time | Comparison |
| --- | ---: | ---: | --- |
| Previous monthly implementation | 262.06 s | 273.36 s | Baseline frozen at this task's start |
| Updated monthly implementation | 104.97 s | 134.62 s | **2.50× elapsed throughput**, 2.03× CPU efficiency |
| Approximate Max | 80.49 s | 103.90 s | **3.26× versus the old baseline**, 1.30× versus updated monthly playback |

These are single separate-process development trials on a shared machine, with some browser QA overlapping the earlier baseline. They are not repeated isolated-hardware measurements. Startup is excluded from these times; this change establishes no startup speedup. Max's six-month result differs by +378 people and −0.175% GDP from the monthly result in this one scenario; these figures are not error bounds for longer histories or other worlds.

Complete states match the frozen baseline after both months of a settled World replay and a separate two-month regional replay. The 14 focused checks pass, including a 12-month approximate replay resumed from a compressed save, monthly ledger/goods/bank/census/workforce invariants, partial-interval return to normal, housing demand, and clock scheduling. Production build and desktop/mobile controls checks pass. The final clock accessibility audit has no violations or incomplete checks; independent UI review: **ship**.

Reproduce the two current modes in separate processes:

```sh
node --import tsx tests/performance-fast-forward.ts --mode monthly
node --import tsx tests/performance-fast-forward.ts --mode max
node --import tsx --test tests/playback.test.ts tests/fast-forward.test.ts tests/urban-blocks-demand.test.ts
```

Timings, replay fingerprints, source fingerprints and validation scope are in [the playback report](validation/playback-fast-forward-2026-10-27.json).


## Coarse six-month Max — 27 October 2026

Max now performs **one economic clearing and one demographic integration for six months**, then reconciles local details. Standard Play and 2× retain monthly integration. The controls are play, double-arrow 2×, and triple-arrow Max; the running button becomes pause. 4× is removed. Keys 1–3 select the pace and Space pauses/resumes. Pause completes the current integration step.

Production capacity, household needs, paid wages, transport capacity and public spending cover the full interval. Mortality, depreciation, spoilage, interest and transition rates account for elapsed time; births are allocated to dated monthly cohorts. Funded projects age by six months. Wages and displayed income/GDP remain monthly rates, while canonical goods and financial accounts retain interval flows for auditing and saves. Forecasts change units when entering or leaving Max.

The coarse clearing reuses known commuter journeys, bounds local supplier searches to 32 reachable markets on actual corridors, and retains provincial trade. Production/trade share a live lending lookup; firm reconciliation uses a separate borrower index so repayments and defaults cannot stale bank totals. Local migration uses neighbors and established sea links with actual housing vacancies and asset transfers. Housing infill uses physical materials and paid labor. Census, settlements and map sites are reconciled afterward. Detailed spatial searches return with monthly playback. Political and other detailed decisions are sampled at the interval boundary; Max may produce a different history and does not reconstruct exact skipped events.

For the same settled World case used above:

| Mode | Six months | CPU time |
| --- | ---: | ---: |
| Previous approximate Max | 80.49 s | 103.90 s |
| Coarse Max, final trial after browser closure | **20.61 s** | **23.49 s** |

That is **3.91× faster than the prior Max** and **5.09× faster than the previously measured monthly path**. Four runs ranged from 15.20 to 25.34 seconds and produced the same population and economic aggregates. This is a shared development machine, with overlapping work during some trials; these are not isolated-hardware guarantees. Startup is separate (6.8–13.6 seconds across these trials); this change claims no startup gain. Coarse GDP describes an interval average and is not directly comparable to the exact model's final-month GDP.

The timing and monthly-replay evidence precede an independent identity-geography initialization change in the shared checkout. The Max change itself preserves complete initialization/two-month regional replay fingerprints. Approximate runs pass ledger, goods, banking, national-account, census and FTE checks; compressed continuation and return to monthly mode are covered. Regional settled/frontier and World frontier runs reached five years; the full browser cabinet setup passed two years, and the browser reached July 1731. These are consistency checks, not long-horizon accuracy calibration.

Verification also exposed and fixed frontier diplomacy treating unclaimed land as a country and an absent-lanes property breaking structural save equality. A failed step is no longer published or saved as completed. The targeted checks pass across suite and focused repair runs; production build, desktop/mobile checks and independent UI/documentation reviews pass. The clock accessibility audit has 14 passes and no violations or incomplete checks.

Reproduce a full interval with:

```sh
node --import tsx tests/performance-fast-forward.ts --scale world --mode max --months 6
node --import tsx --test tests/fast-forward.test.ts tests/playback.test.ts tests/geopolitics.test.ts
```

Measurements, replay fingerprints and validation scope are in [the coarse Max report](validation/max-coarse-2026-10-27.json).
