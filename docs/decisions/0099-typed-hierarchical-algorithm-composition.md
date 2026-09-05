# Typed hierarchical algorithm composition

## Status

Accepted
Class: architecture

## Context and Problem Statement

World execution exposes one versioned top-level algorithm with three lifecycle methods, but most behavioral choices live as constructors, conditionals, utility functions, tuning numbers, or benchmark-only retrievers below that seam. The flat component list records labels without expressing ownership or validated composition. One eager-specific candidate-retrieval type also leaks into generic runtime services. As a result, many algorithms exist, but they cannot be uniformly discovered, replaced, persisted, replayed, or inspected.

The system needs nested replaceability without making the canonical transaction kernel configurable, adding a generic untyped pipeline, or allowing operational callers to assemble unsafe execution graphs.

## Decision Drivers

- Make every genuine behavioral choice explicit, named, versioned, and replaceable at its natural scope.
- Preserve three stable top-level lifecycle methods and the engine-owned stage/telemetry sequence.
- Keep canonical invariants and uniquely correct mechanisms outside the algorithm system.
- Pin the complete behavior tree for persistence, experiments, evidence, and replay.
- Reject malformed or unavailable compositions before model calls or canonical-state work.
- Give implementation authors typed contracts instead of an untyped DAG or service locator.
- Generate discoverability documentation from executable registrations so inventory cannot drift.
- Keep ordinary APIs closed to arbitrary selection and hidden execution details.

## Considered Options

- Keep the top-level algorithm plus a flat informational component manifest.
- Add a generic phase pipeline whose nodes exchange JSON and are assembled dynamically.
- Use constructor dependency injection only, leaving persistence and discovery as separate conventions.
- Introduce typed Roles, registered Algorithms, and recursively pinned Compositions while retaining a fixed kernel and fixed top-level lifecycle.

## Decision Outcome

Adopt typed hierarchical algorithm composition. A Role defines one replaceability contract. An AlgorithmDefinition binds an exact Role/id/version to a strict configuration schema, named child-role schema, fresh-instance factory, and optional preflight. An AlgorithmRef persists explicit configuration, named children, Role contract version, and a deterministic recursive hash. A Composition is the fully materialized root AlgorithmRef.

The registry resolves the complete tree, validates every node, and assigns stable node paths. Engine infrastructure supplies generic services and node-scoped instrumentation; no concrete child type may leak into the world-execution runtime contract. Code registration is authoritative, while the human catalog is generated and checked in CI.

Keep `bootstrap`, `prepareStep`, and `completeStep` as the only top-level world-execution lifecycle methods. Preserve the engine-owned stages and canonical commit kernel. Extract replaceable behavioral nodes behind typed Role interfaces, including cognition, compilation, candidate selection, repair, grounding, reaction subdecisions, truth resolution, observation rendering, batching, scheduling, and output recovery.

Persist and replay the entire recursive identity. Experiment variants select complete Compositions, not ambient middleware. Existing bounded execution-tuning fields are translated by trusted builders into explicit child configurations; no general HTTP or UI algorithm selector is added. The trusted local Inspector and CLI expose the tree, while ordinary clients do not.

Use code-linked maturity metadata (`reference`, `candidate`, `diagnostic`) for discoverability and enrollment policy, but exclude maturity from behavior identity. Historical per-slot candidate selectors remain benchmark-only Algorithms under their versioned evaluation contract; promotion to an instance Composition requires a production Role adapter and accepted evidence. Do not support dynamic packages, compatibility readers, or fallback between Algorithms.

## Pros and Cons of the Options

### Flat component manifest

- Good: minimal code and preserves the current facade.
- Bad: component labels are not executable contracts, nested choices remain invisible, and replay cannot prove the selected implementation tree.

### Generic JSON pipeline

- Good: arbitrary graphs are easy to configure and visualize.
- Bad: weakens type safety, duplicates engine stage ownership, encourages accidental public configurability, and turns invariant enforcement into runtime convention.

### Constructor injection only

- Good: simple unit substitution and familiar object composition.
- Bad: does not provide canonical identity, recursive validation, catalog generation, experiment enrollment, or exact replay by itself.

### Typed Roles and recursive Compositions

- Good: local type-safe replacement, complete behavior identity, strict preflight, uniform evidence, generated discovery, and exact replay without replacing the fixed kernel.
- Bad: adds registry and manifest machinery, requires explicit adapters while behavior is extracted, and makes every behavior-affecting configuration change version-visible.

## Links

- [Spec 0021 — Hierarchical algorithm composition](../specs/0021-hierarchical-algorithm-composition.md)
- [Algorithm system reference](../game-design/algorithm-system.md)
- [0071 — Pin algorithms and own stable telemetry in the engine](0071-pin-algorithms-and-own-telemetry-in-the-engine.md)
- [0075 — Pin configured execution algorithms](0075-pin-configured-execution-algorithms.md)
- [0077 — Organize engine code by ownership boundaries](0077-engine-module-topology.md)
- [0097 — Action Compilation graph-aware candidate retrieval](0097-action-compilation-graph-retrieval.md)
- [0098 — Content-addressed embedding cache and immutable canary enrollment](0098-content-addressed-embedding-cache-and-immutable-canary-enrollment.md)
