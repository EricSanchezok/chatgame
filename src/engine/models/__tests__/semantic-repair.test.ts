import { describe, expect, it } from "vitest";
import { createTestModelAudit } from "../../testing/model-provider";
import {
  runSemanticRepairLoop,
  semanticIssue,
  semanticRepairFingerprint,
} from "../semantic-repair";

const scope = {
  workloadId: "repair-test",
  batchId: "repair-test",
  runtimeIdentity: {
    worldHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    revision: 0,
  },
} as const;

describe("semantic repair loop", () => {
  it("fingerprints deterministic issue identity instead of wording or order", () => {
    const left = semanticRepairFingerprint([
      { code: "reference.unknown_handle", path: ["refs", 1], originalValue: "ref:fact:missing" },
      { code: "temporal.ineligible", path: ["profileRef"], originalValue: "ref:temporal_profile:rate" },
    ], 14);
    const reordered = semanticRepairFingerprint([
      { code: "temporal.ineligible", path: ["profileRef"], originalValue: "ref:temporal_profile:rate" },
      { code: "reference.unknown_handle", path: ["refs", 1], originalValue: "ref:fact:missing" },
    ], 14);

    expect(reordered).toBe(left);
    expect(semanticRepairFingerprint([
      { code: "reference.unknown_handle", path: ["refs", 1], originalValue: "ref:fact:other" },
    ], 14)).not.toBe(left);
    expect(semanticRepairFingerprint([
      { code: "reference.unknown_handle", path: ["refs", 1], originalValue: "ref:fact:missing" },
      { code: "temporal.ineligible", path: ["profileRef"], originalValue: "ref:temporal_profile:rate" },
    ], 15)).not.toBe(left);
  });

  it("retries one scoped issue and combines its audits", async () => {
    let calls = 0;
    const result = await runSemanticRepairLoop({
      role: "action-grounding",
      repairScope: "slot",
      targetIds: ["action-a"],
      maxRepairs: 2,
      invoke: async () => ({
        value: calls++ === 0 ? "bad" : "good",
        audit: createTestModelAudit("action-grounding", "action-a", scope.runtimeIdentity.worldHash),
      }),
      validate: (value) => {
        if (value === "bad") throw new Error("invalid reference");
      },
      classify: () => [semanticIssue("unknown_entity", "use a canonical entity id", {
        class: "reference",
        path: ["stateDependencies", "requiredExistingRefs", 0],
        targetIds: ["action-a"],
      })],
    });

    expect(result.value).toBe("good");
    expect(result.attempts).toBe(2);
    expect(result.repairs).toBe(1);
    expect(result.audit.invocations).toHaveLength(2);
  });

  it("throws a typed exhaustion without choosing a global fallback", async () => {
    await expect(runSemanticRepairLoop({
      role: "action-grounding",
      repairScope: "slot",
      targetIds: ["action-a"],
      maxRepairs: 1,
      invoke: async () => ({
        value: "bad",
        audit: createTestModelAudit("action-grounding", "action-a", scope.runtimeIdentity.worldHash),
      }),
      validate: () => { throw new Error("unknown private evidence"); },
      classify: () => [semanticIssue("private_reference", "private evidence is not canonical", {
        class: "reference",
        path: ["stateDependencies", "potentiallyAffectedExistingRefs", 0],
        originalValue: "rt:fact:private",
        allowedHandles: ["ref:fact:public"],
        targetIds: ["action-a"],
      })],
    })).rejects.toMatchObject({
      name: "SemanticRepairExhaustedError",
      repairScope: "slot",
      targetIds: ["action-a"],
      issues: [{
        code: "private_reference",
        class: "reference",
        originalValue: "rt:fact:private",
        allowedHandles: ["ref:fact:public"],
      }],
    });
  });
});
