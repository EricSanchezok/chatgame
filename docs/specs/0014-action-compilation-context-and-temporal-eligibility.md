# Action Compilation Context and Temporal Eligibility

Artifact-Version: 1
Status: Implemented

## Intent

Action Compilation must stop repeating complete world catalogs per slot and must reject semantically ineligible mechanic choices before trusted execution without reducing open-world action freedom. The implementation may reduce duplicated representation and selectively project candidate details, but it must retain the complete request-local reference namespace, preserve cognitive isolation, and keep atomic commit and deterministic replay behavior.

The change covers Action Compilation context projection, reference-use legality, temporal evidence and profile eligibility, semantic repair, experiment telemetry, and the bundled world's temporal coverage. It does not move deterministic mechanics into the model, preselect an action's meaning, truncate the candidate namespace, or relax canonical validation.

## Contract

Every Action Compilation batch receives one `referenceCatalog`. Every eligible existing reference remains addressable by its stable request-local handle. Each candidate carries one canonical `handle`, `kind`, `label`, `meaning`, `allowedUses`, and `scope`; `scope` is either batch-wide or names exactly one slot. The deterministic C3 projector includes details for references named by the slot state, eligible temporal profiles, the world clock, candidates matched by action text, placement neighbors, and their reference closure; every other candidate remains present with `details: null`. Action Compilation does not also receive per-slot `referenceCatalogs`, `availableHandles`, or a second `canonicalTruth` representation of the same facts.

Each output field declares the reference kinds and uses it accepts. The resolver reports a typed issue containing the field path, issue code, offending value, and a bounded set of legal alternatives. An `agent`, `local_entity`, or other candidate cannot enter a conflict, audience, pool, or global-arbitration field unless that candidate explicitly allows the field's semantic use. Global arbitration is derived from an accepted world reference rather than a parallel model-authored boolean.

Temporal selection is evidence-bound. Profiles expose machine-readable eligibility and required evidence. Exact source spans are extracted deterministically from action text for quantities, units, durations, deadlines, conditions, and ongoing intent. A `rate` profile is eligible only when a compatible explicit quantity span exists; the materializer consumes the verified span rather than searching the text again. Non-rate profiles remain available for semantically appropriate travel, reconnaissance, waiting, staged work, and ongoing activity. Bundled worlds declare sufficient profile coverage for those action classes.

Semantic repair preserves accepted slots and sends only typed issues, the rejected fields or slots, their prior values, and the evidence needed to correct them. Repair never serializes an unbounded catalog into prose. A stable failure fingerprint combines issue code, path, normalized offending value, and applicable contract version. Repeating a fingerprint triggers deterministic field correction when ownership permits it, bounded context expansion when evidence is missing, or bisection/failure according to the owning batch policy; it does not repeat an equivalent full request.

Temporal continuation is also a boundary-checked protocol. Before a temporal plan is materialized, every continuation assertion must already be true against the supplied current state; an assertion about a future elapsed boundary is invalid at onset and becomes a typed field-level repair issue. At a trusted transition boundary, every assigned action receives exactly one outcome. An active or paused Activity that has not reached its trusted completion boundary must receive `status: continuing`; once the boundary is reached it must settle with a terminal outcome. These checks are engine-owned and do not restrict the model's choice of open-ended action meaning.

The historical C0-C5 comparison used one recorded workload. `C0` was the recorded request; `C1` shared the full catalog once; `C2` used one normalized complete catalog; `C3` retained all candidates while selecting deterministic details; `C4` added bounded evidence expansion; `C5` added retrieval. The experiment selected C3 lexicographically: semantic correctness and replay invariants, then commit/non-inferiority gates, then input and repair cost. The comparison code and runtime flags were deleted after promotion; production contains only the C3 projector, while the corpus and reports remain immutable evidence.

The experiment report records request bytes by section, candidate count and detail coverage, known input/cache/output tokens, repair amplification, issue/fingerprint counts, invalid reference-use rate, temporal eligibility failures, commit result, semantic and state hashes, RNG transcript equality, and model/profile identity. Missing provider usage is recorded as unknown and never treated as zero.

The final contract is forward-only. Persisted saves and algorithm manifests from the replaced contract are obsolete; no compatibility projection or migration path is retained.

## Plan

Maintain the checked-in recorded corpus, gold evaluator, and offline/live reports as the reproducibility surface. Production Action Compilation calls only `projectActionCompilationContextForModel`, and its telemetry identifies `c3-deterministic-details`; historical comparison implementations and selection flags are not part of the codebase. Any replacement starts with a new correctness-first recorded and paired live experiment, updates this spec and [Decision 0087](../decisions/0087-bounded-action-compilation-context.md), and advances the forward-only algorithm and persistence contracts.

The architecture rationale belongs to [Decision 0087](../decisions/0087-bounded-action-compilation-context.md); this spec owns the observable behavior and acceptance gates.

## Verification

Recorded evaluation must reproduce the checked-in baseline from execution `15629bb7-a5c4-4132-8cda-d18d6cc78be2`. Gold cases cover no-number travel, explicit-distance travel, deadlines, staged activity, reconnaissance/ongoing work, invalid reference use, unknown handles, shared resources, onset reactions, global actions, repeated fingerprints, and oversized batches.

No candidate handle may disappear between an equivalent full and compact catalog. Deterministic materialization must reject a temporal profile without its required evidence and must accept compatible exact spans. Repair must preserve valid slots, omit unrelated full context, and terminate repeated fingerprints without an identical model request. Recorded replay must preserve world/state/causal hashes and random commitments for accepted outputs.

Run `npm run benchmark:action-compilation` to verify the preserved reports, the focused unit and integration projects, `npm run check:fast`, the paired DeepSeek V4 Flash evaluation matrix, bundled-world validation, execution replay/compare, and local startup acceptance. Live promotion requires zero candidate correctness hard-gate failures and no regression in candidate commit or profile accuracy before cost or latency improvements are considered.

## Evidence

The recorded C0-C5 evaluation preserves the complete candidate namespace for every variant and reduces C3 p95 per-slot bytes from 830,794 in C2 to 569,168. The paired DeepSeek V4 Flash matrix contains 72 cells: C2 and C3 across batch sizes 1, 5, and 12, twelve batches, and three repetitions with alternating order. C3 completes 36/36 runs and 216/216 profile checks; C2 completes 35/36 runs and 213/215 profile checks. C3 reduces p95 per-slot input tokens from 228,338 to 195,720 (14.28%), total input tokens from 8,993,126 to 7,431,785 (17.36%), repair amplification from 0.1137 to 0.0593, and physical calls from 42 to 39. Both variants resolve only `deepseek-v4-flash` with thinking disabled and one registry snapshot.

The immutable inputs and reports are the [recorded baseline](../../test/fixtures/action-compilation/baseline/README.md), [offline report](../../test/fixtures/action-compilation/offline-report.json), and [paired live report](../../test/fixtures/action-compilation/live-report.json). Production projection invariants are enforced by the Action Compilation context unit tests next to [`action-compilation-context.ts`](../../src/engine/algorithms/eager-reference/action-compilation-context.ts).
