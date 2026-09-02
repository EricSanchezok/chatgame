# Agent-Native Debug Query Projections

## Status

Accepted
Class: architecture

## Context and Problem Statement

The Execution Ledger already preserves complete local evidence, but the current Inspector and operation commands require a caller to know instance and execution context, scan JSON correlation fields, load broad event sets, and follow indirect artifact references. A coding agent therefore spends more effort discovering the query path than interpreting the failure. The repository needs fast exact lookup across runtime, model, HTTP, persistence, and UI boundaries without creating a second source of truth or exposing credentials.

## Decision Drivers

- Keep `execution_events` and `execution_artifacts` as the only durable facts.
- Resolve a durable identifier without manual SQL or prior instance discovery.
- Support exact and indexed queries for high-value correlation and diagnostic fields.
- Make the CLI and Inspector share one deterministic query implementation.
- Rebuild derived indexes after a local failure and detect drift with a doctor command.
- Preserve forward-only saves, atomic execution semantics, replay identity, and cognitive isolation.
- Keep output useful to coding agents without dumping large payloads unless requested.

## Considered Options

1. Keep querying JSON fields directly and document manual SQL recipes.
2. Move evidence to a separate search database or external observability service.
3. Add generated columns only to `execution_events` and derive every summary at read time.
4. Add rebuildable SQLite event, issue, and invocation projections behind a shared query library.

## Decision Outcome

Use option 4. The Ledger remains authoritative. A SQLite projection layer extracts stable scalar correlation fields, normalized diagnostic issues, and logical invocation summaries into indexed tables. Projection rows are written with Ledger events where practical, can be rebuilt deterministically from the Ledger, and are checked by `debug doctor`. A shared server-side query library serves the CLI and trusted local Inspector routes. The CLI is the primary coding-agent entry point; the Inspector adds direct-ID navigation and visual lineage but does not expand ordinary player APIs.

The query contract uses explicit identifier fields and structured filters rather than a free-form SQL or search language. JSON/NDJSON output and stable exit codes are part of the CLI contract. Payloads are fetched only by explicit artifact/event requests, while credentials remain excluded by the existing Ledger redaction boundary.

## Pros and Cons of the Options

### Manual JSON queries

- Pros: no schema or write-path changes.
- Cons: slow, easy to get wrong, not agent-friendly, and repeatedly hydrates unrelated evidence.

### External search store

- Pros: strong search features and independent scaling.
- Cons: violates the local-only product shape, adds synchronization and retention failure modes, and creates a competing evidence system.

### Generated columns only

- Pros: minimal duplication and simple scalar indexes.
- Cons: issue arrays and logical invocation lineage remain awkward, and CLI/Inspector still duplicate projection logic.

### Rebuildable SQLite projections (selected)

- Pros: local, indexed, deterministic, easy to inspect, supports one-to-many issue records and invocation lineage, and keeps the Ledger as the source of truth.
- Cons: adds schema and rebuild code, requires projection integrity tests, and follows the repository's forward-only data-root rule.

## Links

- [Agent-Native Local Debugging spec](../specs/0016-agent-native-debugging.md)
- [Unified execution kernel and Ledger](0059-unified-execution-kernel-and-ledger.md)
- [Trusted world evolution Inspector](0055-trusted-world-evolution-inspector.md)
- [Runtime observability](../game-design/runtime-observability.md)
