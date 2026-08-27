# System architecture

Living World Engine maintains one canonical world and multiple Agents with private cognition. Humans, models, scripts, and replay are policy sources for the same Agent abstraction; a Participant belongs to the product access layer, not to a second kind of simulation subject.

## Module boundaries

| Layer | Location | Responsibility |
|---|---|---|
| World contract | `src/script/` | Read schema v9 world packages, validate assets, and construct `WorldDefinition` and `SimulationState` v9 |
| Execution algorithm | `src/engine/eager-reference.ts` | Activate all policies, ground each action, adjudicate conflict components, batch observations, and update AgentMind |
| Fixed kernel | `src/engine/canonical-committer.ts` | Validate candidates, cognitive isolation, causality, conservation, complete coverage, and atomic state construction |
| Model gateway | `src/engine/model-*` | Profiles, provider adapters, strict structured output, fair scheduling, and invocation audit |
| Instance host | `src/server/world-host.ts` | `WorldInstanceDocument` v13, Participants, ActionWindow, session projections, scheduling, and generation fencing |
| Execution evidence | `src/server/execution-ledger.ts` | The sole persisted source for executions, events, artifacts, experiments, replay, and Inspector data |
| HTTP and browser | `src/app/` | API v7, world library, assistant-ui sessions, Agent-perspective Observer, control orb, and read-only Inspector |
| Shared contracts | `src/shared/` | Browser-safe DTOs and trusted-local Inspector DTOs |

Dependencies flow browser → Route Handler → WorldHost → SimulationEngine → WorldExecutionAlgorithm → CanonicalCommitter. An algorithm returns candidates but never holds authority to mutate canonical state. The engine and world YAML load only on the server.

## State and policies

`SimulationState` contains the sole `CanonicalWorldState`, Agents, admission commits, and semantic history. Every `AgentState` binds one active Entity and owns an independent `AgentBeliefState`, `AgentCharacterState`, epistemic bindings, and next action. The closed-loop state combines world state with all private Agent control state.

`PolicyBinding` selects `model | external | idle | replay` for every Agent. External control does not create a PlayerState; the Agent's position, identity, history, and private observations remain unchanged. AgentMind does not run during external control and does not infer a human's beliefs, emotions, or next action. Release may move the Agent to idle or let AgentMind consume observations received during control before restoring model policy.

Models produce semantic drafts only. Agent, Entity, Fact, Meter, Rating, and subject-private cognition records use world semantic IDs. The engine deterministically assigns runtime identities for actions, checks, random draws, mechanics, events, outcomes, observations, and apparent claims. It materializes revisions, steps, phases, lifecycle, provenance, Profiles, and timestamps.

## `eager-reference@1`

The reference algorithm deliberately spends complete work to provide a precise semantic baseline:

1. Every model Agent uses a prepared action, every external Agent uses its ActionWindow submission, and every idle or timed-out Agent receives an engine-generated typed noop.
2. Each action is grounded independently; private cognition enters only that action's context. Grounding returns a conservative read/write/audience footprint, and uncertain dependencies enter the global fallback.
3. Footprints form a conflict graph. Connected components independently perform perception, reaction routing, resolution, random commitment, and transition; an actual out-of-footprint access or cross-component dependency triggers global readjudication.
4. Truth transition emits outcomes, mechanics, operations, events, and decision requests. The engine injects the one positive `advance_time` operation.
5. Observation Renderer fills fixed observer slots whose count, observer, step, kind, and persisted identity are engine-owned. After component merge, the complete candidate produces one permission-limited global projection for every Agent; batching respects the Observation Profile input-byte budget.
6. All model Agents run AgentMind concurrently; external and idle Agents receive only their own Observation.
7. CanonicalCommitter performs one global validation and constructs the next state. Instance CAS and the execution terminal record commit in one SQLite transaction.

A model, validation, cancellation, or persistence failure never advances the revision. The failed execution and any acquired request, response, and validation evidence remain in the Execution Ledger.

## World Instance and Participant

`WorldInstanceDocument` stores canonical state, multiple Participants, every Agent's policy binding, one ActionWindow, runtime settings, scheduler state, advance records, and execution references. Product entry points allow one active Participant; the internal state and action collection support multiple Participants.

An instance with no Participant can advance by step, batch, or realtime. When an external Agent exists, advancing opens one ActionWindow at the current revision. Execution begins when all required Agents submit idempotently; missing slots become typed timeout noops at the deadline. Window ID, generation, base revision, and instance generation reject duplicates and stale writes.

The scheduler serializes each instance. Realtime schedules the next trigger only after the prior step completes. Pausing or restarting increments generation so stale timers expire. Process recovery schedules from the current time and never replays an offline backlog. Batch stops at a recoverable boundary when it encounters an external ActionWindow.

Optional `participation.yaml` declares Origins and static images. An Origin fixes background, spawn point, resources, relationship hooks, risks, managed Profile, and fallback arrival text; the human supplies display name, appearance, and free-form motivation. A normal new game creates an Agent from an Origin. At a revision boundary, Observer may take control of any living idle Agent. Arrival Generator reads only that Agent's authorized private perspective and returns arrival narration plus three editable suggestions; it never produces world operations.

A Participant session projects persisted Arrival, Participant intent, advance, and committed Observation rather than storing a second message truth. Observer projects read-only messages from the selected Agent's action, Observation, character, and belief. WorldInspector uses a separate trusted-local projection.

## World identity and persistence

Normalized world content receives a SHA-256 covering the manifest, laws, mechanics, entities, participation configuration, and static-asset identities. An instance pins its `WorldRuntimeContract` and world content hash, and reconstruction verifies both against the content-addressed version.

World versions, instances, and the Execution Ledger live in `LIVINGWORLD_DATA_ROOT/livingworld.sqlite`. SQLite uses WAL, `synchronous=FULL`, strict tables, process leases, write transactions, and generation compare-and-swap. Old schemas are not migrated; a different contract uses a new data root.

## Hard invariants

- Action text expresses an attempt, never a state delta.
- Every Agent appears exactly once in the policy roster, and every final joint action has exactly one outcome.
- Every step contains exactly one engine-injected positive time advance.
- Every living Agent receives exactly one outcome observation; private text uses observer-local IDs.
- Quantities conserve unless a world law authorizes production or consumption; Meters and Ratings remain in script ranges.
- Placement is acyclic; an Agent binds an active Entity and owns one self binding.
- Causes and assertions for operations, mechanics, events, and outcomes resolve and hold before writes.
- External Agents do not run AgentMind; model Agents and Agents created in the step commit exactly one mind update.
- Ordinary APIs never expose canonical truth, bindings, another Agent's cognition, model configuration, or internal error material.

World package, runtime, presentation, and Ledger details live in [Script format](game-design/script-format.md), [Engine runtime](game-design/engine-runtime.md), [Presentation](game-design/presentation.md), and [Runtime observability](game-design/runtime-observability.md). Architectural rationale lives in [0061](decisions/0061-unified-agent-and-external-policy.md), [0063](decisions/0063-eager-reference-execution.md), and [0064](decisions/0064-conversation-core-and-agent-perspective-observer.md).

## Change procedure

1. Trace the current owners of the affected flow.
2. Obtain an Approved [Spec](specs/README.md) for a risk-boundary change.
3. Record a [decision](decisions/README.md) only when genuine alternatives exist.
4. Update this map and the owning product specification in the same change.
5. Run the governance gates and the smallest sufficient behavior evidence.
