# Truth Engine Output Repair Boundaries

## Status
Accepted
Class: architecture

## Context and Problem Statement

Truth Engine model output simultaneously carried semantic proposals, mechanic input, conflict scope, and observer rendering. Unknown or private references were normalized into global dependencies, batch structure failures regenerated already-valid slots, stale mechanic fields surfaced only during trusted execution, and one observer's privacy failure delayed the entire batch. This expanded the failure surface and made performance, semantics, and failure causes difficult to measure independently.

## Decision Drivers

- Preserve open-world natural-language freedom, complete context, and trusted rule execution.
- Give structure, reference, mechanic, privacy, causal, and transport failures separate responsibility boundaries.
- Execute independent work items concurrently while preserving atomic canonical commits and replay determinism.
- Keep genuine global semantics on a global joint path instead of splitting them for performance.

## Considered Options

- Continue promoting unknown references and exhausted repairs into global fallback.
- Reduce model context with summaries or singleton fallback to lower request cost.
- Use complete context, runtime-contract preflight, target-level semantic repair, independent observer slots, and conservative component boundaries.

## Decision Outcome

Adopt the third option. `globalFallback` is true only after a canonical global reference passes validation; unknown, fuzzy, private, or inconsistent references create local repair issues. Action Compilation preserves valid slots and retries only identifiable failures. RulePackageRegistry exposes input JSON contracts without package configuration or executable code, and TruthEngine preflights each invocation before trusted execution.

The resolution-plan verifier targets the smallest plan named by a finding and re-verifies the repaired candidate before committing random results. The causal verifier re-renders only observers for observation-only findings; findings that cannot be proven observer-local remain in the owning component and are still atomically validated. Observation Renderer concurrently handles independent observers with complete authorized context and emits typed uncertainty after local repair exhaustion.

All semantic repairs retain complete context: no truncation, slicing, summarization, top-K retrieval, or implicit field removal. Exceeding `max_input_bytes` raises `ContextLimitExceeded`. Transport failures and structured-output rejections have separate telemetry, and repair orchestration does not choose component or step disposition; the canonical caller that owns the candidate does.

## Pros and Cons of the Options

### Global fallback for every unknown reference

- Good: simple control flow and fewer apparent components in the short term.
- Bad: misclassifies model-quality failures as world semantics, causing global serialization and unrelated retries.

### Context reduction or singleton fallback

- Good: smaller requests and potentially lower provider cost.
- Bad: loses semantic evidence, reduces freedom and correctness, and hides the actual context-limit root cause.

### Contract-aware local repair with conservative components

- Good: complete semantics remain visible, repair responsibility is localized, independent work runs concurrently, and genuine global actions remain safe.
- Bad: ordinary cases may use more model calls, while genuine global or uncertainly dependent components retain their joint-resolution tail latency.

## Links

- [0010 Truth Engine Output Quality and Local Repair Layers](../specs/0010-truth-engine-output-repair.md)
- [0063 Eager Reference execution algorithm](0063-eager-reference-execution.md)
- [0060 Model-output field ownership](0060-model-output-field-ownership.md)
- [0059 Unified execution kernel and ledger](0059-unified-execution-kernel-and-ledger.md)
