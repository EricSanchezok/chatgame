# Pin algorithms and own stable telemetry in the engine

## Status

Accepted
Class: architecture

## Context and Problem Statement

`WorldExecutionAlgorithm` provides a bootstrap/step seam, but production hosts and replay still select the eager reference implementation directly. World instances do not persist an algorithm identity, algorithm candidates expose eager-specific intermediate structures, and algorithms emit free-form events that stable metrics interpret without validating their semantic contract. The seam therefore permits implementation substitution only under an existing eager identity and cannot guarantee that execution evidence describes the producer that actually ran.

The event-boundary runtime also makes decision eligibility and temporal boundaries engine facts. Alternative algorithms need those facts as input, while observability must stay comparable and truthful regardless of how a candidate is generated.

## Decision Drivers

- Canonical state and stable observability remain engine-owned.
- A world instance executes one exact algorithm identity across process restarts.
- Production and replay resolve algorithms through one mechanism.
- The algorithm interface stays small enough for independent research implementations.
- Candidate evidence contains one home for each fact and no eager-only diagnostics required by the committer.
- Dynamic temporal work and failed model work remain observable without algorithm-specific metric definitions.
- The eager implementation receives focused responsibility boundaries without a general execution framework.

## Considered Options

- Keep eager hard-coded and allow test-only substitution under the eager identity.
- Let algorithms own event schemas and export arbitrary metrics.
- Introduce a plugin framework with lifecycle hooks and public configuration.
- Pin a versioned internal algorithm reference, use a validated registry, and keep stable telemetry in the engine.

## Decision Outcome

Living World Engine pins an `AlgorithmRef` in each WorldInstance and records an exact producer manifest in every Ledger execution. A validated registry resolves that reference and constructs a fresh algorithm from engine-supplied services. The manifest and candidate declare explicit contract versions. Production, bootstrap, and replay use the registry; engine operations use a separate producer identity.

The public algorithm contract remains `bootstrap` and `step`. Inputs carry engine-derived decision eligibility. Candidates carry algorithm-neutral resolution, dependency evidence, temporal results, private-state commits, one audit collection, and bounded typed diagnostics. The fixed committer validates these materials and derives observations independently. Ambient randomness, duplicate observation lists, duplicate audits, and eager component outputs are not part of the contract.

Stable runtime events, metric dimensions, aggregation, and execution-work derivation belong to the engine. Algorithms receive a typed instrumentation API for declared phase and degradation signals. Common lifecycle and result metrics are derived after candidate validation, so an implementation cannot omit or redefine them. Model instrumentation accumulates work before failures reach the execution boundary.

The eager reference implementation delegates action dependency analysis and temporal planning to focused internal modules while remaining the orchestration owner. No general phase pipeline, external package loader, training contract, or public algorithm selector is introduced.

## Pros and Cons of the Options

### Hard-coded eager with test substitution

- Good: preserves the smallest code change.
- Bad: instances and Ledger evidence cannot identify a genuine alternative algorithm, and replay remains coupled to one implementation.

### Algorithm-owned telemetry

- Good: implementations can evolve diagnostics independently.
- Bad: stable metrics become incomparable, omissions look like zero work, and typoed event fields silently corrupt evidence.

### General plugin framework

- Good: supports third-party discovery and lifecycle customization.
- Bad: adds loading, security, compatibility, and configuration surfaces before the repository needs them.

### Pinned registry with engine-owned telemetry

- Good: provides exact identity, replayable construction, comparable evidence, and a small research-facing seam.
- Bad: requires forward-only schema changes, conformance tests, and explicit evolution of the algorithm and event contracts.

## Links

- [Approved algorithm runtime contract v2 Spec](../specs/0004-algorithm-runtime-contract-v2.md)
- [0059 — Unified execution kernel and Ledger](0059-unified-execution-kernel-and-ledger.md)
- [0063 — Eager-reference execution](0063-eager-reference-execution.md)
- [0070 — Event-boundary temporal runtime](0070-event-boundary-temporal-runtime.md)
- [Gymnasium environment API](https://gymnasium.farama.org/api/env/)
- [Gymnasium environment registration](https://gymnasium.farama.org/main/api/registry/)
- [PettingZoo environment tests](https://pettingzoo.farama.org/main/content/environment_tests/)
- [OpenTelemetry library instrumentation](https://opentelemetry.io/docs/concepts/instrumentation/libraries/)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
