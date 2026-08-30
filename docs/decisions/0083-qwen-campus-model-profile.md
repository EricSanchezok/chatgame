# Qwen Campus Model Profile

## Status

Accepted
Class: architecture

## Context and Problem Statement

Local live testing needs a small, reachable model without removing the existing
DeepSeek or GLM profiles. The campus OpenAI-compatible gateway exposes
`Qwen3.8-27B` and accepts the Qwen chat-template thinking switch. During a
multi-stage world smoke, its vLLM deployment rejected strict JSON Schema
requests after switching between the `xgrammar` and `guidance` structured
output backends. Transport connectivity alone therefore did not establish a
usable engine profile.

## Decision Drivers

- Keep every existing provider account and profile available.
- Make the campus model selectable from normal model-catalog configuration.
- Preserve local Zod validation and the engine's structured-output contract.
- Keep thinking control and the trusted transport endpoint in local config.
- Make local live smoke commands fast enough for iterative testing.

## Considered Options

1. Keep strict JSON Schema for Qwen.
2. Use tool-call structured output for Qwen.
3. Use JSON Object transport with the existing schema prompt and local Zod validation.
4. Add a separate registry implementation for models whose metadata is not in
   the remote catalog.

## Decision Outcome

Add a `qwen-campus` account and `truth-qwen`/`agent-qwen` profiles to
`config/models.yaml`. Register a `qwen` vendor dialect that sends
`chat_template_kwargs.enable_thinking` and keeps all other inference fields
provider-neutral. Qwen requests use JSON Object transport and are parsed and
validated by the existing local Zod path. Truth and Agent profiles use
`temperature: 0`; thinking is disabled in both default local profiles for fast
iteration and can be enabled explicitly in a separate profile when Truth
quality warrants the latency.

The campus base URL and `INF_API_KEY` remain trusted local account settings.
Until the catalog supports first-class local model metadata, the exact Qwen
model ID uses the `hetzner` models.dev provider only as a capability metadata
anchor; it never supplies the transport URL or credentials.

The existing GLM, DeepSeek, and other accounts are unchanged. The Qwen profile
set is available through the live smoke commands and is the default profile
set for the local smoke runner; deterministic unit tests continue to use the
scripted provider.

## Pros and Cons of the Options

### Strict JSON Schema

- Pros: strongest provider-side schema constraint.
- Cons: the campus vLLM instance can select incompatible structured-output
  backends across the engine's heterogeneous schemas, causing otherwise valid
  requests to fail before local semantic validation.

### Tool-call structured output

- Pros: preserves a typed argument boundary when the provider implements it.
- Cons: adds a provider capability dependency that is not required by the
  observed endpoint and does not address the backend conflict evidence.

### JSON Object plus local Zod (selected)

- Pros: uses one stable vLLM JSON mode, keeps the complete schema prompt, and
  retains the same local Zod semantic gate and repair behavior.
- Cons: provider-side enforcement is weaker than strict JSON Schema; malformed
  or semantically invalid JSON still consumes a localized repair attempt.

### First-class local registry metadata

- Pros: removes the metadata-anchor compromise and is clearer for future
  private deployments.
- Cons: expands the catalog and snapshot contract beyond this local test
  profile; it is deferred until another private model requires the same path.

## Links

- [Model catalog and Gateway](../game-design/model-gateway.md)
- [`config/models.yaml`](../../config/models.yaml)
- [Truth Engine fixed-slot batching](0082-truth-engine-fixed-slot-batching.md)
