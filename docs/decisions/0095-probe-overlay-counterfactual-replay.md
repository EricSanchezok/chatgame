# Probe-overlay Counterfactual Replay

## Status

Accepted

Class: feature

## Context and Problem Statement

Recorded replay must remain an immutable reproduction of the model outputs that
the Ledger captured. Probe reports intentionally contain alternate outputs from
networked experiments, but the current replay command has no explicit way to
evaluate one of those outputs through the pinned engine. Automatically finding
or importing probe files would make replay ambient, ambiguous, and difficult to
audit.

## Decision Drivers

- Preserve deterministic, immutable Ledger replay as the default.
- Make counterfactual input explicit and evidence-traceable.
- Prevent request/profile drift and accidental network or variant execution.
- Reuse the complete engine validation, repair, and commit path.
- Keep `debug replay` and `execution:replay` behavior aligned.

## Considered Options

1. Keep replay Ledger-only and require manual reconstruction outside the engine.
2. Automatically discover the newest probe JSON in temporary/data directories.
3. Import probe reports into a new Ledger table before replay.
4. Require an explicit report file and trial, then overlay one exact invocation
   on the immutable Ledger baseline.

## Decision Outcome

Choose option 4. The normal command remains immutable recorded replay. Passing
`--probe-report` opts into a `probe-overlay` child replay that stores the
redacted report, validates exact request identity, consumes one replacement once,
and reports engine success or failure without mutating the source execution or
canonical state.

## Pros and Cons of the Options

### 1. Ledger-only replay

- Good: simplest and maximally deterministic.
- Bad: cannot answer whether a probe output changes semantic validation or
  repair behavior; debugging remains manual.

### 2. Automatic discovery

- Good: minimal CLI typing.
- Bad: hidden inputs, stale/ambiguous files, path leakage, and non-reproducible
  results; violates explicit evidence boundaries.

### 3. New Ledger import table

- Good: centralized persistence and querying.
- Bad: schema/migration complexity and a second source of truth; over-scoped for
  one selected trial.

### 4. Explicit single-point overlay (chosen)

- Good: auditable, deterministic, backward compatible, and exercises the real
  engine path with bounded scope.
- Bad: v1 cannot batch trials, accept request variants, or provide Inspector
  controls; those remain future capabilities.

## Links

- [Probe-output counterfactual replay spec](../specs/0018-probe-output-counterfactual-debug-replay.md)
- [World Inspector staged debugging and replay](0089-world-inspector-staged-debug-and-replay.md)
- [Model reliability optimization and local transparency](0090-model-reliability-optimization-and-local-transparency.md)
