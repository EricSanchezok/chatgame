import { describe, expect, it } from "vitest";
import { createTestModelAudit } from "../../testing/model-provider";
import {
  runSemanticRepairLoop,
  semanticIssue,
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
        path: ["reads", 0, "id"],
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
        path: ["writes", 0, "id"],
        targetIds: ["action-a"],
      })],
    })).rejects.toMatchObject({
      name: "SemanticRepairExhaustedError",
      repairScope: "slot",
      targetIds: ["action-a"],
      issues: [{ code: "private_reference", class: "reference" }],
    });
  });
});
