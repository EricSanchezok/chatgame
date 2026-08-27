import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { RulePackageRegistry } from "../../engine/rule-package";
import {
  MAX_RANDOM_DISTRIBUTION_UTF8_BYTES,
  MAX_RANDOM_DISTRIBUTIONS_PER_WORLD,
  stableRandomUtf8Bytes,
} from "../../engine/random-limits";
import type { DiscreteRandomDefinition } from "../../engine/model";
import { createTestModelCatalog } from "../../engine/testing/model-provider";
import { quantityId } from "../../engine/runtime-id";
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
  it("loads open facts, numeric mechanics, Agents and private knowledge", () => {
    const definition = loadWorldScript(fixture, { seed: 91, modelCatalog });

    expect(definition.id).toBe("open-world-fixture");
    expect(definition.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(definition.initialState.worldHash).toBe(definition.contentHash);
    expect(definition.initialState.truth.entities.key.description).toContain("假钥匙");
    expect(definition.initialState.truth.facts["key-authenticity"].value).toEqual({
      kind: "text",
      value: "fake",
    });
    expect(definition.initialState.truth.facts["key-authenticity"].provenance).toEqual([
      { kind: "world_seed", id: definition.contentHash },
    ]);
    expect(definition.initialState.agents.player.belief.claims["key-is-authentic"].value).toEqual({
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
    expect(definition.initialState.truth.quantities[
      quantityId(definition.contentHash, "spirit-stone", "keeper")
    ].amount).toBe(20);
    expect(definition.initialState.truth.rng.seed).toBe(91);
    expect(definition.rulePackages).toEqual([expect.objectContaining({
      id: "core-resolution",
      version: "2.0.0",
      config: {},
    })]);
    expect(definition.initialState.schemaVersion).toBe(10);
    expect(definition.initialState.truth.mechanics.impactProfiles.harm.amounts).toEqual({
      none: 0, minor: 2, standard: 5, major: 10, decisive: 20,
    });
    expect(definition.participation?.origins[0].mechanicsProfileId).toBe("wanderer");
    expect(definition.randomDistributions).toEqual([
      expect.objectContaining({
        id: "four-six-sum",
        steps: [{
          id: "amount",
          count: 4,
          outcomes: [1, 2, 3, 4, 5, 6],
          aggregate: "sum",
          when: null,
        }],
      }),
      expect.objectContaining({ id: "five-ten-sum" }),
      expect.objectContaining({
        id: "hourly-four-four",
        steps: expect.arrayContaining([expect.objectContaining({
          id: "group-size",
          count: 4,
          outcomes: [1, 2, 3, 4],
          aggregate: "sum",
          when: { stepId: "triggered", equals: true },
        })]),
      }),
      expect.objectContaining({
        id: "three-six-four-two",
        steps: expect.arrayContaining([expect.objectContaining({
          id: "branch",
          outcomes: ["first", "first", "first", "first", "second", "second"],
          when: { stepId: "triggered", equals: true },
        })]),
      }),
    ]);
  });

  it("hashes normalized world content independently of entity file names", () => {
    const renamed = copiedFixture();
    renameSync(path.join(renamed, "entities/keeper.yaml"), path.join(renamed, "entities/z-keeper.yaml"));
    renameSync(path.join(renamed, "entities/key.yaml"), path.join(renamed, "entities/a-key.yaml"));

    expect(loadWorldScript(renamed, { modelCatalog }).contentHash)
      .toBe(loadWorldScript(fixture, { modelCatalog }).contentHash);
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

  it("rejects schema v9 worlds and missing or duplicate Agent self bindings", () => {
    const oldWorld = copiedFixture();
    const manifestFile = path.join(oldWorld, "script.yaml");
    writeFileSync(
      manifestFile,
      readFileSync(manifestFile, "utf8").replace("schema_version: 10", "schema_version: 9"),
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
      .replace("core-resolution", "cultivation-resolution");
    writeFileSync(mechanicsFile, mechanics, "utf8");

    expect(() => loadWorldScript(world, { modelCatalog })).toThrow("unknown rule package cultivation-resolution");

    const registry = new RulePackageRegistry([{
      id: "cultivation-resolution",
      version: "2.0.0",
      adjudication: "使用修仙世界检定。",
      configSchema: z.strictObject({}),
      rules: [],
    }]);
    expect(loadWorldScript(world, { seed: 1, rulePackages: registry, modelCatalog }).rulePackages[0]).toMatchObject({
      id: "cultivation-resolution",
      version: "2.0.0",
    });
  });

  it("enforces the exact canonical UTF-8 distribution budget during world loading", () => {
    const exact = copiedFixture();
    const definition: DiscreteRandomDefinition = {
      id: "loader-byte-boundary",
      description: "x",
      steps: [{
        id: "value",
        count: 1,
        outcomes: [0, 1],
        aggregate: "first",
        when: null,
      }],
    };
    definition.description += "x".repeat(
      MAX_RANDOM_DISTRIBUTION_UTF8_BYTES - stableRandomUtf8Bytes(definition),
    );
    expect(stableRandomUtf8Bytes(definition)).toBe(MAX_RANDOM_DISTRIBUTION_UTF8_BYTES);
    const appendDefinition = (directory: string, description: string) => {
      const file = path.join(directory, "mechanics.yaml");
      writeFileSync(file, `${readFileSync(file, "utf8")}\n  - id: loader-byte-boundary\n` +
        `    description: ${description}\n` +
        "    steps:\n" +
        "      - id: value\n" +
        "        count: 1\n" +
        "        outcomes: [0, 1]\n" +
        "        aggregate: first\n", "utf8");
    };
    appendDefinition(exact, definition.description);
    expect(() => loadWorldScript(exact, { modelCatalog })).not.toThrow();

    const oversized = copiedFixture();
    appendDefinition(oversized, `${definition.description}x`);
    expect(() => loadWorldScript(oversized, { modelCatalog })).toThrow("exceeds byte limit");
  });

  it("enforces the world random catalog count at the loader boundary", () => {
    const appendDistributions = (directory: string, count: number) => {
      const file = path.join(directory, "mechanics.yaml");
      const additions = Array.from({ length: count }, (_, index) =>
        `  - id: loader-catalog-${index}\n` +
        "    description: loader catalog boundary\n" +
        "    steps:\n" +
        "      - id: value\n" +
        "        count: 1\n" +
        "        outcomes: [0, 1]\n" +
        "        aggregate: first\n").join("");
      writeFileSync(file, `${readFileSync(file, "utf8")}\n${additions}`, "utf8");
    };

    const fixtureDistributionCount = 4;
    const exact = copiedFixture();
    appendDistributions(exact, MAX_RANDOM_DISTRIBUTIONS_PER_WORLD - fixtureDistributionCount);
    expect(() => loadWorldScript(exact, { modelCatalog })).not.toThrow();

    const oversized = copiedFixture();
    appendDistributions(oversized, MAX_RANDOM_DISTRIBUTIONS_PER_WORLD - fixtureDistributionCount + 1);
    expect(() => loadWorldScript(oversized, { modelCatalog }))
      .toThrow("catalog exceeds distribution limit");
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
