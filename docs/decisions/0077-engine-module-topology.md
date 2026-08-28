# Organize Engine Code by Ownership Boundaries

## Status

Proposed

Class: architecture

## Context and Problem Statement

The engine currently keeps algorithm orchestration, model integration, private
cognition, mechanics, runtime infrastructure, and shared schemas in one flat
directory. File names distinguish some concepts, but the filesystem does not
show who owns a behavior or which code is safe to depend on. This increases the
cost of finding code and makes a future algorithm or provider likely to leak
into the fixed kernel.

## Decision Drivers

- A new contributor should be able to find an owner from the path alone.
- Algorithm-specific tuning must remain outside the fixed engine and model
  Gateway.
- Shared contracts need an explicit home that does not imply provider ownership.
- The reorganization must be forward-only and preserve the existing behavior.
- CI, governance scripts, and public command paths must remain predictable.

## Considered Options

- Keep the flat directory and rely on naming conventions.
- Organize by technical layer only (`kernel`, `adapters`, `services`).
- Organize by feature only, duplicating shared mechanics per feature.
- Use a hybrid ownership topology with explicit algorithm, model, cognition,
  mechanics, runtime, contract, and benchmark packages.

## Decision Outcome

Use the hybrid ownership topology specified by [Spec 0009](../specs/0009-engine-module-topology.md).
Concrete eager-reference code lives under `engine/algorithms/eager-reference/`;
generic algorithm registration lives under `engine/algorithms/`. Model-provider
integration lives under `engine/models/`, shared semantic types under
`engine/contracts/`, and fixed execution infrastructure under `engine/runtime/`.
The mechanics and cognition packages are separate because they have different
change owners and different privacy/semantic responsibilities. Benchmark and
operational entrypoints are kept off the product runtime path.

The topology is organizational, not a new runtime abstraction. Existing public
exports, AlgorithmRef identity, model Gateway scheduling, canonical committing,
world scripts, and persistence contracts stay unchanged. Old paths are removed
after imports are migrated; compatibility shims are not retained.

## Pros and Cons of the Options

### Flat directory

- Good: minimal path churn.
- Bad: ownership is implicit, discovery degrades as the engine grows, and
  algorithm-specific code is easy to confuse with fixed-kernel code.

### Technical layers only

- Good: familiar broad categories.
- Bad: it hides which layer is algorithm-owned and encourages cross-layer
  utility dumping.

### Feature-only packages

- Good: feature changes are colocated.
- Bad: shared cognition and mechanics would be duplicated or pulled through
  unstable feature boundaries.

### Hybrid ownership topology

- Good: preserves shared concepts once, makes algorithm ownership explicit, and
  keeps the fixed runtime boundary visible.
- Bad: requires a one-time import migration and discipline when adding modules.

## Consequences

The architecture map and contributor commands must use the new paths. Future
algorithms add a package under `engine/algorithms/` rather than adding another
root-level implementation file. Governance scripts remain at their managed
paths, while product-oriented scripts are grouped by purpose.

## Links

- [Engine Module Topology Spec](../specs/0009-engine-module-topology.md)
- [System architecture](../architecture.md)
- [0071 — Pin algorithms and own stable telemetry in the engine](0071-pin-algorithms-and-own-telemetry-in-the-engine.md)
