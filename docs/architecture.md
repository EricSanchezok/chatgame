# System architecture

Living World Engine maintains one canonical world and multiple Agents with private cognition. Humans, models, scripts, and replay are policy sources for the same Agent abstraction; a Participant belongs to the product access layer, not to a second kind of simulation subject.

## Module boundaries

| Layer | Location | Responsibility |
|---|---|---|
| World contract | `src/script/` | Read schema v14 world packages, validate temporal/mechanics/resource profiles and assets, and construct `WorldDefinition` and `SimulationState` v14 |
| Execution algorithms | `src/engine/algorithms/` | Versioned algorithm definitions; `eager-reference/` owns Action Compilation, AgentMind, prompt call wiring, and slot batching while returning ordinary Candidates |
| Model gateway | `src/engine/models/` | Trusted provider accounts, models.dev snapshots, deterministic Profile resolution, protocol drivers, vendor dialects, external prompt bundles, strict structured output, fair scheduling, and invocation audit |
| Cognition | `src/engine/cognition/` | Agent perspective, private belief/character updates, observations, information boundaries, and mind commits |
| Mechanics | `src/engine/mechanics/` | Temporal, resolution, causality, random, interaction-dependency graphs, Truth Engine, rule packages, and shared-resource mechanics |
| Fixed runtime | `src/engine/runtime/` | Execution contract, SimulationEngine, CanonicalCommitter, transactions, lifecycle evidence, IDs, replay, and world runtime definitions |
| Prompt resources | `src/engine/prompts/` | Server-loaded English role/task/transport Markdown, content-addressed bundle versions, and unified task/context serialization |
| Shared contracts | `src/engine/contracts/` | Semantic state types, model-output schemas, and prompt/context contracts shared across owners |
| Benchmarks | `src/engine/benchmarks/` | Benchmark-only code and evidence generators kept off the product execution path |
| Instance host | `src/server/world-host.ts` | `WorldInstanceDocument` v19, pinned configured `AlgorithmRef`, persistent WorldRuns, Participants, decision/reaction windows, Preparation v4 artifacts, leases, recovery, and generation fencing |
| Execution evidence | `src/server/execution-ledger.ts` | The sole persisted source for executions, events, artifacts, experiments, replay, and Inspector data |
| HTTP and browser | `src/app/` | API v12, world library, assistant-ui sessions, decision/reaction controls, unified Agent Perspective HUD, control orb, and read-only Inspector v8 |
| Shared browser contracts | `src/shared/` | Browser-safe DTOs and trusted-local Inspector DTOs |

Dependencies flow browser → Route Handler → WorldHost → SimulationEngine → WorldExecutionAlgorithm → CanonicalCommitter. WorldHost resolves the instance-pinned algorithm through the internal registry, and replay resolves the recorded producer through the same mechanism. An algorithm returns candidates but never holds authority to mutate canonical state or define stable telemetry. The engine and world YAML load only on the server.

## State and policies

`SimulationState` contains the sole `CanonicalWorldState`, Agents, admission commits, and semantic history. Canonical truth owns the world clock, durable Activities, Entity-backed shared-resource pools, WorldTimers, mechanics, and ordinary world facts. Every `AgentState` binds one active Entity and owns an independent `AgentBeliefState`, `AgentCharacterState`, epistemic bindings, observation cursor, and next action. The closed-loop state combines world state with all private Agent control state. `projectAgentPerspective` derives the same policy-independent, de-identified read model for AgentMind, reaction, grounding, Observation rendering, Arrival, Participant, and Observer without persisting another state.

`PolicyBinding` selects `model | external | idle | replay` for every Agent. External control does not create a PlayerState; the Agent's position, identity, history, and private observations remain unchanged. AgentMind does not run during external control and does not infer a human's beliefs, emotions, or next action. Release may move the Agent to idle or let AgentMind consume observations received during control before restoring model policy.

Models produce semantic drafts only. Agent, Entity, Fact, Meter, Rating, Condition, and subject-private cognition records use world semantic IDs. The engine deterministically assigns runtime identities for actions, Resolution Plans and Receipts, TemporalPlans, Activities, shared-resource pools, checks, random draws, mechanics, events, outcomes, observations, and apparent claims. It materializes revisions, steps, phases, lifecycle, progress, clock deltas, provenance, Profiles, and timestamps.

## `eager-reference@9`

The reference algorithm deliberately spends complete work to provide a precise semantic baseline:

