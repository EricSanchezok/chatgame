# AgentMind slot context and bounded JSON recovery

## Status

Accepted
Class: architecture

## Context and Problem Statement

AgentMind physical batches need to carry private perspective, task constraints, reference metadata, and targetable handles for multiple Agents without making parallel arrays easy to confuse or copy across slots. Model providers also occasionally return syntactically invalid JSON, including unescaped quotation marks inside natural-language fields. The gateway must recover deterministic syntax defects where possible without treating nested objects as a valid batch or weakening Zod and reference validation.

## Decision Drivers

- Keep the default AgentMind batch size and complete local context so reliability work does not increase token and physical-call costs by default.
- Make every slot's private input self-contained and make targetable handles explicit.
- Preserve strict schema, reference, and semantic validation after any parser recovery.
- Make parser recovery bounded, deterministic, and visible in model audit evidence.
- Avoid accepting arbitrary prose or silently inventing structure from ambiguous output.

## Considered Options

- Keep `state.slots`, `task.slots`, and `referenceCatalogs` as parallel arrays and rely on prompt wording to associate them.
- Replace the batch with one model request per Agent so each request has a naturally isolated context.
- Use a permissive JSON5-style parser or broad text extraction that accepts any nested object found in malformed output.
- Use strict native parsing first, then a top-level candidate parser and bounded syntax repair, while retaining a full schema and semantic gate.

## Decision Outcome

AgentMind batches use one top-level `slots` array. Each entry contains its integer `slot`, `agentState`, `task`, `referenceCatalog`, explicit `allowedTargetHandles`, and slot-local `repair` information. Shared execution metadata remains at the envelope root; private cognition and catalogs are never reconstructed from parallel arrays.

The model gateway parses the complete content with native `JSON.parse` first. If that fails, it only considers complete top-level values for the existing corrected-response behavior and never returns a nested object from a malformed root. When the response starts with an object or array and no complete top-level value is available, the gateway invokes `jsonrepair` at a bounded grammar-recovery boundary, parses the repaired text, and then runs the unchanged Zod, reference, and semantic validation. Arbitrary prose, ambiguous multi-value recovery, fuzzy handle matching, and schema bypass remain rejected. Recovered responses are marked `auto-normalized` with a structure issue in the model audit.

## Pros and Cons of the Options

### Parallel arrays with prompt association

- Good: preserves the existing serialized shape and avoids a context-contract change.
- Bad: a model can associate one slot's state with another slot's catalog, and failures are harder to diagnose because the relationship is implicit.

### One request per Agent

- Good: isolation is straightforward and output syntax is smaller.
- Bad: repeated context and physical calls increase cost and latency, contrary to the reliability optimization policy.

### Permissive parsing or nested-object extraction

- Good: superficially increases the number of strings that produce a JavaScript value.
- Bad: can turn a slot into a batch, silently discard sibling results, accept arbitrary prose, and hide the actual structural failure from repair and audit.

### Top-level parsing with bounded `jsonrepair` recovery (selected)

- Good: recovers common LLM syntax defects such as unescaped quotes while retaining batch throughput, precise structural failures, and strict downstream gates.
- Bad: the repair library is heuristic by design, so repaired values must remain explicitly marked and ambiguous cases still require a targeted model repair.

## Links

- [0090 — Model reliability optimization and local transparency](0090-model-reliability-optimization-and-local-transparency.md)
- [0004 — Game-first principles](0004-game-first-principles.md)
- [jsonrepair repository](https://github.com/josdejong/jsonrepair)
- [jsonrepair package](https://www.npmjs.com/package/jsonrepair)
- [secure-json-parse package](https://www.npmjs.com/package/secure-json-parse)
