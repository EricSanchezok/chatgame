import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWorldScript } from "../world-loader";

const fixture = path.resolve("test/fixtures/open-world-script");

describe("open world script loader", () => {
  it("loads open facts, numeric mechanics, agents and player knowledge", () => {
    const definition = loadWorldScript(fixture, 91);

    expect(definition.id).toBe("open-world-fixture");
    expect(definition.initialState.truth.entities.key.description).toContain("假钥匙");
    expect(definition.initialState.truth.facts["key-authenticity"].value).toEqual({
      kind: "text",
      value: "fake",
    });
    expect(definition.initialState.player.knowledge.claims["key-is-authentic"].value).toEqual({
      kind: "text",
      value: "real",
    });
    expect(definition.initialState.agents.keeper.nextAction).toBeUndefined();
    expect(definition.initialState.truth.quantities["spirit-stone:keeper"].amount).toBe(20);
    expect(definition.initialState.rng.seed).toBe(91);
  });
});
