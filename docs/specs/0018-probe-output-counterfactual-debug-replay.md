# Probe-output Counterfactual Debug Replay

Artifact-Version: 1
Status: Approved

## Intent

The immutable `debug replay <execution-id>` path is useful for reproducing a
recorded execution, but it cannot answer whether a different model output would
have changed the engine result. This spec adds an explicit, file-driven probe
overlay that replaces exactly one recorded model invocation with one trial from
an existing `model-invocation-probe` report.

The default replay remains immutable and consumes only Ledger outputs. Overlay
replay is local, deterministic, network-free, and never mutates the source
execution or canonical world state. The probe report is treated as evidence,
not as executable configuration.

## Contract

- `debug replay <execution-id>` and `execution:replay <execution-id>` accept
  `--probe-report <report.json>` and optional `--trial <n>` (default `1`).
- A report must be schema version `1`, kind `model-invocation-probe`, contain
  one source execution/invocation, and identify an invocation present in the
  source Ledger. The source public ID and source invocation ID must agree.
- The selected trial must be `accepted` or `rejected`, have
  `requestExactMatch: true`, and have a request hash equal to both the report
  source hash and the recorded invocation hash. Profile, prompt, schema, and
  context drift is rejected. Transport and configuration failures are not
  overlayable.
- An accepted trial supplies its normalized `output`; a rejected trial supplies
  its `rawOutput` and audit so the normal `ModelOutputError` and repair path run.
- The overlay provider is Ledger baseline plus one single-use replacement. The
  replacement audit is rebound to the recorded invocation identity. All normal
  schema, materialization, semantic validation, repair, and commit code runs.
- Exactly one overlay must be consumed. Unconsumed baseline output is allowed
  only when it belongs to the target invocation's logical lineage (including
  repair descendants); any unrelated unconsumed output is an integrity failure.
- A successful overlay returns structured `mode: "probe-overlay"`,
  `replayStatus: "succeeded"`, engine semantic status, source/child hashes,
  consumption details, probe ID, report hash, trial, and target invocation.
  Engine failure is a diagnostic result: the child execution is `failed` and
  the command still returns structured output. Invalid arguments, missing or
  mismatched evidence, and integrity/operational errors use non-zero exit
  status.
- The child replay stores the redacted complete report as an artifact and
  records runtime configuration and `debug.probe.overlay.applied` with report
  hash, probe/trial/target, request-match status, `probeNetworkAccessed: true`,
  and `replayNetworkAccessed: false`. Absolute paths are not persisted.
- No report discovery, `/tmp` scanning, variant execution, network access, new
  database tables, or source execution mutation is permitted.

## Plan

Add a shared report loader/validator, extend the recorded provider with a
single-point overlay and lineage-aware consumption accounting, and route both
CLI entry points through the same replay options and result shape. Persist the
redacted report artifact before running the pinned algorithm. Update debugging
and runtime observability references and add parser, provider, Ledger, and CLI
regressions.

## Verification

- Focused Vitest coverage proves report validation, accepted/rejected overlay,
  repair behavior, lineage accounting, source immutability, and zero replay
  network access.
- CLI tests prove default compatibility, explicit file/trial behavior, stable
  errors, and no automatic JSON discovery.
- `node scripts/verify-specs.mjs`, `node scripts/verify-decisions.mjs`, and
  `npm run check:fast` pass.

## Evidence

Implemented by [execution replay operations](../../scripts/operations/execution-command.ts),
[probe report model](../../src/engine/models/model-invocation-probe.ts), and
[Ledger replay tests](../../src/server/__tests__/execution-ledger.test.ts).
