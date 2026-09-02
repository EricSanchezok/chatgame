---
name: debugging
description: Use for any repository bug, failing test, runtime failure, model call issue, persistence inconsistency, Inspector problem, or unexpected UI/API behavior. It gives a deterministic evidence-first workflow for Codex-class coding agents.
---

# Local debugging workflow

Use this skill whenever a task involves finding or explaining a bug. The repository is local-only and the SQLite Execution Ledger is the durable evidence source. Do not infer a cause from model prose when a Ledger event, artifact, replay result, committed state, or test can establish it.

## Required sequence

1. Read the root `AGENTS.md`, the owning product document, and `docs/debugging.md`.
2. Run `npm run debug:doctor` against the active data root.
3. Classify every identifier in the report: invocation, execution, request, trace, span, event sequence, artifact, or diagnostic code.
4. Run `npm run debug -- find ... --format json` before writing ad-hoc SQL.
5. Run `inspect` for the matching object and `lineage` for parent, repair, retry, and child relations.
6. Expand a payload only when it is needed: `npm run debug -- artifact --artifact <hash>`.
7. Run `npm run debug -- explain <diagnostic-code>` to find the owning module, source files, tests, and next command.
8. Read the owning implementation from its shipped entry point downward, then read its primary test and relevant spec or decision.
9. Reproduce through the lowest real boundary that owns the behavior. Replace only external model HTTP, clocks, IDs, or similarly expensive nondeterminism.
10. Make the smallest forward-only change, add or update the regression evidence, and run the focused test first.
11. Run `npm run check:fast`; use `npm run check:ui` when a browser or Inspector surface changed.
12. Report facts, inferences, and unresolved questions separately.

## Identifier recipes

```sh
npm run debug -- find --invocation '<execution-id>::<source-invocation-id>'
npm run debug -- find --execution '<execution-id>'
npm run debug -- find --request '<request-id>'
npm run debug -- find --trace '<trace-id>'
npm run debug -- find --issue '<diagnostic-code>'
npm run debug -- inspect --invocation '<public-id>' --payload
npm run debug -- lineage --invocation '<public-id>'
npm run debug -- events --execution '<execution-id>'
```

## Evidence rules

- Treat `execution_events` and `execution_artifacts` as facts; event, issue, and invocation indexes are rebuildable projections.
- Preserve the complete ID and the first/last Ledger sequence in notes and bug reports.
- Prefer stable diagnostic codes and owner maps over stack line numbers.
- Use `execution:replay` or `npm run debug -- replay` to distinguish recorded model behavior from engine behavior.
- Use `execution:compare` or `npm run debug -- compare` to compare semantic, temporal, transition, observation, and mind partitions.
- Never print, copy, or persist API keys, cookies, bearer tokens, or environment secrets.

## Required report shape

```text
Symptom:
Resolved identity:
First anomalous boundary:
Ledger evidence:
Owning module:
Reproduction:
Fix and regression:
Verification:
Unresolved:
```
