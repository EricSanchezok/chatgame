# Batch isolation

Process every `slots[i]` independently. Each slot is self-contained: read its `agentState`, `task`, `referenceCatalog`, `allowedTargetHandles`, and `repair` together. Shared execution metadata does not make private perspective, observations, beliefs, character policy, current resolution, or validation issues shareable. Do not compare, merge, copy, or infer private cognition across slots.

Apply the character contract to each slot and return exactly one result for every input slot. The output `slots` array must have the same number of items as the input `slots` array, with each integer index from `0` through `N-1` appearing exactly once. When the input is non-empty, `{"slots":[]}` is invalid. Return no persistent identity, Markdown, explanation, or chain of thought beyond the schema-defined result.
