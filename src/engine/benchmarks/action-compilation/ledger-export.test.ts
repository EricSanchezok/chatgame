import { describe, expect, it } from "vitest";
import { ACTION_COMPILATION_PROJECTION } from "../../contracts/model-context";
import type { ActionCompilationReferenceAudit } from "../../contracts/model";
import type { ExecutionRecord } from "../../../server/execution-ledger";
import type { RuntimeEvent } from "../../runtime/observability";
import { contentHash } from "../../models/model-audit";
import { exportActionCompilationFromLedger, type LedgerActionCompilationSource } from "./ledger-export";

function event(input: Partial<RuntimeEvent> & Pick<RuntimeEvent, "event">): RuntimeEvent {
  return {
    schemaVersion: 3,
    sequence: 0,
    timestamp: "2026-01-01T00:00:00.000Z",
    level: "info",
    ...input,
  } as RuntimeEvent;
}

function execution(id = "execution-1"): ExecutionRecord {
  return {
    id,
    kind: "interactive",
    manifest: { hash: "algorithm-hash" },
    worldHash: "world-hash",
    codeRevision: "revision",
    codeDirty: false,
    modelCatalogHash: "model-catalog-hash",
    seed: 1,
    runtimeConfig: {},
    status: "failed",
    traceId: `trace-${id}`,
  } as ExecutionRecord;
}

function reference(actionIds: readonly string[], keysByAction: Readonly<Record<string, string[]>>): ActionCompilationReferenceAudit {
  return {
    protocolVersion: 2,
    projection: ACTION_COMPILATION_PROJECTION,
    context: {
      utf8Bytes: 1,
      referenceCatalogUtf8Bytes: 1,
      slots: actionIds.length,
      candidates: 2,
      detailedCandidates: 0,
      duplicateSemanticDefinitionCount: 0,
      canonicalRefSerializedCount: 0,
      rawPrivateReferenceSerializedCount: 0,
    },
    slots: actionIds.map((actionId, slot) => ({
      slot,
      actionId,
      actionLabel: actionId,
      actionCandidateKey: "candidate_aaaaaaaaaaaa",
      actor: {
        agentId: `agent-${slot}`,
        entityId: null,
        status: "unique" as const,
        agentCandidateKey: null,
        boundEntityCandidateKey: null,
        agentHandle: null,
        entityHandle: null,
      },
      targets: [],
      selections: (keysByAction[actionId] ?? []).map((candidateKey) => ({
        path: ["targets", 0],
        use: "target",
        candidateKey,
        engineHandle: null,
        kind: "entity",
        status: "resolved" as const,
      })),
    })),
  };
}

function sourceWithAttempts(
  attempts: readonly {
    invocationId: string;
    logicalInvocationId: string;
    semanticRepairAttempt: number;
    sequence: number;
    parentInvocationId?: string;
    repairOf?: string;
    rejected?: boolean;
    keysByAction: Readonly<Record<string, string[]>>;
    actionIds: readonly string[];
  }[],
): LedgerActionCompilationSource {
  const candidates = [
    {
      candidateKey: "candidate_aaaaaaaaaaaa",
      kind: "entity",
      label: "A",
      meaning: "A",
      allowedUses: ["target"],
      scope: { kind: "shared" },
      details: {},
    },
    {
      candidateKey: "candidate_bbbbbbbbbbbb",
      kind: "entity",
      label: "B",
      meaning: "B",
      allowedUses: ["target"],
      scope: { kind: "shared" },
      details: {},
    },
  ];
  const context = {
    referenceCatalog: { version: 2, hash: "catalog-hash", candidates },
    task: { slots: attempts[0]?.actionIds.map((actionId) => ({ actionId })) ?? [] },
  };
  const events: RuntimeEvent[] = [
    event({
      event: "step.preparation.started",
      payload: { definition: { id: "blackmarsh", initialState: { revision: 0 } } },
    }),
  ];
  const rootAttempts = attempts.filter((attempt) => attempt.semanticRepairAttempt === 0);
  for (const [index, attempt] of rootAttempts.entries()) {
    events.push(event({
      event: "model.context.serialized",
      sequence: index + 1,
      correlation: {
        modelRole: "action-compilation",
        modelInvocationId: attempt.invocationId,
        logicalInvocationId: attempt.logicalInvocationId,
        semanticRepairAttempt: 0,
      },
      payload: {
        context,
        promptVersion: "action-compilation@test",
        profileId: "truth-deepseek",
        modelId: "deepseek-v4-flash",
        modelCatalogHash: "model-catalog-hash",
        registrySnapshotHash: "registry-hash",
      },
    }));
  }
  for (const attempt of attempts) {
    events.push(event({
      event: "model.action_compilation.references",
      sequence: attempt.sequence,
      correlation: {
        modelRole: "action-compilation",
        modelInvocationId: attempt.invocationId,
        logicalInvocationId: attempt.logicalInvocationId,
        semanticRepairAttempt: attempt.semanticRepairAttempt,
        ...(attempt.parentInvocationId ? { parentInvocationId: attempt.parentInvocationId } : {}),
        ...(attempt.repairOf ? { repairOf: attempt.repairOf } : {}),
      },
      payload: reference(attempt.actionIds, attempt.keysByAction),
    }));
    if (attempt.rejected) {
      events.push(event({
        event: "model.semantic.rejected",
        sequence: attempt.sequence + 1,
        correlation: {
          modelRole: "action-compilation",
          modelInvocationId: attempt.invocationId,
          logicalInvocationId: attempt.logicalInvocationId,
          semanticRepairAttempt: attempt.semanticRepairAttempt,
        },
        error: { name: "ActionCompilationError", message: "semantic rejection" },
      }));
    }
  }
  return { execution: execution(), events };
}

