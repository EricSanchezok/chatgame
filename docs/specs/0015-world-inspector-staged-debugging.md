# World Inspector Staged Debugging and Replay

Artifact-Version: 1
Status: Approved

## Intent

Provide a server-controlled single-step mode for every world evolution trigger and make the trusted Inspector explain execution order, failures, semantic causality, and recorded replay without changing world semantics, model ownership, cognitive isolation, or atomic commit rules.

## Contract

An instance may enable `debugSteppingEnabled`. The setting applies to the next WorldRun and all manual, batch, realtime, and participant-action boundaries in that run. A debug run pauses before its first logical stage and after every logical stage. A model transport request is never interrupted in flight.

The fixed logical stages are input/roster, action compilation, grounding/resource admission, reaction/perception, temporal boundary/dependency analysis, Truth resolution/plan verification, transition/mechanics/causal verification, observation/AgentMind, canonical validation, and atomic commit. Parallel invocations are one logical stage; physical transport attempts remain nested evidence.

Before atomic commit, debug checkpoints never advance canonical revision, world time, Activity state, resource allocation, or Agent cognition. Checkpoints are content-addressed, schema-versioned artifacts containing source hashes, run generation, boundary and stage identity, event ranges, prior artifact references, and an engine-validated continuation envelope. Missing or invalid checkpoint evidence invalidates the preparation without advancing the world.

`PUT /api/instances/:id/debug` changes the instance setting with an expected revision. `POST /api/instances/:id/run/next` advances exactly one checkpoint using run generation, checkpoint ID, and idempotent request ID. Stale controls return a conflict. A public run exposes debug status, boundary/stage cursor, checkpoint ID, and whether the next action is available.

Inspector invocation order is boundary, logical stage, logical invocation ordinal, then Ledger sequence. Calls are grouped Run → Boundary → Stage → Logical invocation → Transport attempt. The graph defaults to a semantic projection scoped to the selected attempt or step; a technical evidence projection remains available. The flow view includes failed attempts even without committed revisions.

Recorded replay is read-only, never calls a model or network, and never mutates canonical state. New executions replay checkpoint artifacts; older executions derive approximate frames from persisted event phases and mark them as derived. Replay supports indexed seek, previous/next, play/pause, speed controls, and keyboard navigation while keeping calls, graph, and detail on one frame.

## Plan

Add engine-owned stage lifecycle and checkpoint continuation support, extend WorldRun and instance runtime contracts, add control routes, then upgrade Inspector projections and UI. Bump World API, Inspector API, runtime event, and WorldInstance schema versions forward-only; remove obsolete ordering and timeline paths rather than retaining compatibility branches.

## Verification

Cover stage order under parallel calls and retries, checkpoint CAS and idempotency, no pre-commit mutation, reaction windows, restart recovery, invalid artifacts, disabled-mode parity, replay without model calls, semantic graph collapse, failed-attempt flow, accessible controls, and responsive layout. Run focused Vitest/API/WorldHost/Inspector suites, `npm run check:fast`, `npm run build`, bundled-world validation, governance gates, and `git diff --check`.

## Evidence

Pending implementation. Permanent evidence will link the stage/checkpoint runtime tests, WorldHost/API tests, Inspector projection tests, replay tests, and UI interaction tests.
