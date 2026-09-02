# Model reliability optimization and local transparency

## Status

Accepted
Class: architecture

## Context and Problem Statement

Model-output failures can arise from transport, serialization, schema, reference, privacy, or semantic decisions. Reducing AgentMind batch size or hiding context can make a metric look better by spending more tokens and calls or by removing information that the model needs. The local workbench is an operator-owned runtime, so the model request, response, and Inspector evidence should remain inspectable without a privacy-redaction subsystem.

## Decision Drivers

- Lower first-pass and terminal model failure rates without discarding useful world evidence or natural-language freedom.
- Preserve token, latency, and physical-call efficiency as first-class constraints.
- Keep root causes visible in deterministic validation, repair, and audit records.
- Treat local storage and trusted Inspector access as transparent by default; protect credentials and server-only execution boundaries separately.
- Preserve gameplay-defined perspective and canonical-state boundaries when they carry world semantics.
- Make any runtime tuning reproducible and comparable across instances and replay.

## Considered Options

- Reduce batch cardinality and increase physical model calls as the first reliability intervention.
- Reduce, summarize, redact, or anonymize model context before improving the output contract.
- Move AgentMind to a provider with stricter structured output and treat provider replacement as the primary fix.
- Preserve complete local context and batch efficiency while fixing the observed failure class, then use measured provider or batch changes only when the earlier layers are insufficient.

## Decision Outcome

Reliability work starts with a failure taxonomy and invocation evidence. The default optimization order is prompt and schema constraints, request layout and serialization, lossless context reuse and caching, provider structured-output capabilities, deterministic preflight/materialization, targeted semantic repair, and scheduling; changing batch cardinality or adding model calls is the final measured fallback.

Model-visible context remains complete unless a contract explicitly defines an information boundary. Lossy summarization, truncation, top-k retrieval, implicit field removal, privacy redaction, and anonymization are not reliability optimizations for the local workbench. Local operators may inspect the full model context, raw request/response evidence, and failure details through the trusted Inspector; API keys and filesystem execution remain server-only.

Batch changes are justified only by measured failure data and must report token usage, latency, physical calls, first-pass rejection, repair recovery, and terminal failure. A selected tuning is pinned in the algorithm manifest and compared against the existing configuration rather than silently replacing it.

Reference and schema validation remain strict. The engine may localize and repair a failed slot, but it does not fuzzy-match unknown handles, silently drop semantic targets, or rewrite natural-language content without an explicit contract. Gameplay perspective boundaries remain when required by the world contract; they are semantic state boundaries, not a reason to hide local data from the operator.

## Pros and Cons of the Options

### Batch reduction first

- Good: smaller responses can reduce cross-slot copying and malformed-output probability.
- Bad: physical calls and repeated input tokens grow, throughput falls, and the underlying prompt, schema, or provider defect can remain undiscovered.

### Context reduction or redaction

- Good: requests become smaller and may appear easier for a model to follow.
- Bad: evidence and semantic freedom are lost, local debugging becomes opaque, and a privacy layer adds complexity without a local data boundary that requires it.

### Provider replacement first

- Good: strict JSON Schema or tool-call support can reduce syntax failures.
- Bad: provider availability, cost, model behavior, and registry identity become the first variables changed; reference and prompt defects can still fail on the replacement.

### Root-cause optimization with complete context (selected)

- Good: preserves evidence and throughput while making each failure class observable and repairable; any later batch or provider change remains evidence-driven and reproducible.
- Bad: prompt, schema, parser, repair, and telemetry work may require more engineering before a configuration-only mitigation is available.

## Links

- [0079 — Truth Engine output repair boundaries](0079-truth-engine-output-repair-boundaries.md)
- [0082 — Truth Engine fixed slot batching](0082-truth-engine-fixed-slot-batching.md)
- [0086 — Model semantic contract and reference boundaries](0086-model-semantic-contract-and-reference-boundaries.md)
- [0075 — Pin configured execution algorithms](0075-pin-configured-execution-algorithms.md)
- [0004 — Game-first principles](0004-game-first-principles.md)
