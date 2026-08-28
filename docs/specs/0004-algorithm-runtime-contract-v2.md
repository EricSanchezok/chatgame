# Algorithm runtime contract v2

Artifact-Version: 1
Status: Implemented

## Intent

Make execution algorithms genuinely replaceable without giving them canonical-state authority or ownership of stable observability. Each world instance pins one internal algorithm identity, production and replay resolve that identity through the same registry, and the engine derives stable evidence from validated inputs and candidates.

The public algorithm surface remains deliberately small: bootstrap and step. The work does not expose algorithm selection through the browser or World API, add dynamic package loading, define training or reward protocols, or redesign benchmark baselines. The eager reference implementation remains exact while its dependency grounding and temporal planning responsibilities receive focused internal owners.

This is a forward-only boundary. WorldInstance schema 16, execution contract 2, runtime event schema 2, and `eager-reference@3` replace their earlier forms without migrations or compatibility readers.

## Contract

`AlgorithmManifest` declares a non-empty algorithm ID and version, execution contract version, JSON-safe immutable configuration, uniquely identified components, and a canonical content hash. An `AlgorithmRef` contains the ID, version, contract version, and manifest hash. Registration rejects malformed manifests, unsupported contract versions, duplicate component identities, non-JSON data, and factories whose produced algorithm does not match the registered manifest. Factories receive engine services and create a fresh algorithm instance for each execution boundary.

Every WorldInstance stores its `AlgorithmRef`. Creation uses the host default; restoration, bootstrap, step, and replay resolve the stored or recorded reference exactly. A missing or mismatched registration fails before model work or canonical mutation. The Execution Ledger records the actual producer as either an algorithm manifest or a typed engine operation. Arrival generation and other non-algorithm operations cannot claim an algorithm identity.

`WorldExecutionAlgorithm` exposes only `bootstrap` and `step`. The engine supplies decision-eligible Agent identities, cancellation, scoped model access, and a typed instrumentation surface. It does not supply an ambient random source. Algorithms cannot emit arbitrary stable event names or define metric semantics.

World step candidate schema 2 contains a source-state hash, an algorithm-neutral resolution candidate, action dependency evidence, temporal results, mind commits, one model-audit collection, and optional typed diagnostics. It does not duplicate derived observations, model audits, or eager-internal component results. The CanonicalCommitter independently validates candidate version, source identity, dependency coverage, references, audiences, quantities, conservation, causality, observation authorization, and mind ownership before an atomic commit. Observations are derived through one engine-owned projection from the resolution candidate.

Runtime event schema 2 is engine-owned. Algorithms may report only declared phase and degradation events through the typed instrumentation surface. The engine emits lifecycle and result counts from validated input and candidate data, including activation, decision eligibility, actions, outcomes, operations, events, observations, mind commits, due temporal triggers, boundary reasons, activity transitions, outcome statuses, operation kinds, and controlled model roles. Invalid stable events fail the critical execution rather than silently weakening evidence.

Model work counters accumulate as invocations progress so rollback evidence includes work completed before a thrown error. Metric definitions declare `sum`, `count`, `last`, or `max` aggregation in the owning metrics module. Derived execution timing reports root execution wall time and does not label nested-duration arithmetic as total work or a critical path without interval-span evidence.

## Plan

Land the versioned manifest, registry, instance pin, producer identity, and generic replay path first. Replace the candidate and committer contract next, then centralize typed telemetry and metric aggregation. Extract action dependency and temporal planning helpers from eager reference without introducing a general phase framework. Update architecture, observability, development, testing, and superseded factual descriptions after the code contract is stable.

Each independently verifiable unit receives focused tests and an immediate local commit. Existing experiment commands remain explicitly eager-reference except for mechanical contract-version updates.

## Verification

Exercise registry rejection, factory identity, per-instance pinning, unavailable algorithms, actual Ledger producer identity, recorded-provider replay, candidate validation, dependency coverage, observation derivation, and audit single ownership. Prove that engine metrics remain complete when an algorithm emits no optional diagnostics, malformed stable telemetry fails, mid-generation rollback records discarded work, temporal dimensions are exact, gauges aggregate correctly, and execution wall time is not double-counted.

Run the existing temporal, eager-reference, numeric, inventory, damage, replay, WorldHost, and Inspector suites through their real entry paths. Complete `npm run check:fast`, `npm run world:validate -- worlds/blackmarsh/world`, `npm run build`, the repository-selected full test surface, `node scripts/run-gates.mjs`, and `git diff --check`.

## Evidence

Implemented by the following independently verified commits:

- `476de73` — approved this Spec and proposed ADR 0071.
- `79cf0ea` — added contract v2 manifests, validated registry construction, per-instance algorithm pinning, producer identity, and registry-based replay.
- `b7453fc` — introduced Candidate schema 2, algorithm-neutral resolution evidence, engine-derived eligibility, single-source observations and audits, and independent dependency validation in the committer.
- `0259693` — moved stable runtime telemetry and metric aggregation into the engine, added runtime event schema 2, and accounted for discarded model work during failures.
- `9d6c690` — separated action dependency and temporal planning ownership while retaining eager reference as the orchestrator.
- `7f98a04`, `8dafe2e`, and `b443331` — hardened committer graph verification, exact manifest JSON validation, fresh-instance enforcement, and factory callable conformance.
- `a6a85ba` and `fa8d460` — enforced stable telemetry value domains and sealed engine lifecycle events from the algorithm-scoped observer.
- `47daec8` and `0858fe3` — corrected multi-step execution wall time and made `count` aggregate samples rather than values.
- `d8963fa` and `68b0177` — preflighted pinned algorithms before recovery writes and removed the duplicate cancellation surface.

Primary executable evidence lives in [`execution-kernel.test.ts`](../../src/engine/__tests__/execution-kernel.test.ts), [`observability.test.ts`](../../src/engine/__tests__/observability.test.ts), [`action-dependency.test.ts`](../../src/engine/__tests__/action-dependency.test.ts), [`eager-reference.test.ts`](../../src/engine/__tests__/eager-reference.test.ts), [`execution-ledger.test.ts`](../../src/server/__tests__/execution-ledger.test.ts), and [`world-instance-host.test.ts`](../../src/server/__tests__/world-instance-host.test.ts).

The final semantic review found no remaining actionable defects after these hardening commits.

Final verification completed on 2026-08-28:

- `npm test`: 35 test files and 221 tests passed.
- `npm run world:validate -- worlds/blackmarsh/world`: 232 entities and 48 Agents validated.
- `npm run build`: the production Next.js build and all routes compiled successfully.
- `npm run check:ui`: all 11 product/browser flows and all 4 accessibility flows passed.
- `npm run check:fast`: lint, typecheck, unit tests, fixture validation, workflow verification, and all six governance gates passed.
- `node scripts/run-gates.mjs` and `git diff --check`: passed after the final documentation update.
