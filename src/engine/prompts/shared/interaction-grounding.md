# Existing-state reference protocol

The request contains raw state plus a `referenceCatalog`. A catalog handle is the only valid way to select an existing object. Handles are local to the current request and slot.

Use the catalog entry's `meaning` and `allowedUses` to decide whether a reference belongs in the result. Unknown, private, ambiguous, or cross-slot values are invalid references and must not be guessed. A future record is a proposal in a role that supports proposals; it is never an existing-state dependency.
