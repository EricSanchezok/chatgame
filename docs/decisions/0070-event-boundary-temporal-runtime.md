# Use event boundaries and durable activities for world time

## Status

Accepted
Class: architecture

## Context and Problem Statement

The runtime currently attaches one caller-selected positive simulated duration to a global world step. The same boundary therefore acts as atomic revision, action duration, policy decision cadence, and realtime scheduling cadence. A one-second strike and a multi-hour journey receive the same elapsed time, while a long action has no canonical partial progress, interruption point, or engine-owned completion boundary. Asking a model to choose raw seconds would make deadlines, concurrency, and final effects depend on untrusted output.

The open-semantic resolution contract already separates semantic planning from deterministic numeric settlement. Temporal behavior needs the same ownership split while preserving arbitrary natural-language action, script-defined worlds, joint action adjudication, cognitive isolation, replay, and an exact eager baseline for later sparse algorithms.

## Decision Drivers

- Action duration and world time must be canonical, replayable, and engine-owned.
- Unequal-duration actions must coexist without global fixed ticks or semantic teleportation.
- Arbitrary actions remain playable without hard-coded genre classes.
- Completion effects, random commitments, deadlines, and interruptions must retain causal and atomic guarantees.
- Occupied Agents deliberate only at semantic decision points, without making the reference implementation approximate.
- Long Participant intent must remain observable, pausable, resumable, and process-recoverable.
- Realtime scheduling and simulated time must be independent.

## Considered Options

- Keep one fixed simulated duration per global step and tune it by world or scene.
- Let Truth choose a raw duration for every natural-language action.
- Add dedicated engine subsystems for travel, combat, treatment, rest, and other known domains.
- Use precommitted temporal plans, durable generic activities, and earliest-event boundary selection.

## Decision Outcome

Living World Engine uses a positive integer world clock advanced to the earliest committed temporal boundary. Canonical Activities carry persistent action process, stage, progress, checkpoints, interruption policy, and script-declared resource claims. Canonical Timers carry future semantic triggers without carrying future state writes. Every trigger due at the same timestamp is jointly resolved, and every semantic commit receives one kernel-injected `advance_time` equal to the selected boundary delta.

An action receives a precommitted `TemporalPlan`. Exact time and rate values come only from verifiable explicit quantities, authored named temporal policies, or trusted versioned rule results. Semantic planning selects and explains those inputs; it cannot author raw seconds, clock writes, final progress, or completion effects. Fixed, rate, staged, conditional, absolute-time, and open-ended shapes share this contract. A world may describe genre-specific calibrations, but the engine has no genre-specific Activity type.

Decision eligibility becomes an engine fact. A continuing Activity does not generate a replacement action and its Agent does not run AgentMind. Completion, failure, blockage, invalidated premises, relevant observations, external interaction, and script policy create decision points. Eager reference remains exact by processing every due Activity, Timer, action, observer, and decision point; later activity-proportional algorithms may reduce work only when equivalence to this baseline is preserved.

Participant intent is executed by a persistent WorldRun that can span revisions. Pause aborts only the uncommitted attempt, fencing late results with generation and revision CAS. Resume preserves the Activity. Runtime commit and wall-time leases pause safely instead of changing simulated behavior. Process recovery keeps canonical progress and requires explicit resume. Realtime interval wakes the host but never determines the simulated delta.

The fixed-step request and one-action/one-step conversation contract are removed at the forward-only schema boundary. `max_autonomous_span_seconds` remains only as a safety boundary when no earlier Activity, Timer, Condition, deadline, or authored checkpoint exists.

## Pros and Cons of the Options

### Fixed global duration

- Good: minimal state and a simple scheduler.
- Bad: conflates unrelated clocks, gives unequal actions identical duration, repeatedly deliberates occupied Agents, and cannot preserve long-action progress.

### Model-authored duration

- Good: covers unforeseen semantics with little engine code.
- Bad: raw time becomes nondeterministic and manipulable; concurrent events, deadlines, replay, and completion effects cannot be uniquely validated.

### Domain-specific action systems

- Good: known genres can receive precise formulas and UI quickly.
- Bad: the core accumulates Travel, Weapon, Healing, and similar classes, contradicting script-driven generality while still failing on unforeseen actions.

### Temporal plans and event boundaries

- Good: time ownership, progress, interruption, replay, and unequal concurrency use one generic strict contract; scripts and rule packages retain domain authority.
- Bad: adds persistent process state, scheduler and host coordination, more complex replay evidence, and a semantic profile-selection surface that still requires independent verification.

## Links

- [Approved event-boundary temporal runtime Spec](../specs/0003-event-boundary-temporal-runtime.md)
- [0004 — Game-first principles](0004-game-first-principles.md)
- [0059 — Unified execution kernel and Ledger](0059-unified-execution-kernel-and-ledger.md)
- [0061 — Unified Agent and external policy](0061-unified-agent-and-external-policy.md)
- [0063 — Eager-reference execution](0063-eager-reference-execution.md)
- [0064 — Conversation core and Agent-perspective Observer](0064-conversation-core-and-agent-perspective-observer.md)
- [0067 — Open semantic resolution plans](0067-open-semantic-resolution-plans.md)
