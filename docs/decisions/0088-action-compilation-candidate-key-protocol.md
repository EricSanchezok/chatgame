# Action Compilation Candidate-Key Protocol

## Status

Accepted
Class: architecture

## Context and Problem Statement

Action Compilation must describe temporal choices, causal evidence, concurrency footprints, and audience effects in one batched request. Request-local handles are useful to the engine, but exposing their `ref:` spelling alongside local Agent aliases makes the model-visible contract look like a mixture of canonical identity, private cognition, and future record creation. The same physical request can also contain slot-private candidates, so a model-authored handle is easy to copy into the wrong slot or field.

The protocol needs one readable semantic vocabulary that keeps every existing candidate reachable, prevents raw identity leakage, makes field legality deterministic, and leaves the engine as the sole owner of runtime identity and canonical validation. It must replace the old Action Compilation output directly without a compatibility reader or a second identifier scheme.

## Decision Drivers

- Keep open-world action meaning and complete candidate reachability.
- Remove raw canonical and private reference strings from the Action Compilation prompt.
- Make slot scope and allowed field use machine-verifiable before materialization.
- Keep the code readable with one projection, one resolver boundary, and one output vocabulary.
- Preserve deterministic repair, replay, telemetry, and atomic commit behavior.
- Bound the cost of repeated repairs without silently dropping semantic candidates.

## Considered Options

1. Keep request-local handles and add more prompt prose about their meaning.
2. Replace handles with short positional indexes generated for each slot.
3. Expose one candidate catalog with opaque deterministic `candidateKey` selectors and materialize them through one engine-owned resolver.
4. Add a second repair-only catalog and retain the existing Action Compilation protocol for normal calls.

## Decision Outcome

Choose option 3. Action Compilation receives one `referenceCatalog` with a stable candidate key, kind, label, meaning, allowed uses, slot scope, and optional deterministic details. Candidate keys are selectors, not identities; the key is derived from the request-local handle only inside the engine and has no canonical meaning. The model copies a listed key and never emits `ref:*`, a runtime ID, a local belief ID, or a fabricated key.

`actionReferences` is the only precomputed binding summary for the assigned action. It reports action and actor candidate keys, target labels, binding status, and active canonical candidates. `unique`, `ambiguous`, `unresolved`, and `stale` are engine-computed statuses; an ambiguous or unresolved target is not guessed by the model.

The output schema uses candidate keys for temporal profiles, causal assertions, dependency footprints, audiences, and shared-resource claims. `requiredExistingCandidateKeys` means existing canonical state needed to adjudicate the action now. `potentiallyAffectedCandidateKeys` means existing state in the concurrency footprint; neither field creates or writes a future record. The engine materializes candidate keys into its existing internal handles, then runs the existing typed normalization, temporal eligibility, dependency, resource, and canonical validation.

The projector keeps one complete candidate namespace and selects details deterministically from action state, exact temporal evidence, text matches, placement neighbors, and reference closure. Unknown `ref:*` strings in projected model data become absent values rather than leaking a second identity vocabulary. Repair contexts carry only the affected slot, prior candidate-key output, exact issue paths, and bounded legal alternatives. Duplicate semantic candidates, serialized raw references, and cross-slot candidate use are hard-gated at projection or materialization.

The previous handle-based Action Compilation path, duplicate catalog reader, and compatibility branches are removed. Generic AgentMind and other model roles continue to use the shared request-local handle protocol where their contracts require it; Action Compilation has one explicit candidate-key protocol instead of making every role carry a second bespoke representation.

## Pros and Cons of the Options

### Prompt prose over handles

- Good: preserves the smallest amount of code and keeps current materializers.
- Bad: prose cannot prevent a model from selecting the wrong kind, copying a private alias, or confusing a concurrency footprint with a future write.

### Positional indexes

- Good: short values reduce prompt bytes.
- Bad: indexes change when a catalog is narrowed, are difficult to audit across repairs, and make recorded replay and cross-slot diagnostics harder to compare.

### One candidate catalog with deterministic keys

- Good: one namespace is readable, scope and field legality remain explicit, raw identity leakage is eliminated, and materialization stays at one engine boundary.
- Bad: requires a breaking output schema and deterministic key collision checks.

### Parallel repair protocol

- Good: can optimize repair payloads independently in the short term.
- Bad: duplicates vocabulary and resolver logic, allows normal and repair calls to drift, and makes old readers persist as dead compatibility code.

## Consequences

Action Compilation request audits identify the candidate-key projection and record zero raw-reference serialization as a correctness metric. The trusted Inspector trace also records local binding status, candidateKey, field use, final engine handle, context bytes, duplicate-definition count, and repair evidence without adding those handles to the model context. Tests must assert key uniqueness, no raw `ref:` values, field-level kind/use rejection, slot isolation, candidate-key materialization, and unchanged accepted replay state. A future context optimization must keep the same catalog and resolver boundary or introduce a new decision and paired correctness-first experiment.

## Links

- [Action Compilation context and temporal eligibility spec](../specs/0014-action-compilation-context-and-temporal-eligibility.md)
- [Bounded Action Compilation Context](0087-bounded-action-compilation-context.md)
- [Model Semantic Contract and Reference Boundaries](0086-model-semantic-contract-and-reference-boundaries.md)
- [Truth Engine Output Repair Boundaries](0079-truth-engine-output-repair-boundaries.md)
