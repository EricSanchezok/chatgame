# Selective Admission Reuse and Stage Overlap

## Status

Accepted
Class: architecture

## Context and Problem Statement

Origin admission currently clears every prepared NPC action because the canonical revision changes. The first player action therefore pays a full AgentMind resume wave even when an NPC's observable perspective and pending cognition are unchanged. Preparation also waits for all AgentMind work before compiling known actions, and waits for onset perception before starting reactions that already have a deterministic basis.

The system must keep open-ended action text, cognitive isolation, Truth-owned validation, deterministic replay, and atomic rollback. A faster path cannot infer that an Agent is unaffected from location heuristics alone or allow speculative results to alter the current step.

## Decision Drivers

- Preserve semantic freedom and the existing eager-reference ordinary-step contract.
- Make every reuse decision independently verifiable and fail closed.
- Reduce critical-path waiting without adding hidden model work.
- Keep runtime identities, audits, RNG, and replay deterministic.
- Avoid changing the conflict-resolution loop owned by a separate optimization.

## Considered Options

1. Clear all prepared actions and keep the current stage barriers.
2. Reuse actions using area or distance heuristics and start speculative model work.
3. Prove cognitive-input equivalence, deterministically rebase retained actions, and overlap only independent model branches.

## Decision Outcome

Choose option 3. Admission compares each Agent's de-identified perspective and pending cognition, reuses only proven-equivalent action drafts, and records a complete invalidation/rebase ledger. Preparation starts known Action Compilation concurrently with resumed AgentMind work. Directly grounded reactions overlap onset perception; perception-dependent reactions wait. Ordinary post-resolution AgentMind updates remain unchanged, and unknown cases fall back to the existing full recomputation path.

## Pros and Cons of the Options

### Option 1: Clear everything

- Good: simplest semantics and persistence.
- Bad: repeats up to the entire AgentMind wave after every admission and leaves independent waits serial.

### Option 2: Heuristics/speculation

- Good: potentially lower latency.
- Bad: location is not an epistemic boundary, speculative calls can add cost, and false reuse can change an Agent's legal knowledge or action.

### Option 3: Proof plus independent overlap

- Good: fail-closed correctness, deterministic identities, no extra baseline calls, and useful latency reduction.
- Bad: requires an admission contract extension, a proof implementation, extra tests, and conservative fallbacks when perspective rendering is uncertain.

## Links

- [0010](../specs/0010-selective-agent-reuse-and-stage-overlap.md)
- [0063](0063-eager-reference-execution.md)
- [0068](0068-unified-agent-perspective.md)
- [0073](0073-stage-reactions-before-temporal-boundary-selection.md)
