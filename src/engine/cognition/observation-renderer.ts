import { observationRenderSchema, type ModelObservationRenderDraft } from "../contracts/llm-schemas";
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
  ContextLimitExceededError,
  modelInvocationCorrelation,
  modelInvocationIdentity,
  setModelInvocationOutcome,
  setModelInvocationResultKind,
  type ModelExecutionScope,
  type StructuredModelProvider,
} from "../models/model-provider";
import { validatePublicInformationBoundary } from "./information-boundary";
import { validateObservations } from "./observation";
import {
  MODEL_CONTEXT_CONTRACT_VERSION,
  createTruthReferenceResolver,
} from "../contracts/prompts";
import { createAgentReferenceResolver, isProposalReference, type ModelReference } from "../contracts/model-context";
import { contentHash } from "../models/model-audit";
import { promptBundle, structuredPromptBytes } from "../prompts";
import { materializeObservationPackets } from "../mechanics/truth-engine";
import { applyTransitionProposal } from "../runtime/transaction";
import type { WorldDefinition } from "../runtime/world-definition";
import type { TemporalStateSnapshot } from "../mechanics/temporal";
import {
  runSemanticRepairLoop,
  semanticIssue,
  SemanticRepairExhaustedError,
  type SemanticRepairIssueClass,
} from "../models/semantic-repair";

const OBSERVATION_PROMPT = promptBundle("observation-renderer");

