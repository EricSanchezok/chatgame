# Testing policy

Tests are executable evidence that a meaningful regression becomes visible before delivery. Name the invariant at risk, then choose the lowest boundary that can observe it with production-like composition. Optimize for durable signal, not test count or coverage percentage.

## Test topology

- Vitest tests are colocated as `src/**/__tests__/*.test.ts`, `src/**/*.test.tsx`, and focused library tests under `src/app/_lib/__tests__/`; `vitest.config.ts` selects the unit project and `test/setup.ts` owns shared jsdom setup.
- `test/fixtures/open-world-script/` is the shared schema v9 world fixture. It proves the generic contract and is not built-in playable content.
- Playwright flows live under `e2e/flows/`, accessibility coverage under `e2e/a11y/`, shared support under `e2e/support/`, and platform-specific visual baselines beside the owning visual flow. `playwright.config.ts` selects the e2e and a11y projects.
- `worlds/blackmarsh/` is the real reference-world entry used for structural and live compatibility checks.

Repository-wide commands live in [AGENTS.md](../AGENTS.md). `npm run check:fast` owns lint, types, Vitest, the world fixture, workflow verification, and governance gates. `npm run check:ui` owns production E2E and accessibility. `npm run check:all` composes both. `npm run test:live:deepseek` is a manual compatibility check using process credentials and is not a deterministic CI gate.

Visual snapshots keep separate operating-system baselines with the same strict pixel threshold. Eliminate cross-platform geometry differences first; platform baselines absorb only irreducible font rasterization and rendering differences.

## Evidence rules

- Verify the world, not model self-report. Assert committed truth, belief, RNG, files, public events, or an authorized role view; narrative claims are not state evidence.
- Replace only expensive or nondeterministic boundaries such as external LLM HTTP, clocks, and IDs. Provider adapters, queues, loaders, Route Handlers, WorldHost, transactions, and persistence use real owned implementations. `ScriptedModelProvider` is for precise semantic tests.
- A failed execution proves revision, canonical state, and the policy roster remain unchanged. Cancellation and deadline tests prove that only complete steps persist.
- Strict schemas verify field ownership: models may name semantic IDs and candidate aliases; the engine materializes revision, step, phase, Profile, lifecycle, provenance, threshold ledgers, timestamps, and runtime IDs.
- Cognitive tests place conflicting truth and belief together and prove they do not overwrite each other. Public API tests search for canonical bindings, another Agent's belief, and Inspector payload leakage.
- Random tests fix the seed and prove check requests, DC, stakes, and distribution are committed before RNG extraction.
- Remote-model tests never print credentials, prompts, or raw responses and never replace deterministic semantic gates.
- A regression test fails for the escaped behavior before the fix and passes afterward, unless an existing deterministic reproduction already owns the contract.

## `eager-reference@1`

- Every living model Agent produces one action and enters grounding. External actions come from ActionWindow; idle and timeout use kernel-generated typed noops.
- Grounding covers intersecting read/write/audience footprints, independent components, unknown-dependency global fallback, cross-component merge, and the rule that private IDs never enter the canonical catalog.
- Every action receives exactly one engine-preallocated outcome slot. `advance_time` is engine-generated and positive.
- Observation tests cover byte-based model-input batching, fixed observer slots, complete materialization, permission checks, and local repair. One observer exceeding its budget fails explicitly.
- AgentMind consumes the complete settlement. Network, cancellation, configuration, or Ledger failures discard candidates. Exhausted semantic repair for one Agent leaves a countable typed fallback and never fabricates belief. External and idle Agents do not run AgentMind.
- A headless one-step run of Blackmarsh's 48 autonomous Agents is the structural regression. Domain actions may be blocked, partial, or noop, but the run cannot fail because of a missing outcome, missing time, or ID-namespace confusion.

## World Instance and Participant

- A headless world supports single-step, ten-step batch, realtime start/pause, and restart recovery. Scheduler tests use a fake clock to prove no reentry, no offline backlog, generation fencing, and scheduling only after the prior commit.
- ActionWindow uses internal two-Participant tests for collection, idempotent retry, conflicting submissions, deadline noops, disconnect, and revision CAS; the product UI still allows one active Principal.
- Origin tests prove opening the dialog does not change the URL, cancellation leaves no orphan instance, and confirmation produces deterministic identity, spawn point, resources, persona, goal, and display customization.
- Arrival tests prove it is the first persisted World message, reads only the authorized perspective, returns three suggestions without submitting them, falls back deterministically on failure, records complete Ledger evidence, and leaves semantic/state hashes unchanged.
- Participant-session tests prove one natural-language submission creates one advance, moves at most one step, and preserves the same message projection through refresh, retry, failure, and restart. Participant composer never exposes batch or realtime controls.
- Observer tests verify per-Agent projections of actions, Observations, character, and belief, and search for canonical bindings or another Agent's private state. Takeover, exit, and direct switch restore model policy in one revision CAS.
- Control-orb tests cover drag restoration, moving Sheets, save, settings, character tools, focus return, advanced detach, and Inspector hidden by default.
- A closing overlay exits paint and hit testing before another Dialog opens. Accessibility scans wait for that state so transparent exit animation cannot alter underlying contrast measurements.
- Static-asset tests cover actual MIME, animation, dimensions, per-file and total budgets, path traversal, Unicode/case collisions, symlinks, and malicious ZIPs.
- Persistence tests cover cross-connection recovery, generation conflicts, corrupt-document rejection, validation cache, and pinned `WorldRuntimeContract` plus content-addressed world hash.

## Ledger and research reproducibility

- Execution Ledger tests prove complete requests, responses, and candidates can be retrieved by execution; critical write failure blocks revision; failed executions remain; Instance CAS and terminal record commit atomically.
- Recorded replay never accesses the network and produces the same semantic and state hashes. Compare partitions transition, observation, and mind changes. Export derives only from original events and artifacts.
- Aggregate metrics reject high-cardinality Agent, Participant, Instance, Event, and invocation dimensions; subject detail remains queryable from traces.
- The 1/10/50/1000-Agent matrix uses world/seed as the repeated unit and never treats Agents from one world as independent samples.

## Maintenance budget

- One behavior has one primary evidence home. Add defense in depth only for a public contract, security boundary, migration, escaped incident, or similarly costly risk.
- Coverage locates unobserved code but is not a target or proof of quality.
- Remove or merge tests when behavior disappears, another test becomes primary evidence, or assertions constrain implementation without protecting a contract.
- A flaky test is a broken signal. Fix the uncontrolled boundary or quarantine it with an owner and repair condition; never normalize blind retries.
- Expensive fuzzing, mutation, visual, load, and large environment matrices require a repository risk that pays for their continuing cost.

The verification rationale is recorded in [0034](decisions/0034-truth-engine-verification-matrix.md), [0063](decisions/0063-eager-reference-execution.md), and [0064](decisions/0064-conversation-core-and-agent-perspective-observer.md).
