import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./game-thread.tsx", import.meta.url), "utf8");

describe("assistant-ui Thread contract", () => {
  it("keeps the upstream viewport footer topology and retired APIs out", () => {
    expect(source).toContain("<ThreadPrimitive.Root");
    expect(source).toContain("<ThreadPrimitive.Viewport");
    expect(source).toContain("<ThreadPrimitive.Messages>");
    expect(source).toContain("<ThreadPrimitive.ViewportFooter");
    expect(source).not.toContain("ThreadPrimitive.Empty");
  });
});
