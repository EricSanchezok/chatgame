# Hierarchical algorithm composition

Artifact-Version: 1
Status: Approved

## Intent

Make every heuristic, model-driven decision, selection, planning, batching, scheduling, and recovery policy in world execution explicitly replaceable without turning the canonical transaction kernel into a plugin system. A large execution algorithm may compose smaller algorithms, but every replaceable node must have a named role, a versioned implementation, validated configuration, stable identity, and an independently testable contract.

The design must preserve the small top-level world-execution seam: callers still use `bootstrap`, `prepareStep`, and `completeStep`. It must also preserve script-driven generality, cognitive isolation, strict canonical commits, replay determinism, immutable instance enrollment, and ordinary-client secrecy. Dynamic package loading and arbitrary HTTP or UI algorithm selection are out of scope.

## Contract

The vocabulary is normative:

- A **Role** is a typed replaceability boundary with one behavioral contract.
- An **Algorithm** is a named and versioned implementation of one Role.
- A **Composition** is a recursively pinned tree of Algorithms.
- **Runtime** describes infrastructure and execution state, not an algorithm identity.
- **Strategy** is implementation-internal and cannot be persisted as algorithm identity.

The built-in execution Composition contains these Roles:

- `world-execution`
- `agent-cognition`
- `action-compilation`
- `candidate-selection`
- `symbol-repair`
- `interaction-grounding`
- `reaction-resolution`
- `onset-perception`
- `reaction-decision`
- `truth-resolution`
- `observation-rendering`
- `work-batching`
- `work-scheduling`
- `output-recovery`

Canonical state validation, references, permissions, quantities, conservation, random commitments, causality, transaction atomicity, and mechanisms with exactly one correct result remain fixed kernel code. They are not replaceable Algorithms.

Every persisted node is an `AlgorithmRef` containing its Role, implementation id, implementation version, Role contract version, explicit JSON configuration, named child nodes, and a recursive SHA-256 manifest hash. Child order does not affect identity; child slot names, complete child identity, configuration, and contract version do. Persisted refs never acquire implicit defaults. Defaults exist only in named Composition builders that materialize a complete manifest before persistence.

The registry is the source of truth. Each `AlgorithmDefinition` declares exactly one Role, id and version, its configuration schema, allowed named child slots and child Roles, a fresh-instance factory, and optional preflight validation. Resolution rejects unknown implementations, wrong Roles or versions, missing or additional child slots, unknown configuration fields, non-canonical JSON, hash drift, and factories that return a reused or mismatched instance. Stable node paths such as `root.actionCompilation.candidateSelection` are assigned by composition resolution and supplied to engine-owned instrumentation.

The default Composition is `world-execution/eager-reference@16`. Its default candidate-selection child is `candidate-selection/full-catalog@1`, so FullCatalog is an explicit algorithm rather than an absent feature. The graph treatment is `candidate-selection/graph-hybrid-e5@1`; its explicit configuration pins budget, path depth, encoder fingerprint, passage/cache schema, and any ranker artifact hash. It fails closed when required assets are unavailable and never retries with FullCatalog.

Existing request-level execution tuning remains a bounded convenience surface rather than a general selector. Its five slot/concurrency fields materialize validated batching or scheduling child configurations in a complete Composition. Ordinary world APIs do not expose Composition identity or experiment enrollment.

Benchmark candidate selectors implement the same asynchronous `candidate-selection` Role used by production. Benchmark metadata classifies implementations as `reference`, `candidate`, or `diagnostic`; maturity is catalog metadata and is not part of the recursive manifest hash. Only implementations backed by exact experiment evidence may be enrolled as candidates. Diagnostic implementations cannot enter production compositions.

World instances persist the complete recursive Composition and immutable experiment enrollment. Replay resolves the exact tree before provider or canonical-state work and fails closed if any descendant is unavailable or its identity differs. Runtime evidence identifies each replaceable node by path, Role, id, version, and manifest hash. The trusted local Inspector may expose the complete tree and configuration; ordinary clients may not.

This is a forward-only boundary. Execution Contract v6, WorldInstance v23, Preparation v5, Experiment Manifest v2, Runtime Event v4, Inspector API v13, and eager-reference v16 replace their predecessors without migration or dual readers. Local development uses `.livingworld-v23/`; older data roots remain untouched but are not read.

## Plan

Introduce the Role contracts, recursive manifest and registry before changing behavior. Characterize the existing FullCatalog execution path, then compose the current execution behavior from registered child Algorithms while extracting batching, scheduling, recovery, candidate selection, and model-driven stages behind their Role contracts. Upgrade persistence, experiments, replay, events, and Inspector projections together. Generate the algorithm catalog from the registry and add a CLI plus static dependency and registration gates.

## Verification

Prove recursive hash determinism; strict configuration and child validation; exact role/version lookup; fresh instances; independent Role substitution; unchanged FullCatalog request sequencing and candidate/state hashes; graph selector privacy, anchors, budgets, cache preflight, and no fallback; immutable experiment enrollment; exact-tree replay; node identity in evidence and Inspector; hidden identity in ordinary APIs; generated-catalog freshness; and forbidden concrete imports.

Run focused unit/integration tests, `npm run algorithms -- validate`, `npm run algorithms -- catalog --check`, `npm run check:fast`, `npm run build`, `npm run check:ui`, `npm run world:validate -- worlds/blackmarsh/world`, retrieval cache/benchmark verification, `node scripts/run-gates.mjs`, `git diff --check`, and the local startup acceptance checks for `/`, `/api/worlds`, and `/api/instances`.

## Evidence

Pending implementation.
