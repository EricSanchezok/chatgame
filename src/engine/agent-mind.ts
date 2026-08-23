import { applyBeliefPatch } from "./belief";
import { applyCharacterPatch } from "./character";
import {
  agentMindOutputSchema,
  reactionDecisionSchema,
  type AgentMindOutput,
} from "./llm-schemas";
import { canonicalize, contentHash } from "./model-audit";
import type { StructuredModelProvider } from "./model-provider";
import type {
  AgentActionProposal,
  AgentSelfStateView,
  AgentState,
  ModelExecutionAudit,
  ObservationPacket,
  ReactionDecision,
  WorldEvent,
} from "./model";

const AGENT_SYSTEM = `你是游戏世界中的一个有限认知 Agent，不是全知叙事者。
你只能依据提供的信念图、角色状态、精确但去 canonical ID 的自身状态和 Observation 行动。
Observation 是你感知到的表象，不保证等于真相；你可以相信、怀疑、误解或拒绝它。
你可以形成现实中不存在的假设实体，但不得使用 canonical entity id，也不得声称知道未提供的信息。
先用 BeliefPatch 更新自己的主观世界，再用 CharacterPatch 表达有当前 Observation 和 evidence 支撑的角色演化，最后提出下一世界步骤的预备行动。
CharacterPatch 中每项操作都必须引用本步骤属于你的 Observation；人格、长期特质和价值观只能在事件影响级别允许时改变。没有合理演化就返回空 operations。
行动不是固定菜单：rawText、goal 和 means 使用自然语言；targetIds 只能引用更新后的局部实体。
不要输出思维链，只输出符合 schema 的 JSON 对象。`;

const REACTION_SYSTEM = `你是游戏世界中的一个有限认知 Agent。你已经为本步骤预提交了一个行动，现在刚感知到玩家本步骤的新行动刺激。
你只能依据自己的信念、角色状态、自身状态和提供的 stimulus 决定保留原行动，或用一个新的行动替换它。
这是一次有限 reaction window：不得改变信念或角色状态，不得为其他 actor 行动，不得改变 baseRevision，也不得触发第二轮反应。
replacementAction 的 targetIds 只能引用你已知或 stimulus 新引入的局部实体。不要输出思维链，只输出符合 schema 的 JSON 对象。`;

function visibleObservation(packet: ObservationPacket): ObservationPacket {
  return {
    ...structuredClone(packet),
    introductions: packet.introductions.map(({ localEntity }) => ({ localEntity: structuredClone(localEntity) })),
  };
}

function validateMindOutput(
  agent: AgentState,
  revision: number,
  step: number,
  observations: readonly ObservationPacket[],
  events: readonly WorldEvent[],
  output: AgentMindOutput,
): AgentMindOutput {
  if (output.beliefPatch.agentId !== agent.id) {
    throw new Error(`AgentMind ${agent.id} returned patch for ${output.beliefPatch.agentId}`);
  }
  if (output.beliefPatch.baseRevision !== revision) {
    throw new Error(`AgentMind ${agent.id} returned stale belief patch`);
  }
  if (output.characterPatch.agentId !== agent.id) {
    throw new Error(`AgentMind ${agent.id} returned character patch for ${output.characterPatch.agentId}`);
  }
  if (output.characterPatch.baseRevision !== revision) {
    throw new Error(`AgentMind ${agent.id} returned stale character patch`);
  }
  if (output.nextAction.actorId !== agent.id) {
    throw new Error(`AgentMind ${agent.id} returned action for ${output.nextAction.actorId}`);
  }
  if (output.nextAction.baseRevision !== revision) {
    throw new Error(`AgentMind ${agent.id} returned action for revision ${output.nextAction.baseRevision}`);
  }
  const belief = applyBeliefPatch(agent.belief, output.beliefPatch);
  applyCharacterPatch(agent.character, belief, output.characterPatch, step, observations, events);
  for (const targetId of output.nextAction.targetIds) {
    if (!belief.localEntities[targetId]) {
      throw new Error(`AgentMind ${agent.id} targeted unknown local entity ${targetId}`);
    }
  }
  return output;
}

