# World Inspector Staged Debugging and Replay

## Status

Proposed
Class: architecture

## Context and Problem Statement

The Inspector's physical timestamp ordering hides execution order, its all-artifact graph is unreadable at world scale, and its revision-oriented timeline hides failed attempts. Debugging also needs user-controlled progression through the engine while preserving one canonical execution and atomic commit.

## Decision Drivers

- Preserve one execution path for manual, batch, realtime, participant, and replay work.
- Keep model calls, deterministic validation, and canonical commit auditable without exposing hidden cognition through ordinary APIs.
- Make parallel work understandable without pretending that physical completion order is causal order.
- Resume safely after refresh or process restart without rerunning model calls or mutating canonical state.

## Considered Options

- Pause per physical model invocation.
- Pause per logical engine stage and nest physical calls as evidence.
- Keep timestamp ordering and add labels only.
- Replay by re-executing current models.
- Replay immutable Ledger evidence.

## Decision Outcome

Use logical engine stages as the single-step unit. Persist the debug mode on the World Instance, copy it into each new WorldRun, and fence every next-step request with run generation and checkpoint identity. Use a semantic graph projection as the Inspector default and retain the full evidence graph behind an explicit technical mode. Replay immutable Ledger events and checkpoint artifacts without network or model work.

This gives a bounded click cost, a truthful distinction between semantic order and physical concurrency, deterministic recovery, and fast seekable replay. It gives up invocation-level pausing as the default and does not allow live interruption inside one provider request.

## Pros and Cons of the Options

### Physical invocation checkpoints

- Pros: maximum per-request visibility.
- Cons: parallel batches become dozens of user actions, completion order is not a semantic order, and continuation state becomes provider-shaped.

### Logical stage checkpoints (selected)

- Pros: follows engine ownership, keeps click cost bounded, groups parallel calls honestly, and maps directly to user-facing explanations.
- Cons: a stage may contain several physical calls; their evidence remains inspectable but not independently gateable.

### Timestamp ordering with labels

- Pros: small projection change.
- Cons: timestamps and provider ordinals cannot represent stage causality or deterministic replay order.

### Model re-execution replay

- Pros: explores a new outcome.
- Cons: incurs cost, requires network, is nondeterministic, and is not a replay of the original execution.

### Ledger evidence replay (selected)

- Pros: fast, deterministic, offline, and includes failed attempts.
- Cons: historical executions without checkpoint artifacts require derived, explicitly approximate frames.

## Links

- [World Inspector traceability spec](../specs/0013-world-inspector-traceability.md)
- [World Inspector staged debugging spec](../specs/0015-world-inspector-staged-debugging.md)
- [Unified execution kernel and Ledger](0059-unified-execution-kernel-and-ledger.md)
- [World Instance participation and ActionWindow](0062-world-instance-participation-and-action-window.md)