describe("exportActionCompilationFromLedger", () => {
  it("exports accepted slots, keeps partial batch successes, and excludes terminal failures", () => {
    const source = sourceWithAttempts([
      {
        invocationId: "root",
        logicalInvocationId: "logical-1",
        semanticRepairAttempt: 0,
        sequence: 2,
        rejected: true,
        actionIds: ["action-a", "action-b"],
        keysByAction: {
          "action-a": ["candidate_aaaaaaaaaaaa"],
          "action-b": ["candidate_bbbbbbbbbbbb"],
        },
      },
      {
        invocationId: "repair",
        logicalInvocationId: "logical-1",
        semanticRepairAttempt: 1,
        sequence: 4,
        rejected: true,
        actionIds: ["action-b"],
        keysByAction: { "action-b": ["candidate_bbbbbbbbbbbb"] },
      },
    ]);
    const result = exportActionCompilationFromLedger([source]);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.actionId).toBe("action-a");
    expect(result.stats.acceptedSlots).toBe(1);
    expect(result.stats.rejectedSlots).toBe(1);
    expect(result.cases[0]?.provenance?.repairCount).toBe(0);
  });

  it("uses the final successful repair output and deduplicates contexts", () => {
    const source = sourceWithAttempts([
      {
        invocationId: "root",
        logicalInvocationId: "logical-1",
        semanticRepairAttempt: 0,
        sequence: 2,
        rejected: true,
        actionIds: ["action-a"],
        keysByAction: { "action-a": ["candidate_aaaaaaaaaaaa"] },
      },
      {
        invocationId: "repair",
        logicalInvocationId: "logical-1",
        semanticRepairAttempt: 1,
        sequence: 4,
        parentInvocationId: "root",
        repairOf: "root",
        actionIds: ["action-a"],
        keysByAction: { "action-a": ["candidate_bbbbbbbbbbbb"] },
      },
      {
        invocationId: "root-2",
        logicalInvocationId: "logical-2",
        semanticRepairAttempt: 0,
        sequence: 6,
        actionIds: ["action-c"],
        keysByAction: { "action-c": ["candidate_aaaaaaaaaaaa"] },
      },
    ]);
    const before = JSON.stringify(source.events);
    const result = exportActionCompilationFromLedger([source]);
    expect(result.cases).toHaveLength(2);
    expect(result.cases.find((item) => item.actionId === "action-a")?.requiredCandidateKeys).toEqual(["candidate_bbbbbbbbbbbb"]);
    expect(result.contexts).toHaveLength(1);
    expect(JSON.stringify(source.events)).toBe(before);
  });

  it("fails closed for an invalid or invisible candidate key", () => {
    const source = sourceWithAttempts([{
      invocationId: "root",
      logicalInvocationId: "logical-1",
      semanticRepairAttempt: 0,
      sequence: 2,
      actionIds: ["action-a"],
      keysByAction: { "action-a": ["candidate_cccccccccccc"] },
    }]);
    expect(() => exportActionCompilationFromLedger([source])).toThrow(/absent from catalog/u);
  });

  it("produces a stable context hash for the exported context", () => {
    const source = sourceWithAttempts([{
      invocationId: "root",
      logicalInvocationId: "logical-1",
      semanticRepairAttempt: 0,
      sequence: 2,
      actionIds: ["action-a"],
      keysByAction: { "action-a": ["candidate_aaaaaaaaaaaa"] },
    }]);
    const result = exportActionCompilationFromLedger([source]);
    expect(result.contexts[0]?.contextHash).toBe(contentHash(result.contexts[0]?.context));
  });
});
