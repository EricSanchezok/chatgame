# System architecture

Living World Engine maintains one canonical world and multiple Agents with private cognition. Humans, models, scripts, and replay are policy sources for the same Agent abstraction; a Participant belongs to the product access layer, not to a second kind of simulation subject.

## Module boundaries

| Layer | Location | Responsibility |
|---|---|---|
| World contract | `src/script/` | Read schema v12 world packages, validate temporal/mechanics profiles and assets, and construct `WorldDefinition` and `SimulationState` v12 |
| Execution algorithm | `src/engine/eager-reference.ts`, `action-dependency.ts`, `temporal-planner.ts` | Orchestrate eligible policies while focused owners generate dependencies, plan temporal activities, validate footprints, and apply reaction replacements |
| Fixed kernel | `src/engine/canonical-committer.ts` | Validate Candidate v3, interaction coverage, temporal boundaries, cognitive isolation, causality, conservation, replay evidence, and atomic state construction |
| Model gateway | `src/engine/model-*` | Profiles, provider adapters, strict structured output, fair scheduling, and invocation audit |
| Instance host | `src/server/world-host.ts` | `WorldInstanceDocument` v17, pinned `AlgorithmRef`, persistent WorldRuns, Participants, decision/reaction windows, preparation artifacts, leases, recovery, and generation fencing |
| Execution evidence | `src/server/execution-ledger.ts` | The sole persisted source for executions, events, artifacts, experiments, replay, and Inspector data |
| HTTP and browser | `src/app/` | API v10, world library, assistant-ui sessions, decision/reaction controls, unified Agent Perspective HUD, control orb, and read-only Inspector v4 |
| Shared contracts | `src/shared/` | Browser-safe DTOs and trusted-local Inspector DTOs |

Dependencies flow browser → Route Handler → WorldHost → SimulationEngine → WorldExecutionAlgorithm → CanonicalCommitter. WorldHost resolves the instance-pinned algorithm through the internal registry, and replay resolves the recorded producer through the same mechanism. An algorithm returns candidates but never holds authority to mutate canonical state or define stable telemetry. The engine and world YAML load only on the server.

## State and policies

`SimulationState` contains the sole `CanonicalWorldState`, Agents, admission commits, and semantic history. Canonical truth owns the world clock, durable Activities, WorldTimers, mechanics, and ordinary world facts. Every `AgentState` binds one active Entity and owns an independent `AgentBeliefState`, `AgentCharacterState`, epistemic bindings, observation cursor, and next action. The closed-loop state combines world state with all private Agent control state. `projectAgentPerspective` derives the same policy-independent, de-identified read model for AgentMind, reaction, grounding, Observation rendering, Arrival, Participant, and Observer without persisting another state.

`PolicyBinding` selects `model | external | idle | replay` for every Agent. External control does not create a PlayerState; the Agent's position, identity, history, and private observations remain unchanged. AgentMind does not run during external control and does not infer a human's beliefs, emotions, or next action. Release may move the Agent to idle or let AgentMind consume observations received during control before restoring model policy.

Models produce semantic drafts only. Agent, Entity, Fact, Meter, Rating, Condition, and subject-private cognition records use world semantic IDs. The engine deterministically assigns runtime identities for actions, Resolution Plans and Receipts, TemporalPlans, Activities, checks, random draws, mechanics, events, outcomes, observations, and apparent claims. It materializes revisions, steps, phases, lifecycle, progress, clock deltas, provenance, Profiles, and timestamps.

## `eager-reference@4`

The reference algorithm deliberately spends complete work to provide a precise semantic baseline:

1. A model or external Agent supplies a new action only at an engine-owned decision point. An occupied Agent keeps its durable Activity and does not run ordinary AgentMind merely because another Activity reaches a boundary.
2. Every new action independently selects one script-declared Temporal Profile. The engine verifies explicit quantities, materializes a durable Activity with an interaction footprint and continuation assertions, and enforces declared resource capacity.
3. New actions are grounded before boundary selection. Their read/write/audience dependencies are queried against an ephemeral exact Activity footprint index; shared placement, a relational accessible Fact or successful perception evidence, interruptibility, and positive remaining duration determine a frozen onset-reaction set.
4. One finite reaction round applies model, external, replay, or profile-fallback decisions. `keep` preserves or pauses/cancels the ongoing Activity as declared; `replace` starts a separately planned Activity at the current world time. Replacement dependencies may force global readjudication but never open a recursive reaction round.
5. The algorithm then selects the unique earliest positive boundary across new and replacement Activities, existing Activities, Timers, Condition expiries, assertion boundaries, and the safety horizon.
6. Action, Activity, Timer, and Condition dependencies form the conflict graph. Due actions are adjudicated in connected components; context-only nodes constrain those components without inventing ActionOutcomes. Actual out-of-footprint access or a cross-component write triggers one global readjudication.
7. Every due or affected ongoing Activity receives a validated `ActivityDisposition`. Continuation assertions are checked at creation and around affected transitions; an Agent cannot simultaneously retain an active Activity and receive a decision point.
8. Observation Renderer fills engine-owned observer slots. Only Agents at a new decision point run AgentMind, and external reaction requests pause at a persisted `WorldStepPreparation` rather than keeping an execution open.
9. CanonicalCommitter independently rebuilds the boundary, generic interaction evidence, affected Activity set, dispositions, assertions, and one global candidate before constructing state. Instance CAS and the completion execution terminal record commit in one SQLite transaction.

