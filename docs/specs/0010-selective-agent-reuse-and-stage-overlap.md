# Selective Agent Reuse and Stage Overlap

Artifact-Version: 1
Status: Implemented

## Intent

Reduce eager-reference preparation latency without changing the open-world semantic boundary. An Origin admission may invalidate only Agents whose cognitive input is not provably unchanged. Independent Action Compilation and AgentMind work may overlap, and directly grounded reactions may overlap onset perception. Ordinary positive-time steps continue to update every decision-eligible autonomous Agent.

The optimization must not change Truth authority, Agent-local cognition, Observation permissions, causal ordering, RNG consumption, or atomic rollback behavior. Unknown or ambiguous impact always falls back to recomputation.

## Contract

Admission computes a deterministic impact proof by comparing the pre-admission and post-admission Agent perspective and pending-observation inputs after removing only execution metadata that is not cognitive state. An Agent with no prepared action, a changed perspective, changed pending observations, changed control marker, invalid local target binding, or an inconclusive proof is invalidated. A proven unaffected Agent retains the same action draft through an engine-generated current-revision action identity.

Admission commits retain the complete old-action invalidation ledger and persist the engine-generated reused actions. Reused actions preserve actor, text, goal, means, and local targets; only runtime identity and base revision are rebased. Canonical validation independently verifies the mapping and uniqueness.

During preparation, known actions (external submissions and proven retained actions) may compile concurrently with resumed AgentMind work. Dynamic actions are compiled after their AgentMind results. Compilation results, audits, and errors are merged deterministically; any failure rolls back the whole step.

Reaction candidates with an existing shared-placement or authorized-fact basis may run AgentMind reaction concurrently with onset perception. Candidates requiring a perception check wait for the completed perception transcript. Request identities and order remain deterministic, and perception commitment rounds remain serial.

The optimization does not skip ordinary post-resolution AgentMind updates. Background work is optional, source-hash scoped, and cannot affect an in-flight step.

## Plan

Add a pure admission-impact proof and action rebase in the canonical admission path. Split known and dynamic preparation actions and overlap their model calls. Partition direct and perception-dependent reactions and overlap only the independent branch. Add stable overlap telemetry and retain the existing fail-closed dependency normalizer. Benchmark slot limits and role profiles separately; do not raise global scheduler concurrency as a latency fix.

## Verification

Prove reuse, invalidation, rebase identity, replay, and fail-closed behavior with deterministic admission fixtures. Use a latch-controlled model provider to prove compile/resume and direct-reaction/perception overlap while preserving output ordering and atomic failure. Compare optimized and baseline semantic hashes, RNG, observations, belief/character state, and replay. Run the live slot/profile matrix with a thirty-call ceiling and record p50/p95 stage critical paths.

## Evidence

- Admission proof, rebase, replay, and fail-closed coverage: [`admission-impact.ts`](../../src/engine/runtime/admission-impact.ts) and [`admission-impact.test.ts`](../../src/engine/runtime/__tests__/admission-impact.test.ts).
- Compile/resume overlap and deterministic action merging: [`eager-reference.ts`](../../src/engine/algorithms/eager-reference/eager-reference.ts) and [`eager-reference.test.ts`](../../src/engine/algorithms/eager-reference/__tests__/eager-reference.test.ts).
- Canonical admission validation and replay: [`transaction.ts`](../../src/engine/runtime/transaction.ts), [`canonical-committer.ts`](../../src/engine/runtime/canonical-committer.ts), and the runtime admission tests.
- Configured Reaction/Grounding worker limits and perception rating constraints: [`eager-reference.ts`](../../src/engine/algorithms/eager-reference/eager-reference.ts), [`prompts.ts`](../../src/engine/contracts/prompts.ts), and [`truth-engine.ts`](../../src/engine/mechanics/truth-engine.ts).
- Verified with `npm run check:fast` (314 unit tests, world validation, prompt/workflow checks, and six governance gates).
