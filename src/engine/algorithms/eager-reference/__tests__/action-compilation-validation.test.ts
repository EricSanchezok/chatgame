import { describe, expect, it } from "vitest";
import { normalizeActionCompilationContextCauses } from "../action-compilation-validation";

describe("Action Compilation structural normalization", () => {
  it("drops context-only causes when the exact action cause remains", () => {
    const result = normalizeActionCompilationContextCauses({
      expectedActionRef: "ref:action:a-1",
      value: {
        slot: 0,
        temporalPlan: {
          causes: [
            { kind: "action", ref: "ref:action:a-1" },
            { kind: "entity", ref: "ref:entity:target" },
            { kind: "placement", ref: "ref:placement:gate" },
          ],
        },
      },
    });

    expect(result.removedCount).toBe(2);
    expect(result.value).toMatchObject({
      temporalPlan: { causes: [{ kind: "action", ref: "ref:action:a-1" }] },
    });
  });

  it("does not hide an invalid cause when the exact action cause is absent", () => {
    const value = {
      slot: 0,
      temporalPlan: { causes: [{ kind: "entity", ref: "ref:entity:target" }] },
    };

    expect(normalizeActionCompilationContextCauses({
      expectedActionRef: "ref:action:a-1",
      value,
    })).toEqual({ value, removedCount: 0 });
  });

  it("keeps unknown cause kinds for schema rejection", () => {
    const value = {
      slot: 0,
      temporalPlan: {
        causes: [
          { kind: "action", ref: "ref:action:a-1" },
          { kind: "mystery", ref: "ref:entity:target" },
        ],
      },
    };

    expect(normalizeActionCompilationContextCauses({
      expectedActionRef: "ref:action:a-1",
      value,
    })).toEqual({ value, removedCount: 0 });
  });
});
