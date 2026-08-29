# Prompt Architecture and Evaluation

Artifact-Version: 1
Status: Draft

## Intent

Define a model-request contract in which each Living World call has a concise English system role, a one- or two-sentence task envelope, and a clearly marked runtime data context. Keep world-script narrative language, canonical truth, Agent perspective, structured schemas, deterministic validators, repair behavior, fallback behavior, and recorded replay unchanged.

## Contract

Prompt resources live in `src/engine/prompts/` and are loaded by a cached server-side loader that normalizes UTF-8 text, rejects empty or unresolved assets, and derives a content hash version. `StructuredModelRequest` requires `system`, `userPrompt`, and `context`; every adapter receives the same task-before-context envelope, with transport-specific schema or tool instructions appended only where required.

The loader must expose separate bundle versions for Truth stages and other roles. Context JSON remains data and is not rewritten into instructions. Request byte budgets, eager slot batching, observation batching, and Gateway checks use one serialization function. Audit events expose system, user, context, and total request byte measurements without adding persistent state fields.

No prompt asset contains Chinese instruction text. No production model call embeds model-visible prompt prose in TypeScript. App and browser modules do not import the prompt loader. Canonical identity bindings and cross-Agent cognition remain inaccessible to ordinary Agent, Observation, Arrival, and narrator calls.

## Plan

Maintain role and task resources as Markdown, compose them through `promptBundle`, and use `structuredPromptBytes` in all request-size calculations. Include prompt files in Next standalone output tracing. Add offline scenario evaluation for private cognition, concurrent Truth resolution, hidden Observation/Arrival information, action compilation and grounding boundaries, and targeted verifier rejection; preserve live A/B reports as review artifacts outside CI.

## Verification

Run `npm run verify:prompts`, `npm run prompt:evaluate`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, world validation, workflow checks, governance gates, and recorded replay tests. The offline evaluator must prove task-before-context ordering, data labeling, context preservation, English resources, unique content-addressed versions, and unchanged schema/validator behavior. Live A/B reports record input/output/reasoning tokens, repair and fallback counts, structured acceptance, role consistency, task completion, leakage, and narration quality for the five scenarios.

## Evidence

Pending human approval and final evaluation evidence. Baseline metadata is stored in [`test/fixtures/prompt-evaluation/baseline/metrics.json`](../../test/fixtures/prompt-evaluation/baseline/metrics.json); the deterministic evaluator is [`scripts/experiments/prompt-evaluation.ts`](../../scripts/experiments/prompt-evaluation.ts).