interface RenderInput {
  definition: WorldDefinition;
  state: SimulationState;
  proposal: TransitionProposal;
  actions: readonly AgentActionProposal[];
  observerIds: readonly string[];
  identityOwner: string;
  temporalState?: Readonly<TemporalStateSnapshot>;
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
    promptVersion: OBSERVATION_PROMPT.version,
    world: {
      id: input.definition.id,
      description: input.definition.description,
      laws: input.definition.laws,
      rulePackages: input.definition.rulePackages,
      randomDistributions: input.definition.randomDistributions,
      disclosure: input.definition.disclosure,
    },
    baseRevision: input.state.revision,
    nextStep: candidate.step,
    referenceCatalog: createTruthReferenceResolver({
      state: input.state,
      definition: input.definition,
      actions: input.actions,
      events: input.proposal.events,
      contextState: candidate,
      contextActions: input.actions,
    }).catalog,
    // The renderer is a trusted server-side adjudication boundary.  It needs
    // the complete candidate truth to distinguish observable effects from
    // hidden state; the observer slot below remains the only cognition and
    // authorization view exposed for rendering.
    candidateTruth: structuredClone(candidate.truth),
    semanticHistory: input.state.history.map((step) => structuredClone(step)),
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

function materializeModelObservationDraft(
  input: RenderInput,
  observerId: string,
  draft: ModelObservationRenderDraft,
): ObservationRenderDraft {
  const candidate = applyTransitionProposal(input.state, input.proposal, input.temporalState);
  const observer = candidate.agents[observerId];
  if (!observer) throw new Error(`observation slot references unknown Agent ${observerId}`);
  const truthResolver = createTruthReferenceResolver({
    state: input.state,
    definition: input.definition,
    actions: input.actions,
    events: input.proposal.events,
    contextState: candidate,
    contextActions: input.actions,
  });
  const privateResolver = createAgentReferenceResolver(observer, []);
  const proposals = new Map<string, string>();
  const proposalId = (namespace: string, key: string): string => {
    if (proposals.has(key)) throw new Error(`duplicate observation proposalKey ${key}`);
    const id = `observation-${namespace}-${contentHash({ observerId, step: candidate.step, namespace, key }).slice(0, 32)}`;
    proposals.set(key, id);
    return id;
  };
  const resolveLocal = (reference: ModelReference): string => {
    if (isProposalReference(reference)) {
      const id = proposals.get(reference.proposalKey);
      if (!id) throw new Error(`observation references undeclared proposalKey ${reference.proposalKey}`);
      return id;
    }
    const resolved = privateResolver.resolve(reference, "target");
    if (resolved.kind !== "local_entity") throw new Error(`observation reference ${reference} is ${resolved.kind}, expected local_entity`);
    return resolved.engineId;
  };
  const resolveCanonical = (reference: ModelReference | null): string | null => {
    if (reference === null) return null;
    if (isProposalReference(reference)) throw new Error("observation canonicalEntityRef cannot point to a proposal");
    const resolved = truthResolver.resolve(reference, "target");
    if (resolved.kind !== "entity") throw new Error(`observation canonicalEntityRef must reference an entity, got ${resolved.kind}`);
    return resolved.engineId;
  };
  const introductions = draft.introductions.map((introduction) => ({
    localEntity: {
      id: proposalId("local", introduction.localEntity.proposalKey),
      name: introduction.localEntity.name,
      description: introduction.localEntity.description,
      status: introduction.localEntity.status,
    },
    canonicalEntityId: resolveCanonical(introduction.canonicalEntityRef),
  }));
  const apparentClaims = draft.apparentClaims.map((claim) => ({
    subjectId: resolveLocal(claim.subjectRef),
    predicate: claim.predicate,
    value: claim.value.kind === "local_entity"
      ? { kind: "local_entity" as const, localEntityId: resolveLocal(claim.value.entityRef) }
      : structuredClone(claim.value),
    description: claim.description,
  }));
  const sourceEventIds = draft.sourceEventRefs.map((reference) => {
    if (isProposalReference(reference)) throw new Error("observation sourceEventRefs cannot point to a proposal");
    const resolved = truthResolver.resolve(reference, "source");
    if (resolved.kind !== "event") throw new Error(`observation sourceEventRefs must reference events, got ${resolved.kind}`);
    return resolved.engineId;
  });
  return { summary: draft.summary, introductions, apparentClaims, sourceEventIds };
}

function requestBytes(context: unknown): number {
  return structuredPromptBytes({
    system: OBSERVATION_PROMPT.system,
    userPrompt: OBSERVATION_PROMPT.userPrompt,
    context,
    schema: observationRenderSchema,
  }).requestUtf8Bytes;
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
    // Models occasionally emit a fresh alias for a canonical Entity that the
    // observer already knows under another local name.  Treat that as a
    // reference normalization (and rewrite claims) instead of allowing an
    // impossible re-introduction to reach the causal verifier.
    const canonicalToLocal = new Map<string, string>();
    for (const binding of Object.values(agent.bindings)) {
      for (const canonicalId of binding.canonicalEntityIds) {
        const existing = canonicalToLocal.get(canonicalId);
        if (!existing || binding.localEntityId.localeCompare(existing) < 0) {
          canonicalToLocal.set(canonicalId, binding.localEntityId);
        }
      }
    }
    const remappedLocalIds = new Map<string, string>();
    const introductions = draft.introductions.flatMap((introduction) => {
      const localId = introduction.localEntity.id;
      const knownLocalId = introduction.canonicalEntityId
        ? canonicalToLocal.get(introduction.canonicalEntityId)
        : undefined;
      if (knownLocalId && knownLocalId !== localId) {
        droppedIntroductions += 1;
        remappedLocalIds.set(localId, knownLocalId);
        return [];
      }
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
    const remap = (localId: string): string => remappedLocalIds.get(localId) ?? localId;
    const apparentClaims = draft.apparentClaims.map((claim) => ({
      ...structuredClone(claim),
      subjectId: remap(claim.subjectId),
      value: claim.value.kind === "local_entity"
        ? { ...structuredClone(claim.value), localEntityId: remap(claim.value.localEntityId) }
        : structuredClone(claim.value),
    })).filter((claim) => {
      const validSubject = localIds.has(claim.subjectId);
      const validValue = claim.value.kind !== "local_entity" || localIds.has(claim.value.localEntityId);
      if (validSubject && validValue) return true;
      droppedClaims += 1;
      return false;
    });
    return { ...structuredClone(draft), introductions, apparentClaims };
  });
  return { drafts: normalized, droppedClaims, droppedIntroductions, clearedCanonicalBindings };
}

function materializeObserver(
  input: RenderInput,
  observerId: string,
  draft: ModelObservationRenderDraft,
  slotKey: string,
  scope: ModelExecutionScope,
): ObservationPacket {
  const internalDraft = materializeModelObservationDraft(input, observerId, draft);
  const eventIds = new Set(input.proposal.events.map((event) => event.id));
  const eventNormalized = normalizeObservationSourceEventIds([internalDraft], eventIds);
  const candidate = applyTransitionProposal(input.state, input.proposal, input.temporalState);
  const localNormalized = normalizeObservationLocalReferences(
    candidate,
    [observerId],
    eventNormalized.drafts,
  );
  const normalizedCount = eventNormalized.droppedReferences + localNormalized.droppedClaims +
    localNormalized.droppedIntroductions + localNormalized.clearedCanonicalBindings;
  if (normalizedCount > 0) {
    scope.observer?.emit({
      event: "algorithm.observation.references_normalized",
      level: "warn",
      correlation: { ...scope.correlation, modelSubject: observerId },
      attributes: { phase: "observation", batch: scope.batchId },
      counts: {
        droppedObservationEventReferences: eventNormalized.droppedReferences,
        droppedObservationClaims: localNormalized.droppedClaims,
        droppedObservationIntroductions: localNormalized.droppedIntroductions,
        clearedObservationCanonicalBindings: localNormalized.clearedCanonicalBindings,
      },
    });
  }
  const packet: ObservationPacketDraft = {
    id: `observation-slot-${slotKey}`,
    ...structuredClone(localNormalized.drafts[0]!),
    // Slot ownership is assigned by the engine; a model must not be able to
    // move an observation to another Agent by echoing observerId.
    observerId,
  };
  const materialized = materializeObservationPackets(input.state, [packet], "outcome").packets;
  validateObservations(candidate, materialized, candidate.step);
  // Validate against the post-proposal candidate so observations can be
  // addressed to Agents created by this same transition. The candidate still
  // contains the full canonical/private state, so hidden cognition remains
  // protected while dynamic lifecycle introductions become observable.
  validatePublicInformationBoundary(candidate, input.actions, {
    ...structuredClone(input.proposal),
    observations: materialized,
  });
  return materialized[0]!;
}

function observationIssueClass(error: unknown): SemanticRepairIssueClass {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("protected") || message.includes("private") || message.includes("canonical identity")) {
    return "privacy";
  }
  if (message.includes("unknown") || message.includes("reference")) return "reference";
  return "structure";
}

