# Agent-Native Local Debugging

Artifact-Version: 1
Status: Approved

## Intent

Make the local Living World Engine diagnosable by a Codex-class coding agent from any durable identifier or failure symptom. The feature covers the SQLite Execution Ledger, correlation, diagnostic codes, searchable projections, a unified CLI, Inspector entry points, repository instructions, and deterministic verification. It does not add remote operations, a cloud telemetry dependency, or a new runtime truth source.

All persisted diagnostic evidence remains locally transparent to the coding agent: execution metadata, runtime events, model audits, artifacts, replay records, and failure causes are queryable without manually translating identifiers or writing ad-hoc SQL. Credentials and API keys remain excluded from durable evidence.

## Contract

Every durable runtime event carries the existing execution, request, trace, span, model invocation, and transport identities when applicable, plus stable component and operation labels. Logical model repair and retry records carry explicit parent relationships. Diagnostics expose a stable code, owner domain, severity, retryability, evidence references, and a suggested next command.

SQLite keeps the Execution Ledger as the sole fact source and maintains rebuildable event, issue, and invocation lookup projections. Exact lookup supports public invocation IDs, execution IDs, request IDs, trace/span IDs, event sequences, artifact hashes, and diagnostic codes without requiring an instance ID. Metadata queries do not inflate unrelated artifact payloads; explicit artifact commands can retrieve the complete recorded JSON.

The `npm run debug -- <command>` CLI supports `find`, `inspect`, `lineage`, `events`, `artifact`, `explain`, `doctor`, `replay`, `compare`, and `export`. JSON is the machine-readable default, table and NDJSON are available, exit codes are stable, and error responses include recovery guidance. Existing execution commands remain functional through the shared query implementation.

The local Inspector can resolve a pasted public invocation ID, expose the matching event chain and diagnostic ownership, and show repair/retry lineage. The CLI provides server-side exact lookup beyond the first Inspector page. Ordinary player DTOs and AgentMind inputs remain unchanged.

The root `AGENTS.md` routes debugging work to a resident debugging skill. The skill defines a fixed evidence-first workflow, and `docs/debugging.md` is the single reference for current identifiers, commands, event taxonomy, schema, and test evidence.

## Plan

Add the diagnostic contract and rebuildable SQLite projections first, then the shared query library and CLI. Thread correlation and stable diagnostics through HTTP, WorldHost, execution, model, persistence, and Inspector boundaries. Add Inspector resolver/search/artifact routes and direct-ID UI selection. Finish with the Agent skill, documentation, verification gate, and focused integration/E2E evidence.

The database change is forward-only: the new schema uses a fresh `LIVINGWORLD_DATA_ROOT`; old SQLite schemas are not migrated or served through compatibility branches.

## Verification

Use temporary real SQLite databases to prove exact and cross-identifier lookup, index usage, projection rebuild parity, artifact retrieval, lineage, and doctor findings. Add CLI process tests for JSON output and exit codes, Route Handler tests for resolver/search/artifact behavior, and Inspector E2E coverage for direct ID search, pagination, lineage, and payload expansion. Preserve cognitive isolation, atomic rollback, replay/compare hashes, and existing model/prompt tests. Run `npm run check:fast`, `npm run check:ui`, `npm run check:all`, `git diff --check`, and the governance verifiers.

## Evidence

- [Debug query projection tests](../../src/server/__tests__/debug-query.test.ts) cover exact invocation/request/issue lookup, selected payloads, lineage, doctor findings, and rebuild parity.
- [Debug CLI tests](../../scripts/operations/debug-command.test.ts) cover help, JSON find/inspect, stable doctor output, and process-facing command behavior.
- [Route integration tests](../../src/app/api/__tests__/instance-routes.test.ts) cover request-id response headers, HTTP-to-Ledger correlation, debug search, direct invocation inspection, and doctor routes.
- [Debug contract gate](../../scripts/verify-debug-contract.mjs), `npm run typecheck`, `npm run lint`, and the repository `check:fast` command verify the shipped surface.
