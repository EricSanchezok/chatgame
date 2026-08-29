## Status

Accepted
Class: architecture

## Context and Problem Statement

Model calls need a short role contract, a call-specific task, and an explicitly delimited runtime context. Inline multilingual prompt literals duplicated stage behavior, obscured ownership, and made request-size accounting diverge from the bytes sent to providers.

## Decision Drivers

- Keep model-visible role and safety semantics reviewable without reading TypeScript.
- Make every call's task explicit and place it before untrusted runtime data.
- Preserve deterministic hashes, replay evidence, and provider-specific transport contracts.
- Fail before model work when a prompt asset is missing, empty, or unresolved.
- Keep prompt loading server-only and include assets in standalone deployments.

## Considered Options

1. Keep prompt literals in TypeScript and add more constants per stage.
2. Store prompts in Markdown but load them independently at each call site.
3. Store prompts in Markdown, load them through one cached server loader, and compose system, user, context, and transport text through shared functions.

## Decision Outcome

Use option 3. Prompt resources live under `src/engine/prompts/`, are normalized and content-hashed by `promptBundle`, and are composed with `structuredPromptBytes` for both eager budgeting and Gateway transport. Each model request requires a one- or two-sentence `userPrompt`; runtime JSON is labeled as data and remains unchanged. Prompt bundle hashes provide the prompt version and Kimi cache identity, while `MODEL_CONTEXT_CONTRACT_VERSION` changes only when the JSON context contract changes.

## Pros and Cons of the Options

### Option 1: Inline literals

- Pros: no file tracing or loader work.
- Cons: duplication, difficult review, larger diffs, and no reliable boundary between task instructions and runtime data.

### Option 2: Independent Markdown loading

- Pros: external editing and readable assets.
- Cons: inconsistent validation, duplicated composition logic, and drift between budget and provider payloads.

### Option 3: Cached bundle loader (selected)

- Pros: one validation and hashing boundary, stable versions, uniform transport assembly, and auditable task/context ordering.
- Cons: deployment must trace prompt assets, and tests/scripts need a filesystem-backed server loader.

## Links

- [Model gateway reference](../game-design/model-gateway.md)
- [Engine runtime reference](../game-design/engine-runtime.md)
- [System architecture](../architecture.md)
