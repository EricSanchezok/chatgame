import { z } from "zod";
import { observationBatchSchema } from "../contracts/llm-schemas";
import type {
  AgentActionProposal,
  ModelExecutionAudit,
  ObservationPacket,
  ObservationPacketDraft,
  ObservationRenderDraft,
  SimulationState,
  TransitionProposal,
} from "../contracts/model";
import {
  combineModelExecutionAudits,
  ModelConfigurationError,
  ModelOutputError,
  ModelSemanticRepairError,
  modelInvocationCorrelation,
  modelInvocationIdentity,
  setModelInvocationOutcome,
  setModelInvocationResultKind,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "../models/model-provider";
import { validatePublicInformationBoundary } from "./information-boundary";
import { validateObservations } from "./observation";
import { MODEL_CONTEXT_CONTRACT_VERSION } from "../contracts/prompts";
import { materializeObservationPackets } from "../mechanics/truth-engine";
import { applyTransitionProposal } from "../runtime/transaction";
import type { WorldDefinition } from "../runtime/world-definition";
import type { TemporalStateSnapshot } from "../mechanics/temporal";

const OBSERVATION_PROMPT_VERSION = "observation-renderer-v3";
const OBSERVATION_SYSTEM = `你是 Living World Engine 的观察渲染器。
输入包含已经裁决但尚未提交的候选世界变化，以及按固定顺序排列的观察槽位。

必须为每个槽位输出恰好一项 observation，顺序与槽位完全一致。不要输出 observation id、observer id、step 或 kind；这些字段由引擎分配。

每项 observation 只能描述对应主体可感知的表象。summary、localEntity 和 apparentClaims 不得泄露 canonical id、隐藏事实、其他主体认知、内部检定或裁判理由。
summary 中的每个具体断言都必须能在 context.currentEvents、context.outcomes、context.candidateWorld.publicFacts、对应 action 或本次 observation 的 apparentClaims 中找到直接依据；不得臆造天气、气味、声音、情绪、人物缺席或其他未提供的细节。没有依据时使用简短的“本步骤没有形成其他可确认的观察”，不要用文学化细节填充。
新局部实体使用观察者自己的语义别名，并通过 introductions 的服务端私有 canonicalEntityId 建立绑定；不得把 canonical entity id 复制成 localEntity.id。
observer.knownBindings 是仅供渲染器复用既有局部别名的服务端私有映射，不得在 summary、localEntity 或 apparentClaims 中泄露。一个 canonical entity 已有唯一映射时，必须复用对应 localEntityId，不要重复 introduction。
sourceEventIds 只能引用 context.currentEvents 中已列出的事件。

只输出 schema 指定的 JSON，不输出 Markdown、解释或思维链。`;

interface RenderInput {
  definition: WorldDefinition;
  state: SimulationState;
  proposal: TransitionProposal;
  actions: readonly AgentActionProposal[];
  observerIds: readonly string[];
  identityOwner: string;
  temporalState?: Readonly<TemporalStateSnapshot>;
}

interface ObservationBatch {
  observerIds: string[];
  context: ReturnType<typeof observationContext>;
}

function observationContext(input: RenderInput, observerIds: readonly string[], issues: readonly string[]) {
  const candidate = applyTransitionProposal(input.state, input.proposal, input.temporalState);
  const publicFacts = Object.values(candidate.truth.facts)
    .filter((fact) => fact.access.kind === "public")
    .sort((left, right) => left.id.localeCompare(right.id));
  const privateFacts = (observerId: string) => Object.values(candidate.truth.facts)
    .filter((fact) => fact.access.kind === "agents" && fact.access.agentIds.includes(observerId))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    contractVersion: MODEL_CONTEXT_CONTRACT_VERSION,
    promptVersion: OBSERVATION_PROMPT_VERSION,
    world: {
      id: input.definition.id,
      description: input.definition.description,
      laws: input.definition.laws,
    },
    baseRevision: input.state.revision,
    nextStep: candidate.step,
    candidateWorld: {
      elapsedSeconds: candidate.truth.elapsedSeconds,
      entities: Object.values(candidate.truth.entities).map(({ id, kind, name, lifecycle }) => ({
        id, kind, name, lifecycle,
      })),
      placements: candidate.truth.placements,
      publicFacts,
    },
    actions: input.actions,
    outcomes: input.proposal.outcomes,
    operations: input.proposal.operations,
    currentEvents: input.proposal.events,
    observationSlots: observerIds.map((observerId, slot) => {
      const agent = candidate.agents[observerId];
      if (!agent) throw new Error(`observation slot references unknown Agent ${observerId}`);
      return {
        slot,
        observer: {
          agentId: observerId,
          entityId: agent.entityId,
          placementEntityId: candidate.truth.placements[agent.entityId] ?? null,
          localEntities: Object.values(agent.belief.localEntities)
            .map((entity) => structuredClone(entity))
            .sort((left, right) => left.id.localeCompare(right.id)),
          knownBindings: Object.values(agent.bindings)
            .map((binding) => ({
              localEntityId: binding.localEntityId,
              canonicalEntityIds: [...binding.canonicalEntityIds].sort(),
            }))
            .sort((left, right) => left.localEntityId.localeCompare(right.localEntityId)),
          privateFacts: privateFacts(observerId),
        },
      };
    }),
    validationIssues: issues,
  };
}

