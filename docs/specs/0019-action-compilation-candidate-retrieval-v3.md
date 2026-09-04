# Action Compilation candidate retrieval v3

Artifact-Version: 1
Status: Implemented

## Intent

Provide an offline, deterministic experiment and an opt-in production
middleware for reducing the Action Compilation model-facing candidate catalog
while keeping FullCatalog resolution authoritative. The frozen
`fullcatalog-stabilized/v1` benchmark remains unchanged and is a behavioral
reference rather than semantic ground truth.

## Contract

The v3 experiment evaluates A0/A1 controls, lexical D1, typed role-constrained
graph retrieval, local multilingual-E5 retrieval, hybrid coverage selection,
and an optional pairwise-linear ranker. Formal runs use a per-slot budget of
`floor(fullVisibleCount * 0.20)` and never fall back to FullCatalog or expand
the budget. A strict p95 shortlist ratio below 0.20 is required in addition to
micro and macro recall of at least 0.90, average compression above 0.80, zero
invalid/private keys, zero budget violations, and deterministic output. 25% and
30% runs are diagnostics only.

The graph index is keyed by catalog hash and includes typed relations for
agent/entity identity, placement/container, entity state, fact subject/object,
conditions, action actor/target/profile, and candidate references. Retrieval
seeds action, actor/entity, unique target, eligible profile, and visible
perspective aliases; path traversal is role-constrained and candidate keys are
never treated as semantic text.

The local encoder is `intfloat/multilingual-e5-small` with fixed `query:` and
`passage:` prefixes, normalized exact dot-product search, local-only assets,
and recorded directory/library hashes. Missing or mismatched assets fail
closed. A linear ranker uses feature schema version 1, seed 20260904, pairwise
logistic SGD, learning rate 0.05, L2 0.0001, and at most 100 epochs. Fewer than
200 cases or three independent snapshots produces an exploratory, non-
promotable artifact.

Production integration is opt-in through `CandidateRetrievalMiddleware` on
`ModelExecutionScope`. It clones the full context, verifies visibility,
anchors, and budget, prunes hidden references in retained details, and passes
only the shortlist to the model gateway. The materializer, resolver, symbol
repair, semantic validation, transaction, and commit paths retain the complete
catalog. Missing anchors, invalid/private keys, over-budget output, and
out-of-shortlist model references are recorded or rejected without an implicit
FullCatalog retry. `isDeterministicCanary` assigns a stable 30% instance-level
canary bucket from `sha256(instanceId + algorithmManifestHash) % 100`.

Before middleware, full context and exact pre-step state may be captured in
full observability mode. Capture is read-only and secret-scanned. Regeneration
is an explicit, versioned live-provider operation; offline evaluation never
calls an LLM, network, or world mutation. Frozen benchmark versions are never
overwritten.

## Plan

Graph retrieval and v3 reporting live under
`src/engine/benchmarks/action-compilation/`. The v3 comparison CLI writes only
to a new evaluation directory and reports bootstrap confidence intervals,
per-case risk, kind/use strata, union recall, and missing-path diagnostics.
Training and source capture use `.livingworld-benchmarks/`, which is ignored by
Git. The Action Compilation compiler applies the middleware only when supplied
by trusted local execution scope and emits a full-context capture event.

## Verification

The following prove the contract:

- `npm run benchmark:verify:action-compilation-reference`
- `npm run benchmark:compare:action-compilation-retrieval-v3 -- --dataset benchmarks/action-compilation/fullcatalog-stabilized/v1 --deterministic-only`
- `npm test -- src/engine/benchmarks`
- `npm run check:fast`

The frozen v1 control has 46 cases, 24 contexts, and FullCatalog recall 1.0.
The current local encoder asset is absent, so encoder runs report `blocked`
until the pinned directory is installed; no automatic download is permitted.

## Evidence

- [v3 retrieval experiment evaluator](../../src/engine/benchmarks/action-compilation/retrieval-experiment-v3.ts)
- [Graph-aware retriever tests](../../src/engine/benchmarks/action-compilation/retrievers/graph-aware.test.ts)
- [Middleware tests](../../src/engine/benchmarks/action-compilation/candidate-retrieval-middleware.test.ts)
- [Decision 0097 — Action Compilation graph-aware candidate retrieval](../decisions/0097-action-compilation-graph-retrieval.md)
