# Pin configured execution algorithms

## Status

Proposed
Class: architecture

## Context and Problem Statement

The execution registry pins one immutable manifest for each algorithm identity, while model request batching needs independently tunable limits that can change model output distribution, retries, cost, and latency. Treating those limits as process globals would let a restarted instance or recorded replay silently use a different producer. Treating them as world content would mix runtime policy with Script semantics. Making them mutable during a run would weaken comparisons and preparation identity.

The fixed engine must preserve an exact producer without learning eager-reference-specific concepts such as Action Compilation or AgentMind slots.

## Decision Drivers

- Each world instance retains one reproducible algorithm configuration across restart and replay.
- Batching policy and validation remain owned by eager-reference rather than the canonical engine or model gateway.
- Different configurations of one algorithm version can coexist.
- Ordinary world content and canonical state remain independent of runtime tuning.
- The registry continues to validate the exact manifest and fresh algorithm instance.

## Considered Options

- Store batch limits in the process model catalog.
- Store batch limits in each World Script.
- Allow mutable per-instance runtime settings.
- Pin opaque algorithm configuration in `AlgorithmRef` and resolve it through a configurable algorithm definition.

## Decision Outcome

`AlgorithmRef` carries the immutable JSON-safe configuration from its `AlgorithmManifest`. The registry owns only generic validation and delegates manifest construction plus configuration interpretation to the registered algorithm definition. Its key remains the algorithm ID and version, while the reference configuration and derived manifest hash identify the exact variant.

Eager-reference owns `actionCompilationMaxSlots` and `agentMindMaxSlots`, including defaults, bounds, prompt composition, byte-aware partitioning, validation, repair, and splitting. WorldHost pins the resulting reference when it creates an instance. The Execution Ledger stores the complete producer manifest, and recorded replay derives a configured reference from that manifest.

Configuration is immutable after instance creation. The fixed engine, canonical committer, Script loader, and model gateway do not interpret the eager-reference fields.

## Pros and Cons of the Options

### Process model catalog

- Good: uses an existing deployment configuration surface.
- Bad: changes existing instances after restart and conflates inference profiles with algorithm orchestration.

### World Script

- Good: makes tuning portable with a world package.
- Bad: changes world identity for an engine-performance choice and prevents independent algorithm experiments.

### Mutable instance runtime settings

- Good: supports live tuning without creating another instance.
- Bad: weakens reproducibility, preparation fencing, and causal comparison between steps.

### Pinned opaque algorithm configuration

- Good: preserves exact identity, coexistence, replay, and the fixed-engine boundary.
- Bad: requires a forward-only registry and instance-contract change and makes each configuration part of producer identity.

## Links

- [Approved eager-reference slot batching Spec](../specs/0007-eager-reference-slot-batching.md)
- [0071 — Pin algorithms and own stable telemetry in the engine](0071-pin-algorithms-and-own-telemetry-in-the-engine.md)
- [Algorithm runtime contract v2](../specs/0004-algorithm-runtime-contract-v2.md)
