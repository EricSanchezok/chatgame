import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { RulePackageRegistry } from "../../engine/rule-package";
import { createTestModelCatalog } from "../../engine/testing/model-provider";
import { loadWorldScript } from "../world-loader";

const fixture = path.resolve("test/fixtures/open-world-script");
const modelCatalog = createTestModelCatalog();
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function copiedFixture(): string {
  const parent = mkdtempSync(path.join(tmpdir(), "livingworld-loader-"));
  temporaryDirectories.push(parent);
  const target = path.join(parent, "world");
  cpSync(fixture, target, { recursive: true });
  return target;
}

describe("open world script loader", () => {
  it("loads open facts, numeric mechanics, agents and player knowledge", () => {
    const definition = loadWorldScript(fixture, { seed: 91, modelCatalog });

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
    expect(definition.initialState.agents.keeper.nextAction).toBeNull();
    expect(definition.initialState.agents.keeper.character).toMatchObject({
      persona: { summary: expect.stringContaining("谨慎"), voice: expect.stringContaining("简短") },
      traits: { cautious: { strength: 0.8, status: "active", createdAtStep: 0 } },
      values: { duty: { strength: 0.9, status: "active" } },
      emotions: { alertness: { intensity: 0.4, status: "active" } },
      attitudes: { "toward-traveler": { subjectId: "traveler", intensity: 0.5 } },
      goals: { "guard-gate": { priority: 0.9, progress: 0 } },
      commitments: { "dawn-watch": { subjectIds: ["self"], priority: 0.8 } },
    });
    expect(definition.initialState.truth.quantities["spirit-stone:keeper"].amount).toBe(20);
    expect(definition.initialState.truth.rng.seed).toBe(91);
    expect(definition.rulePackages).toEqual([expect.objectContaining({
      id: "core-d20",
      version: "1.1.0",
      config: { damageUsesMeters: true },
    })]);
  });

  it("defaults every optional character layer from only persona.summary", () => {
    const world = copiedFixture();
    const keeperFile = path.join(world, "entities/keeper.yaml");
    const keeper = readFileSync(keeperFile, "utf8").replace(
      /  character:\n[\s\S]*?  belief:\n/,
      "  character:\n    persona:\n      summary: 只保留最小人格摘要。\n  belief:\n",
    );
    writeFileSync(keeperFile, keeper, "utf8");

    expect(loadWorldScript(world, { modelCatalog }).initialState.agents.keeper.character).toEqual({
      persona: { summary: "只保留最小人格摘要。", voice: "", updatedAtStep: 0, evidenceIds: [] },
      traits: {},
      values: {},
      emotions: {},
      attitudes: {},
      goals: {},
      commitments: {},
    });
  });

  it("rejects schema v4 worlds and missing or duplicate Agent self bindings", () => {
    const oldWorld = copiedFixture();
    const manifestFile = path.join(oldWorld, "script.yaml");
    writeFileSync(
      manifestFile,
      readFileSync(manifestFile, "utf8").replace("schema_version: 5", "schema_version: 4"),
      "utf8",
    );
    expect(() => loadWorldScript(oldWorld, { modelCatalog })).toThrow();

    const duplicateSelf = copiedFixture();
    const keeperFile = path.join(duplicateSelf, "entities/keeper.yaml");
    writeFileSync(
      keeperFile,
      readFileSync(keeperFile, "utf8").replace(
        "canonical_entity_ids: [player]",
        "canonical_entity_ids: [keeper]",
      ),
      "utf8",
    );
    expect(() => loadWorldScript(duplicateSelf, { modelCatalog })).toThrow("exactly one self binding");
  });

  it("loads only rule packages registered by the trusted server runtime", () => {
    const world = copiedFixture();
    const mechanicsFile = path.join(world, "mechanics.yaml");
    const mechanics = readFileSync(mechanicsFile, "utf8")
      .replace("core-d20", "cultivation-d20")
      .replace("version: 1.1.0", "version: 2.0.0");
    writeFileSync(mechanicsFile, mechanics, "utf8");

    expect(() => loadWorldScript(world, { modelCatalog })).toThrow("unknown rule package cultivation-d20");

    const registry = new RulePackageRegistry([{
      id: "cultivation-d20",
      version: "2.0.0",
      adjudication: "使用修仙世界检定。",
      configSchema: z.object({ damageUsesMeters: z.boolean() }).strict(),
      rules: [],
    }]);
    expect(loadWorldScript(world, { seed: 1, rulePackages: registry, modelCatalog }).rulePackages[0]).toMatchObject({
      id: "cultivation-d20",
      version: "2.0.0",
    });
  });

  it("rejects unknown or role-incompatible Truth and Agent model profiles", () => {
    const unknownTruth = copiedFixture();
    const truthManifest = path.join(unknownTruth, "script.yaml");
    writeFileSync(
      truthManifest,
      readFileSync(truthManifest, "utf8").replace("truth-deepseek", "missing-truth-profile"),
      "utf8",
    );
    expect(() => loadWorldScript(unknownTruth, { modelCatalog })).toThrow("unknown model profile");

    const wrongTruthRole = copiedFixture();
    const wrongRoleManifest = path.join(wrongTruthRole, "script.yaml");
    writeFileSync(
      wrongRoleManifest,
      readFileSync(wrongRoleManifest, "utf8").replace("truth-deepseek", "agent-deepseek"),
      "utf8",
    );
    expect(() => loadWorldScript(wrongTruthRole, { modelCatalog })).toThrow("does not allow role truth-perception");

    const unknownAgent = copiedFixture();
    const keeper = path.join(unknownAgent, "entities/keeper.yaml");
    writeFileSync(
      keeper,
      readFileSync(keeper, "utf8").replace("agent-deepseek", "missing-agent-profile"),
      "utf8",
    );
    expect(() => loadWorldScript(unknownAgent, { modelCatalog })).toThrow("unknown model profile");
  });
});