A model, validation, cancellation, or persistence failure never advances the revision. The failed execution and any acquired request, response, and validation evidence remain in the Execution Ledger.

## World Instance and Participant

`WorldInstanceDocument` stores canonical state, its exact `AlgorithmRef`, multiple Participants, every Agent's policy binding, one discriminated decision or reaction ActionWindow, runtime settings, scheduler state, persistent WorldRuns, Participant intents, reaction submissions, and execution references. Changing the host default affects only newly created instances; a missing pinned algorithm fails before model work or state mutation. Product entry points allow one active Participant; the internal state and collection protocols support multiple Participants.

Manual Observer advance commits one temporal boundary; batch requests a boundary count; realtime only schedules wall-clock wakeups. A decision window includes external Agents at a decision point. A reaction window includes only the private stimulus for an external Agent whose ongoing intent can still respond. Window ID, stable generation, prepared-step ID, base revision, idempotent submission ID, and instance generation fence stale writes without serializing independent Participants' answers.

One Participant intent owns a persistent WorldRun that can commit multiple boundaries. Runs include `awaiting-reaction` and `preparation-invalidated` alongside the decision, execution, pause, completion, failure, and budget states. A reaction preparation finishes normally without a commit revision after its content-addressed artifact, frozen roster/request hashes, and window are atomically stored. Completion uses a child execution. Timeout applies the Activity profile fallback; restart does not rerun preparation, and a mismatch keeps canonical state unchanged until an explicit resume starts a fresh preparation.

Optional `participation.yaml` declares Origins and static images. An Origin fixes background, spawn point, an Entity Mechanics Profile, relationship hooks, risks, managed Profile, and fallback arrival text; the human supplies display name, appearance, and free-form motivation. A normal new game creates an Agent with its full Meter, Quantity, and Rating state from that profile. At a revision boundary, Observer may take control of any living idle Agent. Arrival Generator reads only that Agent's authorized private perspective and returns arrival narration plus three editable suggestions; it never produces world operations.

A Participant session projects persisted Arrival, Participant intent, every committed boundary Observation, world time, authorized Activity progress, and WorldRun state rather than storing a second message truth. Participant `controlledView` and Observer `selected.perspective` expose the same revision-scoped `AgentPerspectiveView`; changing `PolicyBinding` does not change its contents. During automatic execution the composer becomes a run console with pause/resume; after pause, an ordinary natural-language action may cancel or replace the Activity through semantic adjudication. WorldInspector uses a separate trusted-local projection with complete temporal and resolution evidence.

## World identity and persistence

Normalized world content receives a SHA-256 covering the manifest, laws, mechanics, entities, participation configuration, and static-asset identities. An instance pins its `WorldRuntimeContract` and world content hash, and reconstruction verifies both against the content-addressed version.

World versions, instances, and the Execution Ledger live in `LIVINGWORLD_DATA_ROOT/livingworld.sqlite`. The default v17 directory is `.livingworld-v17/`. SQLite uses WAL, `synchronous=FULL`, strict tables, process leases, write transactions, and generation compare-and-swap. Old schemas are not migrated; a different contract uses a new data root.

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
- Algorithms can emit only declared diagnostics; runtime event schema v2, stable lifecycle events, metric dimensions, and aggregation semantics remain engine-owned.

World package, runtime, presentation, benchmark, and Ledger details live in [Script format](game-design/script-format.md), [Engine runtime](game-design/engine-runtime.md), [Presentation](game-design/presentation.md), [Causal Activity benchmark](game-design/causal-activity-benchmark.md), and [Runtime observability](game-design/runtime-observability.md). Architectural rationale lives in [0061](decisions/0061-unified-agent-and-external-policy.md), [0063](decisions/0063-eager-reference-execution.md), [0064](decisions/0064-conversation-core-and-agent-perspective-observer.md), [0067](decisions/0067-open-semantic-resolution-plans.md), [0068](decisions/0068-unified-agent-perspective.md), [0070](decisions/0070-event-boundary-temporal-runtime.md), [0071](decisions/0071-pin-algorithms-and-own-telemetry-in-the-engine.md), and [0073](decisions/0073-stage-reactions-before-temporal-boundary-selection.md).

## Change procedure

1. Trace the current owners of the affected flow.
2. Obtain an Approved [Spec](specs/README.md) for a risk-boundary change.
3. Record a [decision](decisions/README.md) only when genuine alternatives exist.
4. Update this map and the owning product specification in the same change.
5. Run the governance gates and the smallest sufficient behavior evidence.
