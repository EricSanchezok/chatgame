import { applyBeliefPatch } from "./belief";
import { agentMindOutputSchema, type AgentMindOutput } from "./llm-schemas";
import type { StructuredModelProvider } from "./model-provider";
import type { AgentState, ObservationPacket } from "./model";

const AGENT_SYSTEM = `你是游戏世界中的一个有限认知 Agent，不是全知叙事者。
你只能依据提供的信念图、人格、目标和 Observation 行动。
Observation 是你感知到的表象，不保证等于真相；你可以相信、怀疑、误解或拒绝它。
你可以形成现实中不存在的假设实体，但不得使用 canonical entity id，也不得声称知道未提供的信息。
先用 BeliefPatch 更新自己的主观世界，再提出下一世界步骤要尝试的任意自然语言行动。
行动不是固定菜单：rawText、goal 和 means 使用自然语言；targetIds 只能引用你的局部实体。
不要输出思维链，只输出 schema 要求的结构化结果。`;

function visibleObservation(packet: ObservationPacket): ObservationPacket {
  return {
    ...structuredClone(packet),
    introductions: packet.introductions.map(({ localEntity }) => ({ localEntity: structuredClone(localEntity) })),
  };
}

function validateMindOutput(
  agent: AgentState,
  revision: number,
  output: AgentMindOutput,
): AgentMindOutput {
  if (output.beliefPatch.agentId !== agent.id) {
    throw new Error(`AgentMind ${agent.id} returned patch for ${output.beliefPatch.agentId}`);
  }
  if (output.beliefPatch.baseRevision !== revision) {
    throw new Error(`AgentMind ${agent.id} returned stale belief patch`);
  }
  if (output.nextAction.actorId !== agent.id) {
    throw new Error(`AgentMind ${agent.id} returned action for ${output.nextAction.actorId}`);
  }
  if (output.nextAction.baseRevision !== revision) {
    throw new Error(`AgentMind ${agent.id} returned action for revision ${output.nextAction.baseRevision}`);
  }
  const belief = applyBeliefPatch(agent.belief, output.beliefPatch);
  for (const targetId of output.nextAction.targetIds) {
    if (!belief.localEntities[targetId]) {
      throw new Error(`AgentMind ${agent.id} targeted unknown local entity ${targetId}`);
    }
  }
  return output;
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
  ): Promise<AgentMindOutput> {
    const safeAgent = {
      id: agent.id,
      localSelfId: Object.values(agent.bindings).find((binding) =>
        binding.canonicalEntityIds.includes(agent.entityId))?.localEntityId,
      persona: agent.persona,
      goals: agent.goals,
      belief: agent.belief,
    };
    const basePrompt = JSON.stringify(
      {
        revision,
        step,
        agent: safeAgent,
        observations: observations.map(visibleObservation),
      },
      null,
      2,
    );

    let lastError = "";
    for (let attempt = 0; attempt <= this.repairAttempts; attempt += 1) {
      const prompt = lastError
        ? `${basePrompt}\n\n上一次输出无效，请修复但不要改变未被错误涉及的内容：\n${lastError}`
        : basePrompt;
      try {
        const output = await this.provider.generateObject({
          profileId: agent.modelProfileId,
          system: AGENT_SYSTEM,
          prompt,
          schema: agentMindOutputSchema,
        });
        return validateMindOutput(agent, revision, output);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`AgentMind ${agent.id} failed after repairs: ${lastError}`);
  }
}

export function sanitizeObservationForAgent(packet: ObservationPacket): ObservationPacket {
  return visibleObservation(packet);
}