Action Compilation and AgentMind use private byte-aware slot batches inside the algorithm. Their immutable per-instance limits default to twelve and eight; independent Reaction and Action Grounding worker limits default to eight and sixteen. Truth Engine uses fixed twelve-slot batches for graph-proven independent resolution, plan verification, transition, causal verification, and observation work. All five limits remain configurable from one through sixty-four and participate in the manifest hash. Truth batches share the complete common world context once while keeping scoped responsibility in each slot; CanonicalCommitter, RNG/check commitment, privacy validation, and atomic commit remain unchanged. Each physical request has one audit, localized semantic failures retry only their slots, structural failures repair the current batch and then bisect it, context overflow is a hard error, and terminal provider errors propagate directly. The fixed engine, Gateway, Script schema, and CanonicalCommitter do not interpret these limits.

1. A model or external Agent supplies a new action only at an engine-owned decision point. An occupied Agent keeps its durable Activity and does not run ordinary AgentMind merely because another Activity reaches a boundary; a `ready` Activity supplies an engine-owned start trigger instead.
2. Every new action independently selects one script-declared Temporal Profile. The same grounding invocation produces read/write/audience dependencies and structured shared-resource claims; the engine verifies explicit quantities and persists the footprint as Activity evidence.
3. New actions are grounded before boundary selection. Their footprint and resource-pool keys are queried against an ephemeral exact Activity index; shared placement, an accessible relational Fact or successful perception evidence, interruptibility, and positive remaining duration determine a frozen onset-reaction set.
4. One finite reaction round applies model, external, replay, or profile-fallback decisions. `keep` preserves or pauses/cancels the ongoing Activity as declared; `replace` starts a separately planned Activity at the current world time. Replacement dependencies may force global readjudication but never open a recursive reaction round.
5. The allocator counts active holders, retaining pauses, and `ready` reservations. It grants every claim atomically or follows the strongest authored route: deterministic `reject`, stable FIFO `queue`, or joint `adjudicate`; the last route includes affected holders in the Truth component but cannot exceed hard capacity.
6. The algorithm selects the unique earliest positive boundary across admitted actions, existing and `ready` Activities, Timers, Condition expiries, assertion boundaries, and the safety horizon. Queued time never becomes Activity progress.
7. Action, Activity, Timer, and Condition dependencies form the conflict graph. The affected Activity set expands along persisted footprints to a fixed-point closure, then due actions are adjudicated in connected components; context-only nodes constrain those components without inventing ActionOutcomes. Actual out-of-footprint access or a cross-component write triggers one global readjudication.
8. Every due or affected ongoing Activity receives a validated `ActivityDisposition`. Terminal dispositions release claims before connected FIFO components promote satisfiable queue heads to `ready`; a promoted Activity starts from the then-current clock only on a later positive step after its assertions still hold.
9. Observation Renderer fills engine-owned observer slots for normal, blocked, queued, reserved, started, and contested outcomes. Only Agents at a new decision point run AgentMind, and external reaction requests pause at a persisted `WorldStepPreparation` rather than keeping an execution open.
10. CanonicalCommitter independently rebuilds the boundary, interaction evidence, claims, holder usage, admissions, queue order, promotions, affected Activity set, dispositions, assertions, and one global candidate before constructing state. Instance CAS and the completion execution terminal record commit in one SQLite transaction.

A model, validation, cancellation, or persistence failure never advances the revision. The failed execution and any acquired request, response, and validation evidence remain in the Execution Ledger.

## World Instance and Participant

`WorldInstanceDocument` stores canonical state, its exact configuration-bearing `AlgorithmRef`, multiple Participants, every Agent's policy binding, one discriminated decision or reaction ActionWindow, runtime settings, scheduler state, persistent WorldRuns, Participant intents, reaction submissions, and execution references. The registry treats algorithm configuration as opaque JSON and asks the matching algorithm definition to derive and verify the manifest. Changing the host default affects only newly created instances; restart and recorded replay use the pinned configuration, while a missing or mismatched algorithm fails before model work or state mutation. Product entry points allow one active Participant; the internal state and collection protocols support multiple Participants.

Manual Observer advance commits one temporal boundary; batch requests a boundary count; realtime only schedules wall-clock wakeups. A decision window includes external Agents at a decision point. A reaction window includes only the private stimulus for an external Agent whose ongoing intent can still respond. Window ID, stable generation, prepared-step ID, base revision, idempotent submission ID, and instance generation fence stale writes without serializing independent Participants' answers.

One Participant intent owns a persistent WorldRun that can commit multiple boundaries. Runs include `awaiting-reaction` and `preparation-invalidated` alongside the decision, execution, pause, completion, failure, and budget states. A reaction preparation finishes normally without a commit revision after its content-addressed artifact, frozen roster/request hashes, and window are atomically stored. Completion uses a child execution. Timeout applies the Activity profile fallback; restart does not rerun preparation, and a mismatch keeps canonical state unchanged until an explicit resume starts a fresh preparation.

