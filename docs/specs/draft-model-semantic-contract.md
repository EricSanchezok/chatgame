# Model Semantic Contract and Reference Boundaries

Artifact-Version: 1
Status: Draft

## Intent

Give every model-facing request a small, explicit vocabulary for existing world records, new proposals, actor-local knowledge, and deterministic engine responsibilities. The contract addresses the general failure mode in which field names such as `read`, `write`, `id`, or `targetIds` are syntactically valid but semantically underspecified, causing a model to describe future records as dependencies or to copy an internal identifier into an unrelated field.

The scope includes Truth, action grounding, resolution planning, causal verification, observation rendering, model context projection, and the public Inspector projection. It does not change Truth Engine semantics, persistence, authored world scripts, or model provider transport.

## Contract

### Vocabulary

- Existing records are selected with request-local handles from `referenceCatalog`. A handle identifies one catalog candidate for the current request and has an allowed use such as `target`, `cause`, `assertion`, or `source`.
- New records are named with a unique `proposalKey`. A later field refers to that proposal with `{ "proposalKey": "..." }`.
- Cross-record fields use explicit `*Ref` names (`actorRef`, `subjectRef`, `actionRef`, `factRef`, `sourceEventRefs`). Engine-owned `id`, `revision`, timestamps, and canonical bindings are not model output fields.
- `requiredExistingRefs` means existing records whose present values are required to evaluate the action. `potentiallyAffectedExistingRefs` means existing records whose concurrent mutation would make the action unsafe. The latter is a conflict footprint, not a list of records that the action will create or write.
- Access is explicit: `public`, `private`, or `agents` with `agentRefs`. An access policy is not inferred from a string list.
- Authored configuration descriptions remain available for reasoning, but typed mechanic inputs expose their `*Id`/`*Ids` fields to the model as `*Ref`/`*Refs` handles. Runtime package, rule, definition, and profile identities remain behind the resolver at materialization time.

### Projection boundary

The server projects canonical truth, actions, dependencies, checks, random results, plans, events, observations, and history into semantic records before prompt composition. A shared `referenceCatalog` carries labels and meanings; task-specific candidate records use a separate catalog when a record exists only in the current candidate. The engine resolves handles, validates allowed uses, assigns runtime identities, applies deterministic effects, and persists the result.

Observer requests use an authorized, observer-scoped truth projection. Private cognition and canonical identity bindings remain server-only. Large repeated contexts may be split into deterministic batches, but a split does not change slot ownership or logical results.

### Validation and repair

Schemas reject unknown fields and raw engine-owned fields at the model boundary. Reference resolution rejects unknown handles, proposal references in existing-only positions, and disallowed uses. The semantic repair loop receives the exact failing path and allowed candidates. Deterministic normalization may remove duplicate or stale observation references; an LLM repair is reserved for errors that cannot be corrected without semantic judgment.

### Compatibility

The model context contract is version 13 and the Inspector projection is version 8. These are forward-only contracts: old model contexts and saved projection payloads are not migrated or accepted as alternate shapes. Persisted runtime events retain their engine-owned IDs; projection layers are responsible for request-local handles.

## Plan

1. Keep model schemas, context projection, resolver/materializer code, and prompts in the same vocabulary.
2. Remove raw runtime records from model contexts; retain only semantic summaries and references needed for the current decision.
3. Add contract tests for duplicate labels, cross-execution identifiers, unknown references, proposal ordering, observer scoping, and context-size splitting.
4. Use the Inspector API v8 audit trail to verify that a model call, its source invocation, and its related graph/step records share one normalized identity.

## Verification

- `npx vitest run src/engine/contracts/__tests__/model-context.test.ts src/engine/prompts/prompts.test.ts src/engine/mechanics/__tests__/truth-batch-provider.test.ts src/engine/cognition/__tests__/observation-renderer.test.ts src/engine/algorithms/eager-reference/__tests__/eager-reference.test.ts src/engine/mechanics/__tests__/resolution-pipeline.test.ts --reporter=dot`
- `npm run check:fast`
- `npm run lint`
- `npm run typecheck`
- `node scripts/verify-decisions.mjs`
- Local startup acceptance for `/`, `/api/worlds`, and `/api/instances` as defined in [the repository instructions](../../AGENTS.md).

## Evidence

Pending human approval. The permanent rationale is recorded in [Decision 0086](../decisions/0086-model-semantic-contract-and-reference-boundaries.md); implementation evidence is maintained by the linked contract tests after this draft is approved and numbered.
