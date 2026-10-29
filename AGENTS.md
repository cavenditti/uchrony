# Agent Engineering & Code Quality Guidelines

This repository prioritizes **clear, readable, well-architected, high-performance, and well-commented code**. Implementing a feature or fixing a bug is only the first half of any task; leaving the touched code cleaner, better tested, faster, and easier to understand than before is equally required.

---

## Core Code Quality Principles

1. **Concise, Well-Abstracted Clarity**
   - Aim for the sweet spot where code is **both concise and immediately understandable**. Verbose, repetitive boilerplate obscures intent just as much as opaque tricks.
   - Use well-chosen abstractions—declarative schemas, higher-order factories, composable helpers, and data-driven tables—to express logic compactly and eliminate repetition while staying clear and efficient.
   - Keep types narrow and honest (`satisfies`, discriminated unions, mapped types, `Readonly`, compile-time exhaustiveness checks) so invariants are enforced by `tsc` rather than verbose runtime guards.

2. **Single Source of Truth & Cohesive Boundaries**
   - Avoid parallel maps, duplicated logic across entry points, or scattered validation/mutation rules.
   - Separate pure domain/simulation logic (`src/sim/`) from UI rendering (`src/components/`). Keep React components focused on presentation and state wiring by extracting standalone helpers and subcomponents.

3. **Intentional Performance & Immutability**
   - Design for low allocation overhead and tight asymptotic complexity in simulation ticks (`src/sim/`) and UI render paths (`src/components/`).
   - Prefer structural sharing over full `structuredClone`, precompute static lookup tables at module load time, and use `Object.is` / targeted field comparisons instead of serialization (`JSON.stringify`).

4. **Mandatory Unit & Regression Testing**
   - **Every code change must be covered by unit tests** in `tests/*.test.ts`.
   - New features require tests for core behavior, boundary conditions, and domain invariants; bugfixes require a regression test that fails without the fix; refactors must preserve existing contracts and add tests for any newly extracted units.

5. **High-Signal Comments**
   - Do not write comments that merely restate what the syntax already says.
   - **Always** document:
     - **Domain & economic rationale**: Why a formula, invariant, or parameter coupling exists in the simulation.
     - **Architectural & design choices**: Why a module or abstraction is structured a specific way (e.g., why two slots exist in a dynamic scope, why a data structure is pre-indexed, or why a specific TypeScript construct is used).
     - **Non-trivial algorithms & edge cases**: Step-by-step invariants, apportionment/rounding guarantees, performance trade-offs, and runtime/language subtleties (such as Proxy invariants or floating-point guards).

---

## Mandatory Post-Change Refinement Workflow

After completing any functional change (feature, bugfix, or refactor) and writing its unit tests, **every agent must perform a four-pass refinement phase** before considering the task finished.

> **Scope of Refinement (Incremental Validation)**: Once code has completed these passes, it is considered **validated**. Agents must apply this workflow **only to the code introduced, modified, or directly impacted by their changes**—do not re-audit or rewrite preexisting, untouched code on every task unless explicitly asked.

### Pass 1: High-Level Design & Organization Analysis

Step back and evaluate the architecture of the modified code and its immediate boundaries:

- **Design patterns**: Are the right abstractions in place? Replace ad-hoc conditionals, repetitive boilerplate, or leaky abstractions with clean, unified patterns (e.g., declarative schemas, shared scope factories, staged pipelines).
- **Module & responsibility boundaries**: Is code living in the right file? Extract shared domain utilities instead of duplicating logic across modules, split oversized files or monolithic UI components into focused units, and order declarations logically from high-level public contracts down to internal helpers.
- **Data flow & invariants**: Eliminate redundant state representations and ensure invariants are enforced in one canonical place.

### Pass 2: Per-Function Rewrite Pass

Inspect **every new or modified function individually** and ask whether there is a more concise, expressive, and idiomatic way to write it:

- **Single responsibility & conciseness**: Does the function do one clear thing at one level of abstraction? Decompose functions that mix concerns, and collapse repetitive patterns into tight, reusable helpers.
- **Control flow & expression**: Flatten nested conditionals with early returns/guard clauses, replace verbose imperative boilerplate with clean functional/declarative expressions where efficient, and remove dead branches or redundant fallback checks.
- **Signature & contracts**: Tighten parameter and return types, avoid mutating inputs unless explicitly designed as an in-place mutator, and handle edge cases cleanly.

### Pass 3: Performance Reasoning & Benchmarking Pass

Analyze the runtime cost of the changes and guard against performance regressions:

- **Bottleneck analysis**: Reason explicitly about the hot paths, algorithmic complexity ($O(1)$ vs $O(N)$ vs $O(N^2)$), memory allocations/GC pressure per tick or render, cache locality, and redundant recomputations introduced or touched by the change.
- **Targeted optimization**: Hoist invariant computations out of loops, pre-index lookup structures, batch state/ledger updates, and avoid intermediate array/object allocations in hot simulation paths.
- **Benchmarking & performance contracts**: Evaluate whether the touched subsystem could become a bottleneck at regional/continental scales. Where appropriate, add or update deterministic performance contracts and micro-benchmarks in the test suite (e.g., `tests/performance-*.test.ts`) or verify tick timings with `npm run test:performance` to lock in optimal performance.

### Pass 4: Stylistic & Documentation Pass

Do a dedicated readability and commenting pass across all modified files:

- **Readability & naming**: Verify that variable, function, and type names accurately communicate domain meaning and units. Ensure consistent ordering, visual grouping, and formatting (`npm run format`).
- **Explanatory comments**: Add module-level overview headers, JSDoc comments on exported types and functions, and inline comments wherever the _why_, domain math, performance rationale, or algorithmic mechanism is not immediately obvious at a glance.

---

## Verification Checklist

Before finishing a task or committing changes, always run:

1. `npm run build` (`tsc -b && vite build`) — zero type or build errors.
2. `npm test` — all unit, invariant, and performance contract tests pass (including new tests added for the change).
3. `npm run format` — consistent Prettier formatting across the repository.
