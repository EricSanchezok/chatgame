Analyze the assigned action using the raw state and the reference catalog.

For every reference, copy the exact `handle` from `referenceCatalog`; never copy a canonical ID into the output. Keep `requiredExistingRefs` and `potentiallyAffectedExistingRefs` separate. The second list describes possible concurrent conflicts only; it is not a list of records that will be created. Use the world handle only for genuinely world-wide arbitration. Return one grounding object matching the schema.
