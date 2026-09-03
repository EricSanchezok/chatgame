# Action Compilation Candidate-Key Length

## Status

Accepted
Class: architecture

## Context and Problem Statement

Action Compilation sends a complete request-local candidate namespace to a language model. The previous key used a `candidate_` prefix and a sixteen-hex-character digest suffix. A single omitted or transcribed character makes an otherwise valid structured response fail at materialization, while the model does not need the suffix to carry canonical identity semantics. The protocol needs a shorter deterministic selector without turning arbitrary strings into fuzzy matches or making collisions silent.

## Decision Drivers

- Reduce model transcription burden and request context bytes.
- Keep keys deterministic, request-local, auditable, and stable for replay.
- Preserve exact prefix and field/scope/kind validation.
- Keep collision risk bounded and fail closed on generated collisions.
- Avoid migration and compatibility branches under the forward-only runtime policy.

## Considered Options

1. Keep the sixteen-hex suffix and rely only on bounded repair.
2. Use a twelve-hex suffix generated from the existing deterministic digest.
3. Use a shorter suffix or positional indexes that depend on catalog order.

## Decision Outcome

Choose option 2. Candidate keys are `candidate_` plus twelve lowercase hexadecimal characters. The engine keeps the existing deterministic digest streams and truncates the encoded suffix to twelve characters, checks generated-key uniqueness, and records the key version and length in the Action Compilation manifest. The candidate prefix remains exact; only the closed payload may enter the registered bounded-repair policy. Generic `ref:*` handles, proposal keys, canonical/runtime IDs, hashes, and free text remain outside fuzzy repair.

The twelve-hex suffix gives a 48-bit namespace. With the current roughly 1,875-candidate catalog, the birthday collision probability is approximately 6.2×10⁻⁹ per catalog; any actual collision is rejected during catalog construction rather than resolved ambiguously. The shorter key saves four characters per occurrence and changes only request/audit/protocol hashes; accepted canonical, causal, state, and RNG semantics remain unchanged.

## Pros and Cons of the Options

### Sixteen-hex suffix

- Pros: lower theoretical collision probability and no protocol change.
- Cons: preserves unnecessary transcription length and does not prevent missing-character failures.

### Twelve-hex suffix (selected)

- Pros: materially shorter, still has a large closed-set namespace, deterministic generation is unchanged, and collisions fail closed.
- Cons: increases collision probability relative to sixteen hex and requires a forward protocol/manifest version.

### Shorter suffix or positional indexes

- Pros: smaller prompts or even simpler values.
- Cons: shorter digests spend collision budget rapidly, while indexes vary with catalog ordering and are harder to audit and replay.

## Links

- [Action Compilation Candidate-Key v2 spec](../specs/0017-action-compilation-candidate-key-v2.md)
- [Action Compilation Candidate-Key Protocol](0088-action-compilation-candidate-key-protocol.md)
- [Bounded Action Compilation Context](0087-bounded-action-compilation-context.md)
- [Wagner–Fischer edit distance](https://cir.nii.ac.jp/crid/1363670320103750912)
- [Damerau spelling-error model](https://dl.acm.org/doi/10.1145/363958.363994)
