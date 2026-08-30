# Truth Engine fixed slot batching

## Status

Accepted

Class: architecture

## Context and Problem Statement

Independent interaction components currently execute the same Truth Engine stages as separate model requests. A 48-component step therefore repeats resolution, causal verification, transition, and observation calls even when every component has a disjoint dependency footprint. The request contexts share a complete world prefix, but the existing orchestration has no typed envelope for sharing that context or for isolating slot failures.

## Decision Drivers

- Preserve semantic freedom, canonical atomicity, privacy, and replay determinism.
- Reduce physical calls and repeated context tokens for graph-proven independent work.
- Keep full model-visible context and fail explicitly at the profile input limit.
- Keep repairs local and retain the existing global safety valve.
- Avoid provider-native batch API coupling in the first implementation.

## Considered Options

1. Keep one provider request per component and only increase concurrency.
2. Jointly merge independent components into one semantic resolution.
3. Use a fixed slot envelope over the existing structured provider API.
4. Depend on provider-native batch endpoints.

## Decision Outcome

Choose option 3. The engine sends one structured request containing numbered independent slots plus one shared complete context. Each slot is validated, materialized, repaired, audited, and replayed independently. Fixed batches are formed from canonical keys; context overflow is a hard error, while only structural output failures may retry and bisect. Global or newly discovered conflicts continue through the existing global path.

## Pros and Cons of the Options

### Option 1: concurrency only

- Good: smallest implementation and unchanged model contract.
- Bad: physical call count, repeated prefixes, and token cost remain unchanged; latency still follows provider waves.

### Option 2: joint semantic resolution

- Good: fewest calls.
- Bad: gives the model a larger coupled reasoning task, changes conflict semantics, and makes local repair/ownership ambiguous.

### Option 3: fixed slot envelope (selected)

- Good: shared context is sent once, logical responsibilities stay isolated, and existing provider/schemas remain usable.
- Bad: requires strict slot coverage, batch-aware audits/replay, and deterministic structural recovery.

### Option 4: provider-native batching

- Good: may improve transport efficiency for compatible providers.
- Bad: introduces provider-specific semantics and a second scheduling contract before engine-level correctness is proven.

## Links

- [Truth Engine output repair boundaries](../decisions/0079-truth-engine-output-repair-boundaries.md)
- [Eager-reference slot batching](../specs/0007-eager-reference-slot-batching.md)
- [Truth Engine fixed slot batching spec](../specs/0012-truth-engine-fixed-slot-batching.md)
