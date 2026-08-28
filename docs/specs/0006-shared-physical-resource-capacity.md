# Shared physical-resource capacity

Artifact-Version: 1
Status: Approved

## Intent

Extend causal Activities with script-owned, canonical capacity for physical resources that several Agents may use at once. A horse, workbench, boat, seat, treatment station, or other world-authored resource must not be over-allocated merely because each actor's foreground Activity is individually valid.

The engine keeps independently planned action time, one positive canonical time advance, sparse causal activation, cognitive isolation, and open natural-language semantics. It adds typed resource pools, atomic claims, FIFO waiting, authored contention policy, trusted inspection, and commit-time capacity enforcement. It does not add domain action classes, model-authored capacity, wall-clock queue order, zero-time canonical commits, migration paths, or a second narrative event system.

## Contract

World mechanics retain per-Agent `activity_resources` and add `shared_activity_resources`. Each shared definition has a semantic ID, localized name, unit, positive default claim amount, whether an action may supply an explicit quantity, `contention: reject | queue | adjudicate`, and `paused_retention: retain | release`. Canonical Entities opt into a definition and declare non-negative capacity. The loader deterministically derives each pool ID from the world hash, definition ID, and Entity ID; an open Fact cannot create or modify hard capacity.

Grounding produces one `InteractionDependency` containing the existing read, write, audience, participant, and fallback footprint plus normalized shared-resource claims. This is one grounding pass, not another model call. A claim amount may come only from the definition default, a definition-authorized explicit quantity verifiably present in the action, or a trusted mechanic result. A model-proposed amount without one of those bases is invalid.

An Activity is a discriminated union:

- `scheduled` owns an independently validated `TemporalPlan`, boundaries, progress, its persisted footprint, and all granted claims.
- `queued` owns a validated plan draft, claims, footprint, and simulated enqueue time, occupies the Agent's foreground, but owns no shared capacity.
- `ready` owns an atomic reservation for all claims but has no simulated schedule or progress yet.

Queue order is `(enqueuedAtSeconds, activityId)`. Releasing claims promotes waiting Activities by connected resource-pool component. A component stops at its first unsatisfied queue head; it cannot skip that Activity, partially reserve its claims, or block an unrelated resource component. A promoted Activity becomes `ready` in the releasing positive-time commit. On the next ordinary positive-time step it revalidates continuation assertions, materializes its `TemporalPlan` from the then-current canonical time, and begins without progress credited for time spent waiting. Invalid `ready` work is blocked, releases its reservation, and advances the next queue head in that same positive-time commit.

Allocation first accounts for scheduled holders, paused Activities whose definitions retain claims, and `ready` reservations. Claims for one Activity are all-or-nothing. When capacity is insufficient, `reject` deterministically blocks the proposal without asking Truth to overrule capacity; `queue` creates a queued Activity; `adjudicate` puts the proposal, relevant holders, affected Activities, and permitted reactions in one Truth component. An adjudicated proposal may start only if the same candidate legally releases or reduces enough existing claims. For mixed policies the routing priority is `adjudicate`, then `queue`, then `reject`, while every pool's hard capacity remains independently mandatory.

Terminal dispositions always release claims. A paused Activity retains or releases each claim according to that resource definition; resuming a released claim re-enters its contention policy. Retiring a resource Entity or reducing capacity is valid only when the same candidate dispositions or releases holders so the proposed state remains capacity-legal. Capacity changes use a dedicated causally authorized operation guarded by assertions.

`prepareStep` includes new actions, due Activities, Timers, Conditions, and `ready` entries as generic interaction nodes. The exact index adds resource-pool keys to footprint, participant, and audience keys and computes a fixed-point affected closure. `globalFallback` includes all active interactions without running unrelated AgentMind policies. Resource release, queue promotion, final dispositions, and canonical mutation commit atomically.

The CanonicalCommitter independently reconstructs pools, authorized capacities, holders, reservations, claim provenance, queue order, releases, and final totals from canonical input plus the candidate. It rejects unknown pools, fabricated or invalid quantities, over-capacity, partial allocation, queue jumping, unauthorized capacity changes, and continued use of retired resources without changing canonical state.

External onset reactions reuse the persisted ReactionWindow preparation. Waiting changes neither revision, world time, allocation, nor queue order. A stable generation lets each participant submit once without invalidating other participants. Stale revision, mismatched preparation hash, duplicate submission, or illegal replacement is a conflict. Missing, corrupt, or algorithm-incompatible evidence yields `preparation-invalidated`; only explicit retry may spend model work to prepare again.

Public Activity projections expose `scheduled | queued | ready`, queue position, and resource names only when known to the controlled Agent. They never reveal another holder's canonical identity through ordinary APIs. The trusted Inspector exposes full pool capacity, holders, reservations, queues, claim provenance, contention decisions, and validation evidence. Blocking, enqueue, reservation, acquisition, and contention outcomes flow through the ordinary Observation Renderer and conversation projection.

This forward-only boundary replaces world and Simulation schema 12 with 13, WorldInstance schema 17 with 18, WorldStepCandidate schema 3 with 4, preparation schema 1 with 2, execution contract 3 with 4, `eager-reference@4` with `eager-reference@5`, World API 10 with 11, and Inspector API 4 with 5. Runtime data moves to `.livingworld-v18/`. Earlier worlds, instances, candidates, preparations, and pinned algorithms are rejected; no migration or dual reader is retained.

## Plan

First land the resource definition, Entity-pool, claim, Activity-state, and versioned loader contracts. Then add exact affected-set indexing, the atomic allocator and queue transitions, and independent committer validation. Integrate Host persistence and recovery, public and trusted projections, Participant UI, reference-world fixtures, and observation rendering only after the kernel contract passes. Finish with production-index/oracle comparison, resource-density benchmarks, browser flows, accessibility checks, and current-state documentation.

Each independently verifiable unit receives targeted checks and an immediate local commit. The implementation removes superseded paths instead of preserving schema compatibility.

## Verification

Exercise a unique horse with `reject`, a single workbench with FIFO `queue`, a unique boat with `adjudicate`, and a capacity-four vehicle with a fifth claimant. Prove all-or-nothing acquisition for multi-resource work, component-local head-of-line blocking, start-time reset after waiting, and correct pause retain/release, cancellation, assertion invalidation, capacity decrease, resource retirement, and queue-head cancellation.

Hand-construct candidates with over-capacity totals, queue jumping, unknown pools, false explicit quantities, partial grants, unauthorized capacity changes, and holders that lack dispositions; the committer must reject each with identical pre/post canonical hashes. Exercise external reaction wait, partial and duplicate submissions, timeout, restart, corrupt evidence, stale generation, Truth failure, and persistence failure without mutation before the final atomic commit.

Compare the production index and allocator with exhaustive test oracles across 1, 10, 50, and 1000 Agents, independent/sparse/dense/global dependencies, and varied contention density. Affected-Activity recall and semantic agreement must be 100%; irrelevant occupied-Agent model calls, partial allocations, and capacity violations must be zero. Record indexing time, memory, model calls, tokens, queue length, component size, and artifact bytes without an unstable wall-clock CI threshold.

Run targeted Vitest projects, real WorldHost and API tests, Blackmarsh and schema-fixture validation, replay-hash tests, Inspector tests, the production build, relevant browser and accessibility flows, `npm run check:fast`, `node scripts/run-gates.mjs`, and `git diff --check`.

## Evidence

Pending implementation. The selected allocation architecture is recorded in [decision 0074](../decisions/0074-enforce-script-owned-shared-resource-pools.md), and the causal interaction baseline is [Spec 0005](0005-causal-activity-interactions.md).
