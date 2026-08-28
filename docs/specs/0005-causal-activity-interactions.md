# Causal Activity interactions at event boundaries

Artifact-Version: 1
Status: Implemented

## Intent

Make unequal-duration concurrency causally complete without replacing the single canonical world clock or expanding the top-level formal process. A continuing Activity must participate when a new or due interaction can affect its assumptions, progress, participants, or outcome, while an unrelated occupied Agent remains asleep, traveling, or working without another policy decision.

The runtime keeps one monotonically increasing world time and independently planned Activities. It adds action-onset reactions, persisted interaction footprints, Activity dispositions, resumable external reaction windows, and exact performance evidence. It does not add zero-time world commits, domain-specific action classes, recursive reactions, shared physical-resource capacity, caller-selected simulated seconds, or migrations for earlier state.

## Contract

Every new action receives an independently validated TemporalPlan at the current canonical time. The runtime detects overlap between the action and active Activities before selecting the next temporal boundary. An interruptible Activity may receive one precommit reaction only when the action onset is perceptible through an existing authorized basis and a response can still change future execution. A replacement action starts at the current world time, receives its own TemporalPlan, and participates in the same global earliest-boundary selection. An event that reaches completion without an earlier perceptible onset or warning commits before any resulting decision.

Reaction routing is finite. One frozen request set is resolved per step preparation. Replacement dependency expansion may force global readjudication but cannot recursively create a second reaction round; newly affected Agents receive committed observations or post-boundary decision points.

Each canonical Activity stores an engine-validated interaction footprint derived from its grounded action dependency, participants, and durable continuation assertions. Generic interaction nodes represent actions, Activities, Timers, and Conditions. An ephemeral exact index identifies overlapping active Activities; unknown or out-of-footprint access expands to all active interactions. Activity contexts participate in settlement without receiving synthetic ActionOutcomes.

Every due or affected Activity receives one validated disposition: continue, pause, complete, block, fail, or cancel. Durable continuation assertions are evaluated when an Activity starts, becomes due, or intersects an incoming write, and again against the proposed post-transition state. Failed assertions cannot produce continue; the deterministic minimum fallback is blocked. Check- and random-result assertions are not durable continuation predicates. A decision point cannot coexist with an Activity that still actively occupies that Agent.

External reactions suspend control flow without mutating canonical state or world time. The preparation, source-state hash, algorithm manifest hash, policy-roster hash, and private ReactionRequests are persisted with a reaction ActionWindow. The preparation execution terminates without a commit revision. A submitted or timed-out window resumes through a child execution and produces one ordinary positive-time atomic commit. Process restart does not automatically resume model work. Invalid preparation evidence pauses the run without mutation until an explicit retry creates a new preparation.

Temporal Profiles declare `reaction_fallback` as `continue_if_valid`, `pause`, or `cancel`; omission materializes `continue_if_valid`. Non-interruptible profiles permit only `continue_if_valid`. Objective assertion failure outranks a fallback choice.

This is a forward-only boundary: world and Simulation schema 12, WorldInstance schema 17, WorldStepCandidate schema 3, World API 10, Inspector API 4, preparation schema 1, execution contract 3, and `eager-reference@4` replace their earlier forms. Old worlds, instances, candidates, and pinned algorithms are rejected rather than migrated or read through compatibility paths.

## Plan

Record the action-onset and persistent-preparation decision, then replace action-only dependencies with generic interaction evidence. Activate durable continuation assertions and Activity dispositions before splitting algorithm preparation from completion. Integrate reaction ActionWindows, recovery, permissions, Participant UI, Inspector evidence, bundled worlds, and deterministic benchmarks after the engine contract is independently validated.

Each independently verifiable unit receives its relevant tests and an immediate local commit. Repository documents describe only the shipped contract after implementation.

## Verification

Exercise an unrelated short action beside an overnight Activity, perceptible and hidden action onsets, one- and five-second replacements, non-interruptible Activities, invalidated premises, simultaneous due events, global fallback, and a 30-Agent mixed-duration world through the real ground-to-commit path. Prove that an unrelated occupied Agent neither reacts nor runs AgentMind, and that no decision point leaves its Agent inside an active Activity.

Exercise external keep, replacement, partial timeout, profile fallback, stale submission, restart, corrupt or incompatible preparation, explicit retry, parent-child Ledger evidence, permissions, replay, and canonical-state immutability while waiting.

Compare the production footprint index with an exhaustive test oracle across 1, 10, 50, and 1000 Agents at independent, sparse, dense, and global dependency densities. Semantic pass rate and affected-Activity recall must be 100%, causal-ordering violations and irrelevant occupied-Agent model calls must be zero, and recorded replay must reproduce semantic and state hashes. Record token, model-call, wall-time, memory, component, lookup, and artifact-size measurements separately without a composite score or unstable wall-clock CI threshold.

Run `npm run check:fast`, `npm run world:validate -- worlds/blackmarsh/world`, `npm run build`, the relevant browser and accessibility flows, `node scripts/run-gates.mjs`, and `git diff --check`.

## Evidence

Implemented in world and Simulation schema 12, WorldInstance schema 17, WorldStepCandidate schema 3, World API 10, Inspector API 4, preparation schema 1, execution contract 3, and `eager-reference@4`. The permanent measurement contract and command live in the [causal Activity benchmark reference](../game-design/causal-activity-benchmark.md), and the selected architecture is recorded in [decision 0073](../decisions/0073-stage-reactions-before-temporal-boundary-selection.md).

`npm run check:fast` passed lint, generated-route TypeScript, 242 unit/integration tests in 38 files, the shared world fixture, workflow verification, and all six governance gates. `npm run world:validate -- worlds/blackmarsh/world` accepted 232 entities and 48 Agents. `npm run build` completed the production Next.js build, including the Participant reaction route. `npx playwright test --project=e2e --project=a11y` passed 11 end-to-end and 4 accessibility flows.

`npm run benchmark:causal` completed 80 scenarios from 4 Agent scales, 4 conflict densities, and 5 Activity types with semantic pass and affected-Activity recall at 100%, false activation and causal-ordering violations at zero, and deterministic replay agreement. On the verification machine the worst recorded p95 footprint lookup was 15.845 ms, peak observed heap was 74,320,736 bytes, maximum serialized benchmark artifact was 1,449,962 bytes, and the largest interaction component contained 2,000 nodes; these wall-clock and memory values are evidence, not portable CI thresholds.
