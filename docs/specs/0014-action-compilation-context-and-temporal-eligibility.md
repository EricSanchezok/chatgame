# Action Compilation Context and Temporal Eligibility

Artifact-Version: 1
Status: Approved

## Intent

Action Compilation must stop repeating complete world catalogs per slot and must reject semantically ineligible mechanic choices before trusted execution without reducing open-world action freedom. The implementation may reduce duplicated representation and selectively project candidate details, but it must retain the complete request-local reference namespace, preserve cognitive isolation, and keep atomic commit and deterministic replay behavior.

The change covers Action Compilation context projection, reference-use legality, temporal evidence and profile eligibility, semantic repair, experiment telemetry, and the bundled world's temporal coverage. It does not move deterministic mechanics into the model, preselect an action's meaning, truncate the candidate namespace, or relax canonical validation.

## Contract

Every Action Compilation batch receives one `referenceCatalog`. Every eligible existing reference remains addressable by its stable request-local handle. A candidate may carry compact identity, use, visibility, and meaning data while deterministic projection controls whether its larger evidence details are present. Action Compilation does not also receive per-slot `referenceCatalogs`, `availableHandles`, or a second `canonicalTruth` representation of the same facts.

Each output field declares the reference kinds and uses it accepts. The resolver reports a typed issue containing the field path, issue code, offending value, and a bounded set of legal alternatives. An `agent`, `local_entity`, or other candidate cannot enter a conflict, audience, pool, or global-arbitration field unless that candidate explicitly allows the field's semantic use. Global arbitration is derived from an accepted world reference rather than a parallel model-authored boolean.

Temporal selection is evidence-bound. Profiles expose machine-readable eligibility and required evidence. Exact source spans are extracted deterministically from action text for quantities, units, durations, deadlines, conditions, and ongoing intent. A `rate` profile is eligible only when a compatible explicit quantity span exists; the materializer consumes the verified span rather than searching the text again. Non-rate profiles remain available for semantically appropriate travel, reconnaissance, waiting, staged work, and ongoing activity. Bundled worlds declare sufficient profile coverage for those action classes.

Semantic repair preserves accepted slots and sends only typed issues, the rejected fields or slots, their prior values, and the evidence needed to correct them. Repair never serializes an unbounded catalog into prose. A stable failure fingerprint combines issue code, path, normalized offending value, and applicable contract version. Repeating a fingerprint triggers deterministic field correction when ownership permits it, bounded context expansion when evidence is missing, or bisection/failure according to the owning batch policy; it does not repeat an equivalent full request.

Context variants are evaluated from the same recorded workload. `C0` is the recorded request; `C1` shares the full catalog once; `C2` uses one normalized complete catalog with complete details and no duplicate canonical truth; `C3` retains all candidates while selecting deterministic details; `C4` adds bounded evidence expansion; `C5` may add retrieval only if deterministic projection is insufficient. The shipped variant is chosen lexicographically: semantic correctness and replay invariants, then commit/non-inferiority gates, then input and repair cost. If no selective-details variant passes, `C2` is the required safe fallback.

The experiment report records request bytes by section, candidate count and detail coverage, known input/cache/output tokens, repair amplification, issue/fingerprint counts, invalid reference-use rate, temporal eligibility failures, commit result, semantic and state hashes, RNG transcript equality, and model/profile identity. Missing provider usage is recorded as unknown and never treated as zero.

The final contract is forward-only. Persisted saves and algorithm manifests from the replaced contract are obsolete; no compatibility projection or migration path is retained.

## Plan

First establish a replayable Ledger baseline and an evaluation command. Then implement temporal evidence and eligibility, one batch-wide catalog with field legality, typed minimal repair with fingerprint breaking, and the bundled script coverage. Run recorded C0-C5 and dynamic-enum experiments, promote only a correctness-qualified variant, then run DeepSeek V4 Flash live A/B and sandbox canaries. Finally delete losing runtime branches, bump the affected forward-only contracts, and replace obsolete local saves.

The architecture rationale belongs to [Decision 0087](../decisions/0087-bounded-action-compilation-context.md); this spec owns the observable behavior and acceptance gates.

## Verification

Recorded evaluation must reproduce the checked-in baseline from execution `15629bb7-a5c4-4132-8cda-d18d6cc78be2`. Gold cases cover no-number travel, explicit-distance travel, deadlines, staged activity, reconnaissance/ongoing work, invalid reference use, unknown handles, shared resources, onset reactions, global actions, repeated fingerprints, and oversized batches.

No candidate handle may disappear between an equivalent full and compact catalog. Deterministic materialization must reject a temporal profile without its required evidence and must accept compatible exact spans. Repair must preserve valid slots, omit unrelated full context, and terminate repeated fingerprints without an identical model request. Recorded replay must preserve world/state/causal hashes and random commitments for accepted outputs.

Run `npm run benchmark:action-compilation -- --database <sqlite> --execution <id> --verify <baseline>`, the focused unit and integration projects, `npm run check:fast`, the DeepSeek V4 Flash evaluation matrix, bundled-world validation, execution replay/compare, and local startup acceptance. Live promotion requires zero correctness hard-gate failures and no statistically material regression in step commit rate before cost or latency improvements are considered.

## Evidence

Pending implementation. The initial reproducible baseline lives in [the Action Compilation baseline fixture](../../test/fixtures/action-compilation/baseline/README.md).
