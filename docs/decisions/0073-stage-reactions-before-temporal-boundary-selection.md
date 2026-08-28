# Stage perceptible reactions before temporal-boundary selection

## Status

Accepted
Class: architecture

## Context and Problem Statement

The event-boundary runtime independently plans unequal-duration actions and advances one canonical clock to the earliest due boundary. Its conflict graph contains only new or due actions. A non-due Activity can therefore remain outside settlement even when an incoming action overlaps its assumptions, and a relevant observation can create a decision point while the Activity remains active. Allowing a new response only after the incoming action completes would instead make a positive-duration action affect elapsed time retroactively.

External Participants add another constraint: a reaction may require unbounded wall-clock waiting, but an execution lease and canonical transaction cannot remain running across that wait. The engine needs a durable intermediate without turning control-plane suspension into a zero-time world commit.

## Decision Drivers

- One canonical clock must remain monotonic, positive-step, replayable, and independent of wall-clock waiting.
- Per-Activity durations must remain independently planned before one global earliest-boundary choice.
- A response must start early enough to influence an event without retroactive elapsed time.
- Continuing Activities must participate in conflicts without running every occupied Agent's policy.
- External reaction state must survive restart and preserve cognitive isolation.
- The eager reference must provide an exact baseline whose sparse work is measurable against an exhaustive oracle.
- Open semantics and script ownership must not become travel, sleep, combat, or other engine action classes.

## Considered Options

- Keep action-only settlement and create decision points after relevant observations.
- Permit zero-time reaction actions at an event's completion boundary.
- Re-run a nondeterministic step after an external Participant responds.
- Stage perceptible onset reactions, persist an exact preparation, then select and settle the next positive temporal boundary — the selected option.

## Decision Outcome

`eager-reference@4` treats actions, Activities, Timers, and Conditions as generic interaction nodes. A canonical Activity stores a conservative interaction footprint. New action onsets are matched against active Activities before boundary selection, while due interactions are matched again before settlement. Only overlapping context is included; uncertainty and observed out-of-footprint access expand to global readjudication.

An interruptible Agent may react to an action onset when a structured basis proves perception and the response can precede completion. Keep retains its committed Activity. Replace stops the Activity in the projected temporal state, starts a new independently planned Activity at the current canonical time, and causes the scheduler to recompute the earliest boundary. Events without prior onset visibility or a committed warning settle first and may then pause, block, fail, cancel, or leave the Activity continuing. There is exactly one frozen reaction round per preparation.

The runtime validates one Activity disposition for every due or affected Activity separately from ActionOutcomes. Durable continuation assertions contribute to the Activity footprint and are evaluated before and after relevant transitions. A failed continuation cannot remain active, and a decision point cannot make an actively occupied Agent eligible.

`WorldExecutionAlgorithm` separates step preparation from completion. A preparation requiring an external reaction is stored as content-addressed Ledger evidence and referenced by a reaction ActionWindow pinned to source state, algorithm, and policy roster. The preparation execution finishes without a commit revision. Submission or authored timeout fallback starts a child execution from that exact evidence. Invalid evidence leaves canonical state untouched and requires explicit retry; process recovery never spends model cost automatically.

The interaction index is ephemeral and reconstructible from canonical Activity footprints. Production uses one indexed implementation; tests own the exhaustive oracle. Performance reporting separates semantic correctness, model cost, compute cost, and Participant waiting instead of hiding tradeoffs in one score.

## Pros and Cons of the Options

### Action-only post-event decisions

- Good: preserves the smallest runtime and existing step interface.
- Bad: misses affected non-due Activities and can leave an Agent simultaneously active and decision-eligible.

### Completion-boundary zero-time reactions

- Good: creates dramatic immediate counters without another temporal phase.
- Bad: lets newly planned positive-duration behavior rewrite elapsed time and breaks the one-positive-advance transaction invariant.

### Nondeterministic rerun after Participant input

- Good: avoids persisting an algorithm intermediate.
- Bad: the ReactionRequest and earlier model commitments can change while the Participant answers a stimulus that no longer exists.

### Onset preparation and durable completion

- Good: preserves causal order, exact recovery, cognitive isolation, bounded reaction work, and one canonical scheduler.
- Bad: adds a versioned preparation contract, parent-child execution evidence, Activity footprints, and a second ActionWindow kind.

## Links

- [Approved causal Activity interactions Spec](../specs/0005-causal-activity-interactions.md)
- [0037](0037-agent-evolution-self-awareness-and-reaction-window.md) — finite, private reaction evidence.
- [0059](0059-unified-execution-kernel-and-ledger.md) — critical execution evidence and atomic commit.
- [0063](0063-eager-reference-execution.md) — exact component baseline and global fallback.
- [0070](0070-event-boundary-temporal-runtime.md) — one clock, durable Activities, and positive event boundaries.
- [0071](0071-pin-algorithms-and-own-telemetry-in-the-engine.md) — pinned algorithm contracts and engine-owned metrics.
