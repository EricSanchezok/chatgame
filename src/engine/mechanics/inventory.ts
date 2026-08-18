// Inventory + currency operations. Pure immutable updates on InventoryState:
// capacity from definition.mechanics.inventory.capacity; stacking merges
// stacks with the same itemId (counted capacity regardless of stackability).
import type { InventoryState } from "../types";
import type { WorldDefinition } from "../types";

/** Result of a mutating inventory operation. */
export interface InventoryOpResult {
  ok: boolean;
  inv: InventoryState;
  /** Failure reason (human-readable) when ok is false. */
  reason?: string;
}

/** Total unit count across all stacks. */
export function capacityUsed(inv: InventoryState): number {
  return inv.stacks.reduce((sum, s) => sum + s.quantity, 0);
}

/** Capacity limit from the mechanics definition. */
export function inventoryCapacity(definition: WorldDefinition): number {
  return definition.mechanics.inventory.capacity;
}

/** Quantity of itemId in the inventory (0 when absent). */
export function itemCount(inv: InventoryState, itemId: string): number {
  return inv.stacks.find((s) => s.itemId === itemId)?.quantity ?? 0;
}

/** True when the inventory holds at least qty of itemId (default 1). */
export function hasItem(inv: InventoryState, itemId: string, qty = 1): boolean {
  return itemCount(inv, itemId) >= qty;
}

/**
 * Adds qty of itemId, merging into the existing stack when present.
 * Returns { ok: false, reason } (original inventory) when the result would
 * exceed capacity; never throws.
 */
export function addItem(
  inv: InventoryState,
  itemId: string,
  qty: number,
  definition: WorldDefinition,
): InventoryOpResult {
  if (qty <= 0) return { ok: false, inv, reason: `addItem: qty must be positive (got ${qty})` };
  const existing = inv.stacks.find((s) => s.itemId === itemId);
  const used = capacityUsed(inv);
  if (used + qty > inventoryCapacity(definition)) {
    return {
      ok: false,
      inv,
      reason: `addItem: ${used + qty}/${inventoryCapacity(definition)} exceeds inventory capacity`,
    };
  }
  const stacks = existing
    ? inv.stacks.map((s) =>
        s.itemId === itemId ? { ...s, quantity: s.quantity + qty } : s,
      )
    : [...inv.stacks, { itemId, quantity: qty }];
  return { ok: true, inv: { ...inv, stacks } };
}

/**
 * Removes qty of itemId (floor 0). Removing more than held returns
 * { ok: false, reason } and leaves the inventory unchanged.
 */
export function removeItem(
  inv: InventoryState,
  itemId: string,
  qty: number,
): InventoryOpResult {
  if (qty <= 0) return { ok: false, inv, reason: `removeItem: qty must be positive (got ${qty})` };
  const existing = inv.stacks.find((s) => s.itemId === itemId);
  if (!existing || existing.quantity < qty) {
    return { ok: false, inv, reason: `removeItem: insufficient ${itemId} (need ${qty})` };
  }
  const remaining = existing.quantity - qty;
  const stacks =
    remaining === 0
      ? inv.stacks.filter((s) => s.itemId !== itemId)
      : inv.stacks.map((s) => (s.itemId === itemId ? { ...s, quantity: remaining } : s));
  return { ok: true, inv: { ...inv, stacks } };
}

/** Adds amt currency (negative amt treated as removal). */
export function addCurrency(inv: InventoryState, amt: number): InventoryState {
  return { ...inv, currency: Math.max(0, inv.currency + amt) };
}

/** Removes amt currency, flooring at 0. */
export function removeCurrency(inv: InventoryState, amt: number): InventoryState {
  return addCurrency(inv, -amt);
}

