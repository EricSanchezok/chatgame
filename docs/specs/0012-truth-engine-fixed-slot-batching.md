# Truth Engine fixed slot batching

Artifact-Version: 1
Status: Implemented

## Intent

Reduce Truth Engine model-call cardinality without changing world semantics. Components already proven independent by the interaction graph are assigned to fixed-size slots in structured requests. A slot remains an independent resolution, transition, observation, or causal-verification responsibility; batching is transport-level orchestration only.

The complete world definition, canonical truth, semantic history, all actions, and all groundings remain model-visible. No clipping, summarisation, retrieval, or adaptive context reduction is permitted. Real global, dynamic-lifecycle, and unproven-independent work keeps the existing single/global path.

## Contract

`executionTuning.truthBatchMaxSlots` is an integer from one through sixty-four and defaults to twelve. It is pinned in the eager-reference algorithm manifest, which is forward-only version `8`; old producers are obsolete saves and are not migrated.

Truth roles use a fixed initial batch size. A complete batch that exceeds the selected profile's `max_input_bytes` raises `ContextLimitExceeded` immediately and is never shrunk or split. A structurally invalid batch may retry as the same batch and then split deterministically; a semantic slot failure repairs only that slot. Transport, configuration, overload, and cancellation errors remain terminal. No partial canonical state is committed.

Each physical request has one audit and one deterministic batch invocation identity. The engine maps numbered slots to canonical component/observer keys, requires complete unique coverage, validates and materializes every slot independently, and rejects cross-slot references. RNG/check commitments remain engine-owned and are consumed in canonical component/action order. Replay consumes the complete physical batch output and unpacks slots deterministically.

Resolution, plan verification, transition, final causal verification, and observation projection may batch only slots with the same stage, profile, prompt contract, and full-context boundary. Global fallback, dynamic lifecycle, and discovered cross-component effects retain the existing global resolver/projection semantics.

## Plan

Add a reusable Truth batch coordinator around the existing structured provider boundary, introduce strict stage-specific slot schemas, pin the batch limit in eager-reference configuration, and preserve existing per-slot materialization and repair paths. Extend observation and experiment telemetry to count physical calls and logical slots, then verify deterministic replay and hard input-limit behavior with fixture and reference-world tests.

## Verification

Cover fixed grouping and tail batches, complete/duplicate/missing/unknown slot coverage, hard context overflow, structural retry/bisection, slot-local repair, deterministic completion-order changes, RNG transcript equality, cross-component conflict closure, observation privacy, replay, and the 48-agent experiment. Run `npm run check:fast`, `npm run build`, `npm run world:validate -- worlds/blackmarsh/world`, `node scripts/run-gates.mjs`, and the deterministic batching smoke.

## Evidence

Implemented in [`truth-batch-provider.ts`](../../src/engine/mechanics/truth-batch-provider.ts), [`truth-engine.ts`](../../src/engine/mechanics/truth-engine.ts), and [`eager-reference.ts`](../../src/engine/algorithms/eager-reference/eager-reference.ts). Contract coverage lives in [`truth-batch-provider.test.ts`](../../src/engine/mechanics/__tests__/truth-batch-provider.test.ts), the eager-reference safeguards, experiment, and Blackmarsh 48-Agent tests.
