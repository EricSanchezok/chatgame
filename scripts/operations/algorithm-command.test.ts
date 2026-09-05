import { describe, expect, it } from "vitest";
import { runAlgorithmCommand } from "./algorithm-command";

describe("algorithm command", () => {
  it("lists, describes, validates, and checks the generated catalog", () => {
    expect(JSON.parse(runAlgorithmCommand(["list"]))).toContainEqual(expect.objectContaining({
      role: "candidate-selection",
      id: "full-catalog",
    }));
    expect(JSON.parse(runAlgorithmCommand(["describe", "world-execution/eager-reference@16"]))).toMatchObject({
      definition: { role: "world-execution", id: "eager-reference", version: "16" },
    });
    expect(JSON.parse(runAlgorithmCommand(["validate"]))).toMatchObject({ valid: true });
    expect(runAlgorithmCommand(["catalog", "--check"])).toBe("algorithm catalog is current\n");
  });
});
