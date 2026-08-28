# System architecture

Living World Engine maintains one canonical world and multiple Agents with private cognition. Humans, models, scripts, and replay are policy sources for the same Agent abstraction; a Participant belongs to the product access layer, not to a second kind of simulation subject.

## Module boundaries

| Layer | Location | Responsibility |
|---|---|---|
| World contract | `src/script/` | Read schema v11 world packages, validate temporal/mechanics profiles and assets, and construct `WorldDefinition` and `SimulationState` v11 |
| Execution algorithm | `src/engine/eager-reference.ts` | Activate eligible policies, precommit temporal activities, adjudicate due conflict components, batch observations, and update eligible AgentMind |
| Fixed kernel | `src/engine/canonical-committer.ts` | Validate temporal boundaries and candidates, cognitive isolation, causality, conservation, replay evidence, and atomic state construction |
| Model gateway | `src/engine/model-*` | Profiles, provider adapters, strict structured output, fair scheduling, and invocation audit |
| Instance host | `src/server/world-host.ts` | `WorldInstanceDocument` v15, persistent WorldRuns, Participants, ActionWindow, leases, recovery, and generation fencing |
| Execution evidence | `src/server/execution-ledger.ts` | The sole persisted source for executions, events, artifacts, experiments, replay, and Inspector data |
| HTTP and browser | `src/app/` | API v9, world library, assistant-ui sessions, run controls, unified Agent Perspective HUD, control orb, and read-only Inspector |
| Shared contracts | `src/shared/` | Browser-safe DTOs and trusted-local Inspector DTOs |

Dependencies flow browser → Route Handler → WorldHost → SimulationEngine → WorldExecutionAlgorithm → CanonicalCommitter. An algorithm returns candidates but never holds authority to mutate canonical state. The engine and world YAML load only on the server.

## State and policies

`SimulationState` contains the sole `CanonicalWorldState`, Agents, admission commits, and semantic history. Canonical truth owns the world clock, durable Activities, WorldTimers, mechanics, and ordinary world facts. Every `AgentState` binds one active Entity and owns an independent `AgentBeliefState`, `AgentCharacterState`, epistemic bindings, observation cursor, and next action. The closed-loop state combines world state with all private Agent control state. `projectAgentPerspective` derives the same policy-independent, de-identified read model for AgentMind, reaction, grounding, Observation rendering, Arrival, Participant, and Observer without persisting another state.

`PolicyBinding` selects `model | external | idle | replay` for every Agent. External control does not create a PlayerState; the Agent's position, identity, history, and private observations remain unchanged. AgentMind does not run during external control and does not infer a human's beliefs, emotions, or next action. Release may move the Agent to idle or let AgentMind consume observations received during control before restoring model policy.

Models produce semantic drafts only. Agent, Entity, Fact, Meter, Rating, Condition, and subject-private cognition records use world semantic IDs. The engine deterministically assigns runtime identities for actions, Resolution Plans and Receipts, TemporalPlans, Activities, checks, random draws, mechanics, events, outcomes, observations, and apparent claims. It materializes revisions, steps, phases, lifecycle, progress, clock deltas, provenance, Profiles, and timestamps.

## `eager-reference@2`

The reference algorithm deliberately spends complete work to provide a precise semantic baseline:

1. A model or external Agent supplies a new action only at an engine-owned decision point. An active Activity supplies its committed source action only when due; occupied and idle Agents create neither replacement actions nor noops.
2. Every new action selects one script-declared Temporal Profile through the temporal planner. The engine verifies explicit quantities, materializes a durable Activity, enforces declared resource capacity, and chooses the earliest absolute Activity, Timer, Condition, or safety boundary.
3. Each due or newly supplied action is grounded independently; private cognition enters only that action's context. Grounding returns a conservative read/write/audience footprint, and uncertain dependencies enter the global fallback.
4. Footprints form a conflict graph. Connected components independently perform perception, reaction routing, precommitted ResolutionPlan construction, deterministic d20 derivation, random commitment, and transition; an actual out-of-footprint access or cross-component dependency triggers global readjudication.
5. Truth transition emits outcomes, semantic mechanics, operations, events, and decision requests. `core-resolution@2.0.0` settles persisted ResolutionReceipts and Condition duration. Continuing Activities may commit only progress already reached at the selected boundary; the engine injects the one positive `advance_time` equal to the boundary delta.
6. Observation Renderer fills engine-owned observer slots. Authorized observations accumulate after each Agent's observation cursor; an occupied Agent does not deliberate merely because another boundary committed.
7. Only Agents at a new decision point run AgentMind, consuming all authorized observations since their cursor. External Agents wait in ActionWindow and idle Agents do not run AgentMind.
8. CanonicalCommitter validates the temporal snapshot and one global candidate, then constructs the next state. Instance CAS and the execution terminal record commit in one SQLite transaction.

A model, validation, cancellation, or persistence failure never advances the revision. The failed execution and any acquired request, response, and validation evidence remain in the Execution Ledger.