async function renderObserver(
  provider: StructuredModelProvider,
  input: RenderInput,
  observerId: string,
  slot: number,
  scope: ModelExecutionScope,
): Promise<{ packet: ObservationPacket; audit: ModelExecutionAudit; calls: number }> {
  const owner = `${input.identityOwner}:observer-${observerId}`;
  const profile = provider.catalog.profile(input.definition.modelProfiles.observation);
  try {
    const rendered = await runSemanticRepairLoop({
      role: "observation-renderer",
      repairScope: "observer",
      targetIds: [observerId],
      maxRepairs: 2,
      invoke: async (repair) => {
        const issues = repair.issues.map((issue) =>
          `${issue.code}${issue.path.length > 0 ? ` at ${issue.path.join(".")}` : ""}: ${issue.message}`);
        const context = observationContext(input, [observerId], issues);
        const bytes = requestBytes(context);
        if (bytes > profile.max_input_bytes) {
          throw new ContextLimitExceededError(
            `observation context for ${observerId} uses ${bytes} bytes and exceeds ` +
            `profile max_input_bytes ${profile.max_input_bytes}`,
          );
        }
        const identity = modelInvocationIdentity(scope, "observation-renderer", owner, repair.attempt + 1);
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
          promptVersion: OBSERVATION_PROMPT.version,
          schemaName: "observation_render",
          system: OBSERVATION_PROMPT.system,
          userPrompt: OBSERVATION_PROMPT.userPrompt,
          context,
          schema: observationRenderSchema,
        });
        setModelInvocationResultKind(generated.audit, "observation-renderer_observer");
        return generated;
      },
      validate: (draft) => {
        materializeObserver(input, observerId, draft, `${slot}`, scope);
      },
      classify: (error) => [semanticIssue(
        "invalid_observation",
        error instanceof Error ? error.message : String(error),
        { class: observationIssueClass(error), path: [], targetIds: [observerId] },
      )],
      onRejected: ({ context: repair, issues, audit, error }) => {
        const identity = modelInvocationIdentity(scope, "observation-renderer", owner, repair.attempt + 1);
        scope.observer?.emit({
          event: "model.semantic.rejected",
          level: "warn",
          correlation: modelInvocationCorrelation(scope, "observation-renderer", owner, identity),
          attributes: { resultKind: "observation-renderer_observer", observerId },
          counts: { validationIssues: issues.length },
          hashes: audit?.invocations.at(-1)?.responseHash
            ? { response: audit.invocations.at(-1)!.responseHash! }
            : undefined,
          error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) },
        });
      },
    });
    setModelInvocationOutcome(rendered.audit, "accepted");
    return {
      packet: materializeObserver(input, observerId, rendered.value, `${slot}`, scope),
      audit: rendered.audit,
      calls: rendered.attempts,
    };
  } catch (error) {
    if (!(error instanceof SemanticRepairExhaustedError) || !error.audit) throw error;
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
    const packet = materializeObserver(input, observerId, {
      summary: `你能确认：${status}。除此之外，本步骤没有形成其他可确认的观察。`,
      introductions: [],
      apparentClaims: [],
      sourceEventRefs: [],
    }, `${slot}.fallback`, scope);
    scope.observer?.emit({
      event: "algorithm.observation.repair_fallback",
      level: "warn",
      correlation: { ...scope.correlation, modelSubject: observerId },
      attributes: { phase: "observation", batch: scope.batchId, policy: "typed-uncertainty-observation" },
      counts: { observationFallbacks: 1 },
      error: { name: error.name, message: error.message },
    });
    return { packet, audit: error.audit, calls: error.audit.invocations.length };
  }
}

export class ObservationRenderer {
  constructor(private readonly provider: StructuredModelProvider) {}

  async render(input: RenderInput, scope: ModelExecutionScope): Promise<{
    packets: ObservationPacket[];
    modelAudits: ModelExecutionAudit[];
    batchCount: number;
  }> {
    if (new Set(input.observerIds).size !== input.observerIds.length) {
      throw new Error("observation rendering requires unique observer ids");
    }
    const rendered = await Promise.all(input.observerIds.map((observerId, slot) =>
      renderObserver(this.provider, input, observerId, slot, scope)));
    const packets = rendered.map((entry) => entry.packet);
    const expected = [...input.observerIds].sort();
    const actual = packets.map((packet) => packet.observerId).sort();
    if (expected.length !== actual.length || expected.some((agentId, index) => agentId !== actual[index])) {
      throw new Error("observation rendering did not cover every observer exactly once");
    }
    return {
      packets,
      modelAudits: rendered.map((entry) => entry.audit),
      // A TruthBatchCoordinator shares one physical audit across all slots.
      // Count invocation identities rather than logical observer slots.
      batchCount: new Set(rendered.flatMap((entry) => entry.audit.invocations.map((invocation) => invocation.id))).size,
    };
  }
}
