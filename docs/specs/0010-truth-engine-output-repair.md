# Truth Engine Output Quality and Local Repair Layers

Artifact-Version: 1
Status: Approved

## Intent

Model output quality, semantic repair, conflict scope, and observation rendering must have separate responsibilities. Unknown references, stale mechanic fields, observer privacy violations, and structured-output failures must not expand into global conflict or be hidden by context reduction. The implementation preserves open semantics, complete context, atomic commits, and replay determinism.

## Contract

Model output failures enter a bounded semantic repair loop that records scope, issue class, attempt, target IDs, and complete model audits. Transport, configuration, overload, and cancellation failures do not enter semantic repair. Every repair retains the complete semantic namespace and the evidence needed by its rejected target; exceeding a profile's `max_input_bytes` raises `ContextLimitExceeded` directly rather than silently removing candidates. Action Compilation's batch projection, evidence expansion, and minimal-repair contract are defined by [Spec 0014](0014-action-compilation-context-and-temporal-eligibility.md).

Unknown entities, facts, audiences, pools, aliases, and private evidence produce only action- or invocation-local reference issues. `globalFallback` is true only when the model supplies the canonical `{kind:"global",id:"world"}` reference and validation accepts it; genuine global semantics still use the global component. Action Compilation preserves valid slots and, when raw output identifies them, retries only malformed slots.

Truth Transition receives the enabled RulePackage package, version, rule, description, and JSON input schema in its complete context. Each mechanic invocation is preflighted against the trusted rule before execution; stale fields trigger invocation-level repair, and direct operations cannot bypass the contract.

The resolution-plan verifier repairs the smallest plan target identified by a finding and re-verifies before random commitments are submitted. The causal verifier re-renders only affected observers for observation-only findings; other findings stay within the owning component and remain subject to atomic validation.

Observation Renderer gives every observer an independent output, audit, and repair record while sending each request the complete candidate world and authorized observer view. A single observer's structural, reference, or privacy failure affects only that observer; exhausted repair produces a typed uncertainty observation without changing canonical truth.

## Plan

Shared semantic-repair orchestration and transport/output telemetry define error classification. Action dependency, Action Compilation, RulePackageRegistry, TruthEngine, Observation Renderer, and deterministic fixtures implement their local contracts. Reference-world content remains script-driven; the test baseline uses schema v14 and the current core-resolution package.

## Verification

Verify that unknown and private references never create a global component while an explicit global reference still covers all nodes; that malformed slots, missing resolution plans, stale mechanic input, causal observation findings, and observer privacy failures affect only their declared targets; and that completion-order changes do not alter world hashes, causal hashes, or RNG transcripts. Context-limit and repair-exhaustion failures must never produce partial canonical commits.

Run `npm run check:fast`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run verify:prompts`, `npm run world:validate -- worlds/blackmarsh/world`, and `node scripts/run-gates.mjs`.

## Evidence

Implementation evidence is captured by the [mechanic contract tests](../../src/engine/mechanics/__tests__/rule-package.test.ts), [resolution pipeline tests](../../src/engine/mechanics/__tests__/resolution-pipeline.test.ts), [observation renderer tests](../../src/engine/cognition/__tests__/observation-renderer.test.ts), [action dependency tests](../../src/engine/mechanics/__tests__/action-dependency.test.ts), and [eager reference tests](../../src/engine/algorithms/eager-reference/__tests__/eager-reference.test.ts).
