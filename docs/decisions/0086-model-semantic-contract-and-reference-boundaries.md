# Model Semantic Contract and Reference Boundaries

## Status

Accepted
Class: architecture

## Context and Problem Statement

Model requests combined natural-language intent with engine-owned runtime records. Names such as `read`, `write`, `id`, and `targetIds` did not state whether a value referred to an existing fact, a concurrency footprint, a proposed record, or an actor-local alias. The same weakness appeared in plan and causal verification contexts that exposed flattened runtime objects. A model could therefore produce a syntactically valid but semantically impossible reference, and the resulting repair would be slower and less reliable than deterministic validation.

## Decision Drivers

- Give every model-visible reference one clear meaning and one resolver namespace.
- Keep the model responsible for semantic decisions while the engine owns identity, persistence, authorization, and deterministic effects.
- Prevent private cognition and canonical identity leakage through shared contexts.
- Make context projections compact enough for fixed model input limits and repeatable batching.
- Keep code readable by having one projection vocabulary instead of parallel legacy and semantic representations.
- Allow a forward-only contract change without migrations or compatibility branches.

## Considered Options

1. Keep engine IDs and clarify the prompts with prose.
2. Keep raw contexts and repair malformed fields after generation.
3. Introduce a request-local semantic reference protocol with explicit projections, deterministic materializers, and proposal keys.
4. Give each model role an unrelated bespoke identifier scheme.

## Decision Outcome

Use one semantic model protocol across model roles. Existing records are exposed through a request-local `referenceCatalog` with a handle, kind, human meaning, allowed uses, and visibility. New records use `proposalKey`; cross-record fields use explicit `*Ref` names. The action dependency contract distinguishes `requiredExistingRefs` from `potentiallyAffectedExistingRefs`, making the second a concurrency footprint rather than a future write list. Access policies use explicit `public`, `private`, or `agents` forms with agent references.

The server projects Truth, actions, dependencies, plans, checks, random results, events, observations, and history before prompt composition. Candidate-only references use a task catalog. Typed mechanic contracts are projected with `*Ref`/`*Refs` fields even though runtime rules consume `*Id`/`*Ids`; the materializer resolves those handles and assigns engine identities only after schema and semantic validation. Causal verifier findings are materialized from `{ kind, ref }` targets before they enter the internal verification type. Observer contexts contain only an authorized scoped truth projection. Context overflow is handled by deterministic bisection of a batch, preserving logical slot results.

The protocol is forward-only. Model context version 14 and the Inspector projection version 8 are the active contracts. Action Compilation exposes engine-extracted exact temporal evidence and accepts an evidence key instead of model-copied quantities or source text. Persisted runtime events keep their internal identities, while the Inspector projects globally unique invocation IDs as `${executionId}::${sourceInvocationId}`.

## Pros and Cons of the Options

### Prompt prose over engine IDs

- Pros: minimal code change and no schema changes.
- Cons: prose cannot prevent a model from copying an ID into the wrong field, does not distinguish local aliases from canonical entities, and leaves every consumer to infer meaning independently.

### Post-generation repair of raw contexts

- Pros: preserves existing context payloads and can handle isolated mistakes.
- Cons: the model still reasons over ambiguous data, repairs become probabilistic, and malformed references can reach multiple downstream stages before detection.

### Shared semantic protocol (selected)

- Pros: one vocabulary is reusable across roles; resolver errors are deterministic; proposal ordering is explicit; private projections are enforceable; and model contexts can omit redundant runtime metadata.
- Cons: the contract is intentionally breaking, every model-facing caller must use the projection boundary, and materializers add a small amount of explicit mapping code.

### Bespoke role-specific identifier schemes

- Pros: each prompt can be optimized independently.
- Cons: the same fact would acquire multiple names across roles, increasing cognitive load for maintainers and making cross-stage evidence links difficult to verify.

## Links

- [Model semantic contract draft](../specs/draft-model-semantic-contract.md)
- Supersedes [Model-output field ownership](0060-model-output-field-ownership.md).
- [Open semantic resolution plans](0067-open-semantic-resolution-plans.md)
- [Causal assurance and staged model profiles](0042-causal-assurance-and-staged-model-profiles.md)
- [World Inspector hierarchical selection](0085-world-inspector-hierarchical-selection.md)