function requestBytes(context: unknown): number {
  return Buffer.byteLength(JSON.stringify({
    system: OBSERVATION_SYSTEM,
    context,
    schema: z.toJSONSchema(observationBatchSchema, { target: "draft-07" }),
  }), "utf8");
}

export function normalizeObservationSourceEventIds(
  drafts: readonly ObservationRenderDraft[],
  currentEventIds: ReadonlySet<string>,
): { drafts: ObservationRenderDraft[]; droppedReferences: number } {
  let droppedReferences = 0;
  const normalized = drafts.map((draft) => {
    const seen = new Set<string>();
    const sourceEventIds = draft.sourceEventIds.filter((eventId) => {
      if (!currentEventIds.has(eventId) || seen.has(eventId)) {
        droppedReferences += 1;
        return false;
      }
      seen.add(eventId);
      return true;
    });
    return { ...structuredClone(draft), sourceEventIds };
  });
  return { drafts: normalized, droppedReferences };
}

export function normalizeObservationLocalReferences(
  state: Readonly<SimulationState>,
  observerIds: readonly string[],
  drafts: readonly ObservationRenderDraft[],
): {
  drafts: ObservationRenderDraft[];
  droppedClaims: number;
  droppedIntroductions: number;
  clearedCanonicalBindings: number;
} {
  let droppedClaims = 0;
  let droppedIntroductions = 0;
  let clearedCanonicalBindings = 0;
  const normalized = drafts.map((draft, index) => {
    const agent = state.agents[observerIds[index]];
    if (!agent) throw new Error(`observation slot references unknown Agent ${observerIds[index]}`);
    const localIds = new Set([
      ...Object.keys(agent.belief.localEntities),
      ...Object.keys(agent.bindings),
    ]);
    const introductions = draft.introductions.flatMap((introduction) => {
      const localId = introduction.localEntity.id;
      if (localIds.has(localId) || state.truth.entities[localId]) {
        droppedIntroductions += 1;
        return [];
      }
      localIds.add(localId);
      if (introduction.canonicalEntityId && !state.truth.entities[introduction.canonicalEntityId]) {
        clearedCanonicalBindings += 1;
        return [{ ...structuredClone(introduction), canonicalEntityId: null }];
      }
      return [structuredClone(introduction)];
    });
    const apparentClaims = draft.apparentClaims.filter((claim) => {
      const validSubject = localIds.has(claim.subjectId);
      const validValue = claim.value.kind !== "local_entity" || localIds.has(claim.value.localEntityId);
      if (validSubject && validValue) return true;
      droppedClaims += 1;
      return false;
    }).map((claim) => structuredClone(claim));
    return { ...structuredClone(draft), introductions, apparentClaims };
  });
  return { drafts: normalized, droppedClaims, droppedIntroductions, clearedCanonicalBindings };
}

export function partitionObservationBatches(input: RenderInput, maxInputBytes: number): ObservationBatch[] {
  const result: ObservationBatch[] = [];
  let current: string[] = [];
  for (const observerId of input.observerIds) {
    const proposed = [...current, observerId];
    const context = observationContext(input, proposed, []);
    if (requestBytes(context) <= maxInputBytes) {
      current = proposed;
      continue;
    }
    if (current.length === 0) {
      const bytes = requestBytes(context);
      throw new ModelConfigurationError(
        `observation context for ${observerId} uses ${bytes} bytes and exceeds profile max_input_bytes ${maxInputBytes}`,
      );
    }
    result.push({ observerIds: current, context: observationContext(input, current, []) });
    current = [observerId];
    const singleton = observationContext(input, current, []);
    const singletonBytes = requestBytes(singleton);
    if (singletonBytes > maxInputBytes) {
      throw new ModelConfigurationError(
        `observation context for ${observerId} uses ${singletonBytes} bytes and exceeds profile max_input_bytes ${maxInputBytes}`,
      );
    }
  }
  if (current.length > 0) {
    result.push({ observerIds: current, context: observationContext(input, current, []) });
  }
  return result;
}

