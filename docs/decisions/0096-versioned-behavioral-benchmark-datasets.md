# Versioned behavioral benchmark datasets

## Status

Accepted
Class: testing

## Context and Problem Statement

Candidate-key retrieval changes need an offline comparison point that preserves the production Action Compilation C3 input while avoiding another live provider call for every evaluation. A model output that passes the engine's schema, materialization, scope, kind/use, temporal, and mechanic gates is a useful stable behavioral reference, but it is not an absolute semantic oracle.

## Decision Drivers

- Compare shortlist retrievers with the current FullCatalog behavior using one explicit primary metric: required-key recall.
- Keep the complete model-visible C3 context so retrieval changes can be evaluated against the same information boundary.
- Avoid duplicating a large context once for every slot in a physical batch.
- Make data provenance, hashes, repair provenance, and provider-request budgets auditable.
- Prevent an evaluation from silently changing a frozen reference or making a model request.

## Considered Options

- Reuse mixed historical Ledger records: inexpensive, but source contexts and producer versions are not uniform enough for a stable baseline.
- Store only the selected keys: compact, but it cannot reproduce or fairly evaluate a retriever because the input catalog and slot visibility are absent.
- Store one complete context per slot: self-contained, but duplicates the same physical batch context and makes large datasets unnecessarily expensive to review.
- Store immutable, compressed, sharded full contexts with slot-level cases and a manifest: preserves the C3 boundary and provenance while deduplicating physical storage.

## Decision Outcome

Benchmarks live under `benchmarks/` and are indexed by `benchmarks/registry.json`. The Action Compilation `fullcatalog-stabilized` dataset stores one complete C3 context per `contextHash`; each accepted slot is a case containing `contextHash`, `slotIndex`, and final resolved `requiredCandidateKeys`. A generator runs the production C3 compiler and semantic repair loop, retains only fully accepted slots, records every provider request including retries, validates shard hashes, and publishes atomically. Frozen versions are never overwritten; changes to the world, model, prompt, projector, key format, repair policy, or schema create a new version.

The evaluator is a pure offline function. It validates retriever keys against the catalog and slot visibility, reports per-case, micro, macro, batch, and category recall, and treats the all-visible FullCatalog retriever as a mandatory 1.0 control. Empty required sets are counted separately and do not enter the primary non-empty recall denominator.

## Pros and Cons of the Options

### Historical Ledger reuse

- Good: no dedicated generation run is needed.
- Bad: mixed producer, prompt, world, and repair versions can make differences look like retrieval regressions.

### Keys without contexts

- Good: minimal storage.
- Bad: no catalog, visibility, or semantic input exists for a candidate retriever, so the result is not reproducible.

### One context per slot

- Good: each case is directly readable.
- Bad: a multi-slot request repeats the same large C3 context and inflates the benchmark without adding evidence.

### Deduplicated full contexts with slot cases (selected)

- Good: retains the exact model-facing boundary, supports slot-private candidates, preserves provenance, and keeps storage deterministic.
- Bad: a reader must resolve `contextHash` before evaluating a case, and generating the initial frozen version requires real provider budget.

## Links

- [Action Compilation C3 context projector](../../src/engine/algorithms/eager-reference/action-compilation-context.ts)
- [Action Compilation semantic validation](../../src/engine/algorithms/eager-reference/action-compiler.ts)
- [FullCatalog benchmark README](../../benchmarks/action-compilation/fullcatalog-stabilized/README.md)
- [0090 — Model reliability optimization and local transparency](0090-model-reliability-optimization-and-local-transparency.md)
- [0087 — Bounded Action Compilation Context](0087-bounded-action-compilation-context.md)
