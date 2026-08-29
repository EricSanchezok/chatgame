# Prompt refactor baseline

This fixture records the pre-refactor prompt surface at commit `dc0c9f71a5c9d1a21de66291045b2b94b1f4bfcf`. It is intentionally metadata-only: recorded model results and deterministic replay artifacts remain the source of truth for semantic and state comparisons.

The five scenario identifiers are the stable cases used by the offline evaluator:

- `agent-private-cognition-conflict`
- `truth-concurrent-resource-competition`
- `observation-arrival-hidden-information`
- `action-compilation-grounding-boundaries`
- `verifier-targeted-rejection`

Run `npm run prompt:evaluate` to produce a current report with the same scenario identifiers, prompt bundle versions, request byte accounting, and structural acceptance checks. Live provider A/B results are intentionally kept out of CI and should be stored as a separate JSON report.