Optional `participation.yaml` declares Origins and static images. An Origin fixes background, spawn point, an Entity Mechanics Profile, relationship hooks, risks, managed Profile, and fallback arrival text; the human supplies display name, appearance, and free-form motivation. A normal new game creates an Agent with its full Meter, Quantity, and Rating state from that profile. At a revision boundary, Observer may take control of any living idle Agent. Arrival Generator reads only that Agent's authorized private perspective and returns arrival narration plus three editable suggestions; it never produces world operations.

A Participant session projects persisted Arrival, Participant intent, every committed boundary Observation, world time, authorized Activity progress, and WorldRun state rather than storing a second message truth. Participant `controlledView` and Observer `selected.perspective` expose the same revision-scoped `AgentPerspectiveView`; changing `PolicyBinding` does not change its contents. During automatic execution the composer becomes a run console with pause/resume; after pause, an ordinary natural-language action may cancel or replace the Activity through semantic adjudication. WorldInspector uses a separate trusted-local projection with complete temporal and resolution evidence.

## World identity and persistence

Normalized world content receives a SHA-256 covering the manifest, laws, mechanics, entities, participation configuration, and static-asset identities. An instance pins its `WorldRuntimeContract` and world content hash, and reconstruction verifies both against the content-addressed version.

World versions, instances, and the Execution Ledger live in `LIVINGWORLD_DATA_ROOT/livingworld.sqlite`; content-addressed model-registry snapshots live beside it under `model-registry/`. Operational entrypoints are grouped under `scripts/experiments/` and `scripts/operations/`, while repo-seed governance scripts retain their managed root paths. The default v19 directory is `.livingworld-v19/`. SQLite uses WAL, `synchronous=FULL`, strict tables, process leases, write transactions, and generation compare-and-swap. Old schemas are not migrated; a different contract uses a new data root.

## Hard invariants

- Action text expresses an attempt, never a state delta.
- Every Agent appears exactly once in the policy roster, and every final joint action has exactly one outcome.
- Every step contains exactly one engine-injected positive time advance equal to its earliest temporal boundary delta.
- Activity completion effects cannot precede completion; unrelated earlier boundaries do not move an Activity's absolute checkpoint.
- An Activity acquires all shared-resource claims or none; active holders, retaining pauses, and ready reservations never exceed the capacity of an active Entity pool, and queues cannot skip an unsatisfied connected head.
- Observation authorization and private text use observer-local IDs; only decision-eligible model Agents run AgentMind.
- Numeric writes are trusted-rule derived: Quantities use explicit provenance and conserve unless a world law authorizes production or consumption; Meter impacts clamp to script ranges; Ratings remain in script ranges.
- Every action pins one ResolutionPlan before resolution randomness, and every plan pins one deterministic ResolutionReceipt whose operations are part of the same atomic step.
- Placement is acyclic; an Agent binds an active Entity and owns one self binding.
- Causes and assertions for operations, mechanics, events, and outcomes resolve and hold before writes.
- External, idle, and occupied Agents do not run AgentMind; each eligible model Agent and Agent created in the step commits exactly one mind update.
- Ordinary world APIs never expose canonical truth, bindings, another Agent's cognition, model configuration, or internal error material. The local model-registry diagnostics defined by Spec 0007 expose only non-secret account status and resolved identities; they omit endpoints, dialect configuration, selectors, inference configuration, and credentials.
- Algorithms can emit only declared diagnostics; runtime event schema v2, stable lifecycle events, metric dimensions, and aggregation semantics remain engine-owned.

World package, runtime, presentation, benchmark, and Ledger details live in [Script format](game-design/script-format.md), [Engine runtime](game-design/engine-runtime.md), [Presentation](game-design/presentation.md), [Causal Activity benchmark](game-design/causal-activity-benchmark.md), and [Runtime observability](game-design/runtime-observability.md). Architectural rationale lives in [0061](decisions/0061-unified-agent-and-external-policy.md), [0063](decisions/0063-eager-reference-execution.md), [0064](decisions/0064-conversation-core-and-agent-perspective-observer.md), [0067](decisions/0067-open-semantic-resolution-plans.md), [0068](decisions/0068-unified-agent-perspective.md), [0070](decisions/0070-event-boundary-temporal-runtime.md), [0071](decisions/0071-pin-algorithms-and-own-telemetry-in-the-engine.md), [0073](decisions/0073-stage-reactions-before-temporal-boundary-selection.md), [0074](decisions/0074-enforce-script-owned-shared-resource-pools.md), and [0075](decisions/0075-pin-configured-execution-algorithms.md).

## Change procedure

1. Trace the current owners of the affected flow.
2. Obtain an Approved [Spec](specs/README.md) for a risk-boundary change.
3. Record a [decision](decisions/README.md) only when genuine alternatives exist.
4. Update this map and the owning product specification in the same change.
5. Run the governance gates and the smallest sufficient behavior evidence.