function materializeBatch(
  input: RenderInput,
  observerIds: readonly string[],
  drafts: readonly ObservationRenderDraft[],
  batchKey: string,
  scope: ModelExecutionScope,
): ObservationPacket[] {
  if (drafts.length !== observerIds.length) {
    throw new Error(`observation batch returned ${drafts.length} items for ${observerIds.length} slots`);
  }
  const eventIds = new Set(input.proposal.events.map((event) => event.id));
  const eventNormalized = normalizeObservationSourceEventIds(drafts, eventIds);
  const candidate = applyTransitionProposal(input.state, input.proposal, input.temporalState);
  const localNormalized = normalizeObservationLocalReferences(
    candidate,
    observerIds,
    eventNormalized.drafts,
  );
  const normalizedCount = eventNormalized.droppedReferences + localNormalized.droppedClaims +
    localNormalized.droppedIntroductions + localNormalized.clearedCanonicalBindings;
  if (normalizedCount > 0) {
    scope.observer?.emit({
      event: "algorithm.observation.references_normalized",
      level: "warn",
      correlation: scope.correlation,
      attributes: { phase: "observation", batch: batchKey },
      counts: {
        droppedObservationEventReferences: eventNormalized.droppedReferences,
        droppedObservationClaims: localNormalized.droppedClaims,
        droppedObservationIntroductions: localNormalized.droppedIntroductions,
        clearedObservationCanonicalBindings: localNormalized.clearedCanonicalBindings,
      },
    });
  }
  const packets = localNormalized.drafts.map((draft, index): ObservationPacketDraft => {
    return {
      id: `observation-slot-${batchKey}-${index}`,
      ...structuredClone(draft),
      // Slot ownership is assigned by the engine; a model must not be able
      // to move an observation to another Agent by echoing observerId.
      observerId: observerIds[index]!,
    };
  });
  const materialized = materializeObservationPackets(input.state, packets, "outcome").packets;
  validateObservations(candidate, materialized, candidate.step);
  // Validate against the post-proposal candidate so observations can be
  // addressed to Agents created by this same transition. The candidate still
  // contains the full canonical/private state, so hidden cognition remains
  // protected while dynamic lifecycle introductions become observable.
  validatePublicInformationBoundary(candidate, input.actions, {
    ...structuredClone(input.proposal),
    observations: materialized,
  });
  return materialized;
}

async function renderBatch(
  provider: StructuredModelProvider,
  input: RenderInput,
  batch: ObservationBatch,
  batchKey: string,
  scope: ModelExecutionScope,
): Promise<{ packets: ObservationPacket[]; audit: ModelExecutionAudit }> {
  const audits: ModelExecutionAudit[] = [];
  let issues: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const owner = `${input.identityOwner}:batch-${batchKey}`;
    const identity = modelInvocationIdentity(scope, "observation-renderer", owner, attempt + 1);
    try {
      const context = issues.length === 0
        ? batch.context
        : observationContext(input, batch.observerIds, issues);
      const generated = await provider.generateStructured({
        profileId: input.definition.modelProfiles.observation,
        workloadId: scope.workloadId,
        batchId: scope.batchId,
        abortSignal: scope.abortSignal,
        correlation: scope.correlation,
        observer: scope.observer,
        ...identity,
        role: "observation-renderer",
        subjectId: owner,
        promptVersion: OBSERVATION_PROMPT_VERSION,
        schemaName: "observation_batch",
        system: OBSERVATION_SYSTEM,
        context,
        schema: observationBatchSchema,
      });
      audits.push(generated.audit);
      const packets = materializeBatch(
        input,
        batch.observerIds,
        generated.value.observations,
        batchKey,
        scope,
      );
      setModelInvocationResultKind(generated.audit, "observation-renderer_batch");
      setModelInvocationOutcome(generated.audit, "accepted");
      return { packets, audit: combineModelExecutionAudits(audits) };
    } catch (error) {
      if (error instanceof ModelOutputError && error.audit) audits.push(error.audit);
      issues = [error instanceof Error ? error.message : String(error)];
      const audit = audits.at(-1);
      if (audit?.invocations.length) setModelInvocationOutcome(audit, "rejected", ["invalid_observation_batch"]);
      scope.observer?.emit({
        event: "model.semantic.rejected",
        level: "warn",
        correlation: modelInvocationCorrelation(scope, "observation-renderer", owner, identity),
        attributes: { resultKind: "observation-renderer_batch" },
        error: { name: error instanceof Error ? error.name : "Error", message: issues[0] },
      });
      if (attempt === 2) {
        throw new ModelSemanticRepairError(
          "observation-renderer",
          `observation batch ${batchKey} failed after repairs: ${issues[0]}`,
          {
            cause: error,
            audit: audits.length > 0 ? combineModelExecutionAudits(audits) : undefined,
          },
        );
      }
    }
  }
  throw new Error("unreachable observation repair loop");
}

