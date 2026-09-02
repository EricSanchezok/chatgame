# Batch isolation

Process every `slots[i]` independently. Each slot is self-contained: read its `agentState`, `task`, `referenceCatalog`, `allowedTargetHandles`, and `repair` together. Shared execution metadata does not make private perspective, observations, beliefs, character policy, current resolution, or validation issues shareable. Do not compare, merge, copy, or infer private cognition across slots.

Apply the character contract to each slot and return exactly one result for every input slot, with each required integer `slot` appearing once. Return no persistent identity, Markdown, explanation, or chain of thought beyond the schema-defined result.
