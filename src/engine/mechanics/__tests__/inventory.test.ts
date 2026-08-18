// Inventory mechanics unit tests: stacking, capacity enforcement,
// insufficient-removal rejection, counting, and currency flooring.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScript } from "../../loader";
import {
  addCurrency,
  addItem,
  capacityUsed,
  hasItem,
  itemCount,
  removeCurrency,
  removeItem,
} from "../inventory";
import type { InventoryState } from "../../types";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const emberfall = loadScript(path.join(REPO_ROOT, "scripts/emberfall"));

function makeInv(): InventoryState {
  return { stacks: [{ itemId: "pickaxe", quantity: 1 }], currency: 30 };
}

describe("inventory", () => {
  it("addItem creates a new stack and merges into an existing one", () => {
    const inv = makeInv();
    let out = addItem(inv, "herb", 3, emberfall);
    expect(out.ok).toBe(true);
    expect(itemCount(out.inv, "herb")).toBe(3);
    expect(itemCount(out.inv, "pickaxe")).toBe(1);
    expect(inv.stacks).toHaveLength(1); // original untouched

    out = addItem(out.inv, "herb", 2, emberfall);
    expect(out.ok).toBe(true);
    expect(itemCount(out.inv, "herb")).toBe(5);
    expect(out.inv.stacks).toHaveLength(2); // merged, no duplicate stack
  });

  it("addItem rejects capacity overflow without mutating the inventory", () => {
    const inv = { stacks: [{ itemId: "herb", quantity: 19 }], currency: 0 };
    const out = addItem(inv, "herb", 2, emberfall); // capacity is 20
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("capacity");
    expect(out.inv).toBe(inv); // unchanged on failure
  });

  it("removeItem removes partial, removes the stack at zero, and rejects insufficiency", () => {
    const inv = { stacks: [{ itemId: "herb", quantity: 3 }], currency: 0 };

    const partial = removeItem(inv, "herb", 2);
    expect(partial.ok).toBe(true);
    expect(itemCount(partial.inv, "herb")).toBe(1);

    const rest = removeItem(partial.inv, "herb", 1);
    expect(rest.ok).toBe(true);
    expect(rest.inv.stacks).toHaveLength(0); // stack dropped at zero

    const tooMany = removeItem(rest.inv, "herb", 1);
    expect(tooMany.ok).toBe(false);
    expect(tooMany.reason).toContain("insufficient");
    expect(tooMany.inv).toBe(rest.inv);
  });

  it("hasItem / itemCount / capacityUsed report quantities", () => {
    const inv = { stacks: [{ itemId: "herb", quantity: 3 }, { itemId: "lantern", quantity: 1 }], currency: 0 };
    expect(itemCount(inv, "herb")).toBe(3);
    expect(itemCount(inv, "no-such-item")).toBe(0);
    expect(hasItem(inv, "herb")).toBe(true);
    expect(hasItem(inv, "herb", 3)).toBe(true);
    expect(hasItem(inv, "herb", 4)).toBe(false);
    expect(hasItem(inv, "no-such-item")).toBe(false);
    expect(capacityUsed(inv)).toBe(4);
  });

  it("currency adds, removes, and floors at 0", () => {
    const inv = makeInv();
    expect(addCurrency(inv, 10).currency).toBe(40);
    expect(removeCurrency(inv, 10).currency).toBe(20);
    expect(removeCurrency(inv, 1000).currency).toBe(0);
    expect(inv.currency).toBe(30); // original untouched
  });
});
