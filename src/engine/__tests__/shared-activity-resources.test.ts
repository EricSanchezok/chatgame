import { describe, expect, it } from "vitest";
import { sharedActivityResourcePoolId } from "../runtime-id";
import {
  materializeSharedActivityResourceClaims,
  validateSharedActivityResourceClaim,
  validateSharedActivityResourceDefinition,
  validateSharedActivityResourcePool,
  type SharedActivityResourceDefinition,
  type SharedActivityResourcePool,
} from "../shared-activity-resources";
import { TEST_WORLD_HASH } from "../testing/world";

const definition: SharedActivityResourceDefinition = {
  id: "vehicle-seat",
  name: "载具座位",
  unit: "席",
  defaultClaimAmount: 1,
  allowExplicitAmount: true,
  contention: "queue",
  pausedRetention: "release",
};

const poolId = sharedActivityResourcePoolId(TEST_WORLD_HASH, definition.id, "wagon");
const pool: SharedActivityResourcePool = {
  id: poolId,
  definitionId: definition.id,
  entityId: "wagon",
  capacity: 4,
};
const definitions = { [definition.id]: definition };
const pools = { [pool.id]: pool };

describe("shared activity resource contracts", () => {
  it("derives stable Entity pool ids and validates non-negative capacity", () => {
    expect(sharedActivityResourcePoolId(TEST_WORLD_HASH, definition.id, "wagon")).toBe(poolId);
    expect(() => validateSharedActivityResourceDefinition(definition)).not.toThrow();
    expect(() => validateSharedActivityResourcePool(
      TEST_WORLD_HASH,
      pool,
      definitions,
      new Set(["wagon"]),
    )).not.toThrow();
    expect(() => validateSharedActivityResourcePool(
      TEST_WORLD_HASH,
      { ...pool, capacity: -1 },
      definitions,
      new Set(["wagon"]),
    )).toThrow("invalid shared activity resource pool");
  });

  it("materializes authored defaults without accepting a model-authored amount", () => {
    const claims = materializeSharedActivityResourceClaims({
      drafts: [{ poolId, basis: { kind: "default" } }],
      rawText: "登上马车",
      pools,
      definitions,
    });
    expect(claims).toEqual([{
      poolId,
      definitionId: "vehicle-seat",
      entityId: "wagon",
      amount: 1,
      basis: { kind: "default" },
    }]);
    expect(() => validateSharedActivityResourceClaim(claims[0]!, pools, definitions)).not.toThrow();
    expect(() => validateSharedActivityResourceClaim(
      { ...claims[0]!, amount: 2 },
      pools,
      definitions,
    )).toThrow("changes its authored default");
  });

  it("accepts only definition-authorized quantities verifiable in the action text", () => {
    expect(materializeSharedActivityResourceClaims({
      drafts: [{
        poolId,
        basis: { kind: "explicit_quantity", amount: 4, unit: "席", sourceText: "4席" },
      }],
      rawText: "为队伍预留4席座位",
      pools,
      definitions,
    })[0]).toMatchObject({ amount: 4, basis: { kind: "explicit_quantity", amount: 4 } });

    expect(() => materializeSharedActivityResourceClaims({
      drafts: [{
        poolId,
        basis: { kind: "explicit_quantity", amount: 3, unit: "席", sourceText: "4席" },
      }],
      rawText: "为队伍预留4席座位",
      pools,
      definitions,
    })).toThrow("not grounded");
    expect(() => materializeSharedActivityResourceClaims({
      drafts: [{ poolId: "rt:shared-resource-pool:missing", basis: { kind: "default" } }],
      rawText: "登车",
      pools,
      definitions,
    })).toThrow("unknown shared activity resource pool");
  });

  it("rejects partial-looking duplicate claims to one pool", () => {
    expect(() => materializeSharedActivityResourceClaims({
      drafts: [
        { poolId, basis: { kind: "default" } },
        { poolId, basis: { kind: "default" } },
      ],
      rawText: "登上马车",
      pools,
      definitions,
    })).toThrow("duplicate shared activity resource claim");
  });
});