## World Instance and Participant

`WorldInstanceDocument` stores canonical state, multiple Participants, every Agent's policy binding, one ActionWindow, runtime settings, scheduler state, persistent WorldRuns, Participant intents, and execution references. Product entry points allow one active Participant; the internal state and action collection support multiple Participants.

Manual Observer advance commits one temporal boundary; batch requests a boundary count; realtime only schedules wall-clock wakeups. ActionWindow includes only external Agents currently at a decision point. Execution begins when all required Agents submit idempotently; a Participant with an active Activity is not asked to resubmit at intermediate boundaries. Window ID, generation, base revision, and instance generation reject duplicates and stale writes.

One Participant intent owns a persistent WorldRun that can commit multiple boundaries. Runs move through queued, running, pausing, paused, awaiting-decision, completed, failed, and budget-paused states. A lease permits at most 100 commits or 15 minutes of wall time by default; exhaustion pauses without changing simulated time or cancelling the Activity. Pause aborts an uncommitted model attempt, generation/CAS rejects a late result, and resume creates a new lease. Process recovery converts inherited executing runs to `paused: process-recovered` and never spends model cost automatically.

Optional `participation.yaml` declares Origins and static images. An Origin fixes background, spawn point, an Entity Mechanics Profile, relationship hooks, risks, managed Profile, and fallback arrival text; the human supplies display name, appearance, and free-form motivation. A normal new game creates an Agent with its full Meter, Quantity, and Rating state from that profile. At a revision boundary, Observer may take control of any living idle Agent. Arrival Generator reads only that Agent's authorized private perspective and returns arrival narration plus three editable suggestions; it never produces world operations.

A Participant session projects persisted Arrival, Participant intent, every committed boundary Observation, world time, authorized Activity progress, and WorldRun state rather than storing a second message truth. Participant `controlledView` and Observer `selected.perspective` expose the same revision-scoped `AgentPerspectiveView`; changing `PolicyBinding` does not change its contents. During automatic execution the composer becomes a run console with pause/resume; after pause, an ordinary natural-language action may cancel or replace the Activity through semantic adjudication. WorldInspector uses a separate trusted-local projection with complete temporal and resolution evidence.

## World identity and persistence

Normalized world content receives a SHA-256 covering the manifest, laws, mechanics, entities, participation configuration, and static-asset identities. An instance pins its `WorldRuntimeContract` and world content hash, and reconstruction verifies both against the content-addressed version.

World versions, instances, and the Execution Ledger live in `LIVINGWORLD_DATA_ROOT/livingworld.sqlite`. SQLite uses WAL, `synchronous=FULL`, strict tables, process leases, write transactions, and generation compare-and-swap. Old schemas are not migrated; a different contract uses a new data root.

## Hard invariants

- Action text expresses an attempt, never a state delta.
- Every Agent appears exactly once in the policy roster, and every final joint action has exactly one outcome.
- Every step contains exactly one engine-injected positive time advance equal to its earliest temporal boundary delta.
- Activity completion effects cannot precede completion; unrelated earlier boundaries do not move an Activity's absolute checkpoint.
- Observation authorization and private text use observer-local IDs; only decision-eligible model Agents run AgentMind.
- Numeric writes are trusted-rule derived: Quantities use explicit provenance and conserve unless a world law authorizes production or consumption; Meter impacts clamp to script ranges; Ratings remain in script ranges.
- Every action pins one ResolutionPlan before resolution randomness, and every plan pins one deterministic ResolutionReceipt whose operations are part of the same atomic step.
- Placement is acyclic; an Agent binds an active Entity and owns one self binding.
- Causes and assertions for operations, mechanics, events, and outcomes resolve and hold before writes.
- External, idle, and occupied Agents do not run AgentMind; each eligible model Agent and Agent created in the step commits exactly one mind update.
- Ordinary APIs never expose canonical truth, bindings, another Agent's cognition, model configuration, or internal error material.

World package, runtime, presentation, and Ledger details live in [Script format](game-design/script-format.md), [Engine runtime](game-design/engine-runtime.md), [Presentation](game-design/presentation.md), and [Runtime observability](game-design/runtime-observability.md). Architectural rationale lives in [0061](decisions/0061-unified-agent-and-external-policy.md), [0063](decisions/0063-eager-reference-execution.md), [0064](decisions/0064-conversation-core-and-agent-perspective-observer.md), [0067](decisions/0067-open-semantic-resolution-plans.md), [0068](decisions/0068-unified-agent-perspective.md), and [0070](decisions/0070-event-boundary-temporal-runtime.md).

## Change procedure

1. Trace the current owners of the affected flow.
2. Obtain an Approved [Spec](specs/README.md) for a risk-boundary change.
3. Record a [decision](decisions/README.md) only when genuine alternatives exist.
4. Update this map and the owning product specification in the same change.
5. Run the governance gates and the smallest sufficient behavior evidence.
