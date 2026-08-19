// Slot renderer skeleton: renders a script-registered component for a slot,
// falling back to the framework default when no script UI is loaded.
// Phase 3 wires this into the game screen; today it is exported but unused.
import * as React from "react";
import { getSlot, type SlotId } from "../../lib/script-registry";

export function SlotRenderer({
  slot,
  fallback,
  ...props
}: { slot: SlotId; fallback: React.ElementType } & Record<string, unknown>) {
  const def = getSlot(slot);
  if (def) {
    const C = def.component as React.ElementType;
    return <C {...props} />;
  }
  return React.createElement(fallback, props);
}