export class ObservationRenderer {
  constructor(private readonly provider: StructuredModelProvider) {}

  async render(input: RenderInput, scope: ModelExecutionScope): Promise<{
    packets: ObservationPacket[];
    modelAudits: ModelExecutionAudit[];
    batchCount: number;
  }> {
    const profile = this.provider.catalog.profile(input.definition.modelProfiles.observation);
    const batches = partitionObservationBatches(input, profile.max_input_bytes);
    const renderRecovering = async (
      batch: ObservationBatch,
      batchKey: string,
    ): Promise<{ packets: ObservationPacket[]; audits: ModelExecutionAudit[]; batchCount: number }> => {
      try {
        const rendered = await renderBatch(this.provider, input, batch, batchKey, scope);
        return { packets: rendered.packets, audits: [rendered.audit], batchCount: 1 };
      } catch (error) {
        if (!(error instanceof ModelSemanticRepairError) || !error.audit) throw error;
        if (batch.observerIds.length > 1) {
          const middle = Math.ceil(batch.observerIds.length / 2);
          const halves = [batch.observerIds.slice(0, middle), batch.observerIds.slice(middle)];
          scope.observer?.emit({
            event: "algorithm.observation.batch_split",
            level: "warn",
            correlation: scope.correlation,
            attributes: { phase: "observation", batch: batchKey },
            counts: { observationBatchSplits: 1, splitObserverSlots: batch.observerIds.length },
          });
          const children = await Promise.all(halves.map((observerIds, index) => renderRecovering({
            observerIds,
            context: observationContext(input, observerIds, []),
          }, `${batchKey}.${index}`)));
          return {
            packets: children.flatMap((child) => child.packets),
            audits: [error.audit, ...children.flatMap((child) => child.audits)],
            batchCount: 1 + children.reduce((total, child) => total + child.batchCount, 0),
          };
        }
        const observerId = batch.observerIds[0];
        const action = input.actions.find((candidate) => candidate.actorId === observerId);
        const outcome = action
          ? input.proposal.outcomes.find((candidate) => candidate.proposalId === action.id)
          : undefined;
        const status = outcome ? {
          succeeded: "行动达成了预期结果",
          partial: "行动只取得部分结果",
          failed: "行动没有成功",
          blocked: "行动受到阻碍",
          continuing: "行动仍在继续",
        }[outcome.status] : "本步骤已经结束";
        const packets = materializeBatch(input, batch.observerIds, [{
          summary: `你能确认：${status}。除此之外，本步骤没有形成其他可确认的观察。`,
          introductions: [],
          apparentClaims: [],
          sourceEventIds: [],
        }], `${batchKey}.fallback`, scope);
        scope.observer?.emit({
          event: "algorithm.observation.repair_fallback",
          level: "warn",
          correlation: { ...scope.correlation, modelSubject: observerId },
          attributes: { phase: "observation", batch: batchKey, policy: "typed-uncertainty-observation" },
          counts: { observationFallbacks: 1 },
          error: { name: error.name, message: error.message },
        });
        return { packets, audits: [error.audit], batchCount: 1 };
      }
    };
    const rendered = await Promise.all(batches.map((batch, index) =>
      renderRecovering(batch, String(index))));
    const packets = rendered.flatMap((entry) => entry.packets);
    const expected = [...input.observerIds].sort();
    const actual = packets.map((packet) => packet.observerId).sort();
    if (expected.length !== actual.length || expected.some((agentId, index) => agentId !== actual[index])) {
      throw new Error("observation rendering did not cover every observer exactly once");
    }
    return {
      packets,
      modelAudits: rendered.flatMap((entry) => entry.audits),
      batchCount: rendered.reduce((total, entry) => total + entry.batchCount, 0),
    };
  }
}