function validateReactionDecision(
  agent: AgentState,
  revision: number,
  originalAction: AgentActionProposal,
  stimulus: ObservationPacket,
  decision: ReactionDecision,
): ReactionDecision {
  if (decision.agentId !== agent.id) {
    throw new Error(`Agent reaction ${agent.id} returned decision for ${decision.agentId}`);
  }
  if (decision.baseRevision !== revision) throw new Error(`Agent reaction ${agent.id} used a stale revision`);
  if (decision.originalProposalId !== originalAction.id) {
    throw new Error(`Agent reaction ${agent.id} replaced an unknown proposal`);
  }
  if (decision.kind === "keep") return decision;

  const replacement = decision.replacementAction;
  if (replacement.actorId !== agent.id) throw new Error(`Agent reaction ${agent.id} changed actor`);
  if (replacement.baseRevision !== revision) throw new Error(`Agent reaction ${agent.id} changed revision`);
  const allowedTargets = new Set([
    ...Object.keys(agent.belief.localEntities),
    ...stimulus.introductions.map((introduction) => introduction.localEntity.id),
  ]);
  for (const targetId of replacement.targetIds) {
    if (!allowedTargets.has(targetId)) {
      throw new Error(`Agent reaction ${agent.id} targeted unknown local entity ${targetId}`);
    }
  }
  return decision;
}

function audit(
  role: ModelExecutionAudit["role"],
  agent: AgentState,
  provider: StructuredModelProvider,
  attempts: number,
  requestHashes: string[],
  responseHashes: string[],
): ModelExecutionAudit {
  const descriptor = provider.describe(agent.modelProfileId);
  return {
    role,
    subjectId: agent.id,
    profileId: agent.modelProfileId,
    providerId: descriptor.providerId,
    modelId: descriptor.modelId,
    attempts,
    repairAttempts: attempts - 1,
    requestHashes,
    responseHashes,
  };
}

export class AgentMind {
  constructor(
    private readonly provider: StructuredModelProvider,
    private readonly repairAttempts = 2,
  ) {}

  async think(
    agent: AgentState,
    revision: number,
    step: number,
    observations: readonly ObservationPacket[],
    selfState: AgentSelfStateView,
    events: readonly WorldEvent[],
  ): Promise<AgentMindOutput & { modelAudit: ModelExecutionAudit }> {
    const basePrompt = JSON.stringify(
      canonicalize({
        revision,
        step,
        agent: {
          id: agent.id,
          character: agent.character,
          belief: agent.belief,
          selfState,
        },
        observations: observations.map(visibleObservation),
      }),
      null,
      2,
    );

    let lastError = "";
    const requestHashes: string[] = [];
    const responseHashes: string[] = [];
    for (let attempt = 0; attempt <= this.repairAttempts; attempt += 1) {
      const prompt = lastError
        ? `${basePrompt}\n\n上一次输出无效，请修复但不要改变未被错误涉及的内容：\n${lastError}`
        : basePrompt;
      try {
        requestHashes.push(contentHash({ system: AGENT_SYSTEM, prompt }));
        const output = await this.provider.generateObject({
          profileId: agent.modelProfileId,
          system: AGENT_SYSTEM,
          prompt,
          schema: agentMindOutputSchema,
        });
        responseHashes.push(contentHash(output));
        const validated = validateMindOutput(agent, revision, step, observations, events, output);
        return {
          ...validated,
          modelAudit: audit("agent-mind", agent, this.provider, attempt + 1, requestHashes, responseHashes),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`AgentMind ${agent.id} failed after repairs: ${lastError}`);
  }

  async react(
    agent: AgentState,
    revision: number,
    step: number,
    originalAction: AgentActionProposal,
    stimulus: ObservationPacket,
    selfState: AgentSelfStateView,
  ): Promise<ReactionDecision & { modelAudit: ModelExecutionAudit }> {
    const basePrompt = JSON.stringify(
      canonicalize({
        revision,
        step,
        agent: {
          id: agent.id,
          character: agent.character,
          belief: agent.belief,
          selfState,
        },
        originalAction,
        stimulus: visibleObservation(stimulus),
      }),
      null,
      2,
    );

    let lastError = "";
    const requestHashes: string[] = [];
    const responseHashes: string[] = [];
    for (let attempt = 0; attempt <= this.repairAttempts; attempt += 1) {
      const prompt = lastError
        ? `${basePrompt}\n\n上一次输出无效，请修复：\n${lastError}`
        : basePrompt;
      try {
        requestHashes.push(contentHash({ system: REACTION_SYSTEM, prompt }));
        const decision = await this.provider.generateObject({
          profileId: agent.modelProfileId,
          system: REACTION_SYSTEM,
          prompt,
          schema: reactionDecisionSchema,
        });
        responseHashes.push(contentHash(decision));
        const validated = validateReactionDecision(agent, revision, originalAction, stimulus, decision);
        return {
          ...validated,
          modelAudit: audit("agent-reaction", agent, this.provider, attempt + 1, requestHashes, responseHashes),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`Agent reaction ${agent.id} failed after repairs: ${lastError}`);
  }
}

export function sanitizeObservationForAgent(packet: ObservationPacket): ObservationPacket {
  return visibleObservation(packet);
}
