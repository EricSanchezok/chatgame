# Engine Module Topology

Artifact-Version: 1
Status: Approved

## Intent

`src/engine/` has grown into a flat collection of algorithm code, model-provider
integration, cognition, mechanics, runtime orchestration, and shared contracts.
The flat layout makes ownership unclear and makes adding a second algorithm or
provider risk accidental coupling. This spec establishes a discoverable module
topology without changing simulation semantics, persistence contracts, or public
API behavior.

## Contract

Production engine code is organized by ownership:

- `engine/algorithms/` contains algorithm definitions and algorithm-owned
  implementations. `algorithms/eager-reference/` owns Action Compilation,
  AgentMind, dependency grounding, prompts, and slot batching.
- `engine/models/` contains model catalog, registry, provider protocols,
  adapters, Gateway, scheduling, and model execution audit support.
- `engine/cognition/` contains Agent perspective, belief/character updates,
  observations, information boundaries, and mind commits.
- `engine/mechanics/` contains temporal, resolution, causality, random,
  Truth Engine, rule packages, and shared-resource mechanics.
- `engine/runtime/` contains the fixed execution contract, SimulationEngine,
  CanonicalCommitter, transactions, lifecycle evidence, IDs, replay, and world
  runtime definitions.
- `engine/contracts/` contains shared semantic state types, model-output
  schemas, and prompt/context contracts used across ownership boundaries.
- `engine/benchmarks/` contains benchmark-only code that is not on the product
  execution path.

Operational TypeScript entrypoints are grouped under `scripts/experiments/` and
`scripts/operations/`. Governance scripts remain at `scripts/` because the
repo-seed manifest and CI invoke those paths directly.

The refactor preserves every exported symbol, import-time server-only boundary,
model-visible context boundary, canonical state transition, persistence schema,
and CLI command. No compatibility re-export files or duplicate implementations
remain at the old paths. Tests may live beside their owned module under a local
`__tests__/` directory; Vitest discovers them recursively.

Dependencies are allowed to point from entrypoints and algorithms to contracts,
models, cognition, mechanics, and runtime. The fixed runtime and contracts must
not import a concrete algorithm implementation. A concrete algorithm may use
runtime interfaces but may not mutate canonical state directly.

## Plan

1. Add the topology and rationale records before implementation.
2. Move production modules and owned tests with `git mv`.
3. Rewrite only mechanical relative imports and package/README/spec links.
4. Update the architecture map and development commands to name the new owners.
5. Run typecheck, unit/UI builds, world validation, governance gates, and the
   existing live smoke entrypoints.

## Verification

- `npm run check:fast`
- `npm run build`
- `npm run world:validate -- worlds/blackmarsh/world`
- `npm run check:ui`
- `node scripts/run-gates.mjs`
- `rg --files src/engine scripts` shows no production modules at the old flat
  engine root and all documented links resolve.

## Evidence

Pending implementation. The completed record will link the architecture map,
the topology ADR, and the passing CI-equivalent checks.
