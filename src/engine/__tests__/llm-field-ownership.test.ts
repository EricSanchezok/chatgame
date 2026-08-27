import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  agentMindOutputSchema,
  actionGroundingSchema,
  causalVerificationSchema,
  observationBatchSchema,
  perceptionDirectiveSchema,
  reactionDecisionDraftSchema,
  reactionRoutingOutputSchema,
  resolutionDirectiveSchema,
  transitionProposalSchema,
} from "../llm-schemas";

const causalSource = {
  causes: [{ kind: "law" as const, id: "world-law" }],
  assertions: [{ kind: "elapsed_seconds_compare" as const, operator: "gte" as const, value: 0 }],
};

const emptyCharacter = {
  persona: { summary: "新生主体", voice: "平静", evidenceIds: [] },
  traits: {},
  values: {},
  emotions: {},
  attitudes: {},
  goals: {},
  commitments: {},
};

function transitionWith(operation?: unknown) {
  return {
    outcomes: [],
    mechanicInvocations: [],
    operations: operation === undefined ? [] : [operation],
    events: [{
      id: "event-local",
      description: "候选内事件。",
      impact: "ordinary",
      ...causalSource,
    }],
    decisionRequests: [],
  };
}

describe("LLM output field ownership", () => {
  it("generates strict JSON Schema for every model role without reintroducing owned fields", () => {
    const schemas = {
      perception: z.toJSONSchema(perceptionDirectiveSchema, { target: "draft-07" }),
      reactionRouting: z.toJSONSchema(reactionRoutingOutputSchema, { target: "draft-07" }),
      resolution: z.toJSONSchema(resolutionDirectiveSchema, { target: "draft-07" }),
      transition: z.toJSONSchema(transitionProposalSchema, { target: "draft-07" }),
      observation: z.toJSONSchema(observationBatchSchema, { target: "draft-07" }),
      causalVerifier: z.toJSONSchema(causalVerificationSchema, { target: "draft-07" }),
      agentMind: z.toJSONSchema(agentMindOutputSchema, { target: "draft-07" }),
      agentReaction: z.toJSONSchema(reactionDecisionDraftSchema, { target: "draft-07" }),
      actionGrounding: z.toJSONSchema(actionGroundingSchema, { target: "draft-07" }),
    };
    for (const schema of Object.values(schemas)) {
      expect(schema).toHaveProperty("$schema", "http://json-schema.org/draft-07/schema#");
    }
    expect(JSON.stringify(schemas.perception)).not.toContain('"phase"');
    expect(JSON.stringify(schemas.resolution)).not.toContain('"phase"');
    const transitionSchema = JSON.stringify(schemas.transition);
    for (const field of [
      "baseRevision",
      "createdAtStep",
      "updatedAtStep",
      "provenance",
      "firedThresholdIds",
      "modelProfiles",
      "nextAction",
    ]) {
      expect(transitionSchema).not.toContain(`"${field}"`);
    }
    expect(JSON.stringify(schemas.agentMind)).not.toContain('"step"');
    expect(JSON.stringify(schemas.actionGrounding)).not.toContain('"actionId"');
    expect(JSON.stringify(schemas.actionGrounding)).not.toContain('"actorId"');
    const observation = {
      summary: "看见庭院中的变化。",
      introductions: [],
      apparentClaims: [],
      sourceEventIds: [],
    };
    expect(observationBatchSchema.safeParse({ observations: [observation] }).success).toBe(true);
    expect(observationBatchSchema.safeParse({
      observations: [{ ...observation, id: "forged", observerId: "agent", step: 1, kind: "outcome" }],
    }).success).toBe(false);
    const grounding = { reads: [], writes: [], audienceAgentIds: [], globalFallback: false };
    expect(actionGroundingSchema.safeParse(grounding).success).toBe(true);
    expect(actionGroundingSchema.safeParse({
      ...grounding,
      actionId: "rt:action:forged",
      actorId: "agent-xiaoming",
    }).success).toBe(false);
  });

  it("keeps check aliases semantic while the engine owns phase", () => {
    const request = {
      id: "check-local",
      actorId: "agent-xiaoming",
      targetId: null,
      ratingId: null,
      modifier: 0,
      modifierSources: [],
      dc: 10,
      mode: "normal",
      stakes: "判断是否成功。",
      visibility: "result_only",
      causes: [{ kind: "law", id: "world-law" }],
    };
    expect(perceptionDirectiveSchema.safeParse({ kind: "request_checks", requests: [request] }).success)
      .toBe(true);
    expect(perceptionDirectiveSchema.safeParse({
      kind: "request_checks",
      requests: [{ ...request, phase: "perception" }],
    }).success).toBe(false);
  });

  it("lets reaction routing describe private semantics without assigning runtime identities", () => {
    const request = {
      agentId: "agent-xiaoming",
      sourceActionId: "action-local",
      stimulus: {
        summary: "有人在呼唤。",
        introductions: [],
        apparentClaims: [{
          subjectId: "speaker-local",
          predicate: "utterance",
          value: { kind: "text", value: "hello" },
          description: "听见一句话。",
        }],
      },
      basis: [{ kind: "fact", factId: "audible-channel" }],
    };
    expect(reactionRoutingOutputSchema.safeParse({ requests: [request] }).success).toBe(true);
    expect(reactionRoutingOutputSchema.safeParse({
      requests: [{
        ...request,
        stimulus: {
          ...request.stimulus,
          id: "forged-stimulus",
          apparentClaims: [{ ...request.stimulus.apparentClaims[0], id: "forged-claim" }],
        },
      }],
    }).success).toBe(false);
  });

  it("keeps semantic world ids and proposal aliases while rejecting engine-owned transition fields", () => {
    const semanticOperations = [
      {
        kind: "create_entity",
        entity: {
          id: "xiaoming-body",
          kind: "person",
          name: "小明",
          description: "一个新出现的人。",
        },
        placementId: null,
        ...causalSource,
      },
      {
        kind: "set_fact",
        fact: {
          id: "xiaoming-is-awake",
          subjectId: "xiaoming-body",
          predicate: "awake",
          value: { kind: "boolean", value: true },
          description: "小明醒着。",
          access: { kind: "public" },
        },
        ...causalSource,
      },
      {
        kind: "set_meter",
        meter: { id: "health:xiaoming", definitionId: "health", entityId: "xiaoming-body", current: 10 },
        ...causalSource,
      },
      {
        kind: "create_agent",
        agent: {
          id: "agent-xiaoming",
          entityId: "xiaoming-body",
          character: emptyCharacter,
          belief: {
            localEntities: {
              self: { id: "self", name: "我", description: "小明自己", status: "observed" },
            },
            claims: {},
            evidence: {},
          },
          bindings: { self: { localEntityId: "self", canonicalEntityIds: ["xiaoming-body"] } },
        },
        ...causalSource,
      },
    ];

    for (const operation of semanticOperations) {
      expect(transitionProposalSchema.safeParse(transitionWith(operation)).success).toBe(true);
    }

    const base = transitionWith();
    expect(transitionProposalSchema.safeParse({ ...base, baseRevision: 9 }).success).toBe(false);
    expect(transitionProposalSchema.safeParse({
      ...base,
      events: [{ ...base.events[0], step: 1 }],
    }).success).toBe(false);
    expect(transitionProposalSchema.safeParse({
      ...base,
      observations: [],
    }).success).toBe(false);
    expect(transitionProposalSchema.safeParse(transitionWith({
      ...semanticOperations[0],
      entity: { ...(semanticOperations[0] as { entity: object }).entity, lifecycle: "active", createdAtStep: 1 },
    })).success).toBe(false);
    expect(transitionProposalSchema.safeParse(transitionWith({
      ...semanticOperations[1],
      fact: { ...(semanticOperations[1] as { fact: object }).fact, provenance: [] },
    })).success).toBe(false);
    expect(transitionProposalSchema.safeParse(transitionWith({
      ...semanticOperations[2],
      meter: { ...(semanticOperations[2] as { meter: object }).meter, firedThresholdIds: [] },
    })).success).toBe(false);
    expect(transitionProposalSchema.safeParse(transitionWith({
      ...semanticOperations[3],
      agent: {
        ...(semanticOperations[3] as { agent: object }).agent,
        modelProfiles: { bootstrap: "forged", mind: "forged", reaction: "forged" },
        nextAction: null,
      },
    })).success).toBe(false);
  });

  it("lets AgentMind name evidence while the engine owns its step", () => {
    const output = {
      beliefPatch: {
        operations: [{
          kind: "upsert_evidence",
          evidence: {
            id: "heard-the-bell",
            kind: "observation",
            description: "我听见钟声。",
            sourceId: "rt:observation:source",
          },
        }],
      },
      characterPatch: { operations: [] },
      nextAction: { rawText: "寻找钟声来源", goal: "调查", means: null, targetIds: [] },
    };
    expect(agentMindOutputSchema.safeParse(output).success).toBe(true);
    expect(agentMindOutputSchema.safeParse({
      ...output,
      beliefPatch: {
        operations: [{
          ...output.beliefPatch.operations[0],
          evidence: { ...output.beliefPatch.operations[0].evidence, step: 1 },
        }],
      },
    }).success).toBe(false);
  });
});
