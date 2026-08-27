# Event-boundary temporal runtime

Artifact-Version: 1
Status: Approved

## Intent

Replace the uniform simulated duration attached to every world step with an engine-owned event-boundary clock. Natural-language actions may become durable activities that progress across atomic commits, remain observable and interruptible, and stop only at completion, failure, a semantic decision point, an operator pause, or a runtime budget boundary. The change establishes exact temporal semantics for the eager reference implementation; activity-proportional execution remains a separate algorithmic concern.

The runtime stays script-driven. The engine contains no travel, combat, healing, sleep, or Blackmarsh-specific branches. Worlds and trusted rule packages provide named duration, rate, stage, condition, and resource policies; open semantic planning may select those policies but cannot author arbitrary clock deltas.

World schema 11, SimulationState 11, WorldInstance 15, and the integrated public World API 9 are forward-only boundaries. Earlier worlds, instances, saves, fixtures, and fixed-step requests receive no migration or compatibility reader.

## Contract

Canonical state stores durable Activities and Timers. An Activity records its source action, participants, temporal plan, current stage and progress, status, next checkpoint or completion boundary, interruption policy, and declared resource claims. A Timer records an absolute due time and a semantic trigger, never a future state delta. The kernel resolves every trigger due at the same world time in one joint atomic commit.

Each accepted action precommits a `TemporalPlan` before completion effects or randomness. Plans support fixed duration, rate progress, staged work, condition or absolute-time waiting, and open-ended activity. Exact timing may originate only from an explicit verifiable action quantity, an authored named temporal policy, or a trusted versioned rule result. Model output cannot write `elapsedSeconds`, raw `advance_time`, arbitrary seconds, final progress, or completion effects.

The next simulated delta is the positive integer distance from the current clock to the earliest activity checkpoint, activity completion, Timer, Condition expiry, script deadline, or `max_autonomous_span_seconds` safety boundary. A semantic commit contains exactly one engine-injected `advance_time`; control-plane pause and resume do not create zero-time world commits. Completion effects occur only when their committed boundary is reached. Partial travel or work persists as progress and cannot materialize its final placement or effect.

An Agent at a semantic decision point may supply one policy action. An Agent occupied by a continuing Activity supplies no action or noop and does not run AgentMind. Authorized observations remain in its subjective history and are consumed at its next decision point. A relevant interruption, completion, failure, invalidated premise, external interaction, or script-required replanning creates a new decision point. Eager reference processes every due trigger and every decision-eligible Agent without heuristic omission.

`WorldAdvanceRequest` contains no caller-selected simulated seconds. Manual execution advances one boundary; batch execution advances a requested number of boundaries; realtime interval controls only host wake-up. A Participant action creates a persistent `WorldRun` and may advance multiple boundaries until its controlled Agent needs a decision. ActionWindow requires submissions only from external Agents currently at a decision point.

WorldRun stores its generation, root intent, current Activity, committed revisions, status, stop reason, and lease usage. A lease defaults to 100 commits or 15 minutes of wall time. Exhaustion pauses without changing canonical state and resume starts a new lease. Pause aborts an uncommitted attempt and fences late results by run generation and revision CAS. Process recovery preserves canonical activities and converts an unfinished run to `paused: process-recovered`; it never resumes model work automatically.

Participant conversation is projected from the root intent and every committed authorized Observation or activity report. Every visible boundary exposes world time, authorized progress, stage, and full observation text. While a run is active the composer becomes a run console with pause; after pause, resume continues the Activity and a normal external action may interrupt or replace it through Truth rather than by direct UI mutation.

## Plan

Build on the committed open-semantic-resolution v10 contract. Add temporal policies and receipts to the strict planning boundary; implement Activities, Timers, dynamic boundary selection, transaction validation, replay, and Inspector evidence; make eager reference decision-eligible; replace one-step advances with persistent abortable WorldRuns; then integrate Agent Perspective, API 9, conversation projection, controls, and Blackmarsh temporal declarations. Remove fixed simulated-second fields and old schemas as their replacements become live.

## Verification

Exercise fixed, rate, staged, conditional, and open-ended plans through the real ground-to-commit-and-replay path. Cover simultaneous unequal-duration actions, same-time triggers, interruption, partial progress, completion-effect deferral, invalid model timing, AgentMind eligibility, ActionWindow eligibility, pause fencing, lease exhaustion, process recovery, replay, permissions, and Inspector evidence.

Use the Blackmarsh player entry to verify a short action, travel, sleep, treatment, visible progress, interruption, pause, and resume with an isolated port and data root. Run `npm test`, `npm run world:validate -- worlds/blackmarsh/world`, `npm run build`, `npm run check:fast`, `node scripts/run-gates.mjs`, and `git diff --check`.

## Evidence

Implemented on `synergy/event-driven-time-kernel` from the committed open-semantic v10 boundary. The delivered runtime includes canonical TemporalPlans, Activities, Timers, earliest-boundary selection, transaction-side authority re-derivation, replay evidence, decision-point cognition, persistent abortable WorldRuns, World API 9, Simulation/World schema 11, Instance schema 15, Participant run controls, Inspector temporal evidence, and authored Blackmarsh calibration.

Verification completed on 2026-08-27:

- `npm run check:fast`: 26 test files and 171 tests passed, followed by fixture validation and all six governance gates.
- `npm run world:validate -- worlds/blackmarsh/world`: 232 entities and 48 Agents validated as schema v11.
- `npx next build --webpack`: the production application and all API 9 routes compiled successfully.
- `npx playwright test --project=e2e`: all 8 product and responsive browser flows passed.
- `npx playwright test --project=a11y`: all 3 accessibility, forced-color, and 200% zoom flows passed.
- Isolated Blackmarsh smoke testing on port 32217 and a dedicated v15 data root verified a one-second sword action, partial 100 km rate progress without teleportation, interruption into a one-day explicit-duration activity, staged treatment checkpoints, pause/resume, persisted recovery, authored absolute Timers, and Inspector boundary receipts. The existing port 3217 process and its data were not reused or stopped.
- `node scripts/run-gates.mjs` and `git diff --check` passed after final documentation updates.
