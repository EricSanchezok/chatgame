# Bounded Action Compilation Context

## Status

Proposed
Class: architecture

## Context and Problem Statement

Action Compilation receives a complete semantic namespace but represents much of it several times: a catalog for every slot, canonical truth, task-local lists, and prose copies inside repair issues. Repair reconstructs nearly the same request after a local field failure. This representation exhausts model input budgets and makes a repeated mistake expensive, while a blanket rule that every repair must contain every detail prevents evidence-driven optimization.

The engine must distinguish complete semantic reachability from complete eager serialization. Removing references, summarizing away evidence, or accepting model-selected mechanics without proof would reduce world fidelity. Retaining every candidate handle while varying only deterministic details permits experiments without relaxing canonical validation.

## Decision Drivers

- Preserve open natural-language action semantics and the complete candidate namespace.
- Preserve cognitive isolation, trusted deterministic mechanics, atomic commits, and replay.
- Make reference legality and temporal eligibility machine-verifiable before execution.
- Bound repair context and prevent identical failed requests from recurring.
- Choose context-detail optimization through correctness-first recorded and live experiments.
- Keep one model-visible vocabulary and one resolver rather than parallel representations.

## Considered Options

1. Keep complete repeated contexts and tune prompt wording.
2. Use top-K retrieval or summaries that remove non-selected candidates.
3. Use one complete request-local catalog, deterministic detail projection, evidence-bound temporal eligibility, and typed minimal repair, with a normalized full-detail catalog as fallback.
4. Let each model role or slot invent its own compact identifier and repair protocol.

## Decision Outcome

Choose option 3. A batch owns one `referenceCatalog`; every eligible handle remains present, while candidate details may be projected deterministically. The engine evaluates full-detail and selective-detail variants against the same recorded cases and promotes a selective variant only if semantic, commit, replay, causal, privacy, shared-resource, and onset-reaction gates pass. A single normalized complete catalog without duplicate canonical truth is the safe fallback.

Field-specific resolvers enforce allowed kinds and uses. Unknown, fuzzy, private, or illegal references remain local typed issues and never become global scope. Global arbitration follows only from an accepted canonical world reference. Runtime-contract preflight and trusted execution remain authoritative.

Temporal profile selection is constrained by script-owned eligibility and exact deterministic evidence spans. Rate profiles require compatible explicit quantity evidence. Duration, deadline, condition, staged, ongoing, and default profile choices consume their own evidence contracts; the model selects among eligible semantics but cannot invent proof.

Action Compilation preserves accepted slots and repairs only rejected fields or slots with typed issues and bounded evidence. Stable failure fingerprints stop equivalent repair loops through deterministic engine-owned correction, bounded evidence expansion, or the existing conservative batch split/failure policy. The resolution-plan verifier continues repairing the smallest named plan and re-verifying before random commitment. Observer-local causal findings continue re-rendering only affected observers; findings not proven local remain in the owning atomic component.

Transport, structured-output, semantic-validation, and context-limit failures retain separate telemetry. Repair orchestration does not choose canonical disposition. Context limit never silently removes candidate handles; a variant that cannot fit raises `ContextLimitExceeded` or uses the validated complete-catalog fallback/batch policy.

## Pros and Cons of the Options

### Repeated complete contexts with prompt tuning

- Good: smallest code change and all evidence remains visible.
- Bad: repeats megabytes per slot and per repair, exposes ambiguous field choices, and cannot deterministically break repeated failures.

### Candidate-removing retrieval or summaries

- Good: can minimize request size aggressively.
- Bad: omitted candidates reduce semantic freedom, retrieval errors are hard to distinguish from model errors, and world outcomes can change silently.

### Complete namespace with projected details and typed repair

- Good: separates semantic reachability from payload size, retains deterministic validation, bounds repairs, supports conservative fallback, and makes competing projections experimentally comparable.
- Bad: requires explicit eligibility metadata, experiment infrastructure, and more projection/materialization code; selective details may fail and fall back to the larger normalized catalog.

### Per-role or per-slot compact protocols

- Good: each caller can optimize independently.
- Bad: duplicates identifiers and meanings, makes shared evidence difficult to audit, and increases maintainer and model confusion.

## Links

- [Action Compilation context and temporal eligibility spec](../specs/0014-action-compilation-context-and-temporal-eligibility.md)
- [Model semantic contract and reference boundaries](0086-model-semantic-contract-and-reference-boundaries.md)
- [Truth Engine output repair boundaries](0079-truth-engine-output-repair-boundaries.md)
- [Event-boundary temporal runtime](0070-event-boundary-temporal-runtime.md)
- [Truth Engine fixed slot batching](0082-truth-engine-fixed-slot-batching.md)
