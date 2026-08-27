import { randomUUID } from "node:crypto";
import path from "node:path";
import { CanonicalCommitter } from "../engine/canonical-committer";
import { EagerReferenceAlgorithm, EAGER_REFERENCE_MANIFEST } from "../engine/eager-reference";
import type {
  ExternalActionInput,
  PolicyBinding,
  WorldAdvanceRequest,
} from "../engine/execution";
import { WorldExecutionAlgorithmRegistry } from "../engine/execution";
import { arrivalDraftSchema } from "../engine/llm-schemas";
import { loadModelCatalog } from "../engine/model-catalog";
import { createModelGateway } from "../engine/model-gateway";
import { contentHash } from "../engine/model-audit";
import { modelInvocationIdentity, type StructuredModelProvider } from "../engine/model-provider";
import {
  NOOP_RUNTIME_OBSERVER,
  type RuntimeCorrelation,
  type RuntimeObserver,
} from "../engine/observability";
import { quantityId } from "../engine/runtime-id";
import { SimulationEngine } from "../engine/simulation";
import {
  toWorldRuntimeContract,
  validateWorldModelProfiles,
  worldModelProfileIds,
  type WorldDefinition,
  type WorldOrigin,
} from "../engine/world-definition";
import type { AgentState, SimulationState } from "../engine/model";
import type { WorldRepository } from "../script/world-repository";
import type {
  AdvanceWorldInput,
  AgentPrivateView,
  ArrivalView,
  ControlTransferInput,
  ControlOptions,
  CreateInstanceInput,
  PublicConversation,
  PublicConversationTurn,
  PublicInstanceDetail,
  PublicInstanceSummary,
  SubmitExternalActionInput,
  WorldRunControlInput,
  WorldStartOptions,
} from "../shared/world-api";
import type {
  ObserverAgentPerspective,
  ObserverAgentSummary,
  WorldObserverDetail,
} from "../shared/world-observer-api";
import { runtimeCodeIdentity } from "./code-identity";
import type { ExecutionLedger, FinishExecutionInput } from "./execution-ledger";
import { LocalDatabase } from "./local-database";
import type { WorldImportResult } from "./world-import";
import {
  buildWorldInspectorAttemptDetail,
  buildWorldInspectorRuntimeEventDetail,
  buildWorldInspectorStepDetail,
  buildWorldInspectorWindow,
  summarizeRuntimeEvent,
} from "./world-inspector";
import {
  WorldInstanceConflictError,
  WorldInstanceNotFoundError,
  type WorldInstanceStore,
} from "./world-instance-store";
import type {
  ActionWindow,
  ParticipantArrivalRecord,
  ParticipantRecord,
  StoredWorldInstance,
  WorldRunRecord,
  WorldInstanceDocument,
} from "./world-instance-types";

interface WorldCatalogManager {
  importWorld(
    buffer: Buffer,
    modelCatalog: StructuredModelProvider["catalog"],
    replace?: boolean,
    expectedWorldId?: string,
  ): WorldImportResult;
  deleteWorld(worldId: string): void;
}

interface AtomicExecutionInstanceStore extends WorldInstanceStore {
  createInstanceAndFinishExecution(
    document: WorldInstanceDocument,
    executionId: string,
    finish: FinishExecutionInput,
    correlation?: RuntimeCorrelation,
  ): { instance: StoredWorldInstance };
  compareAndSwapInstanceAndFinishExecution(
    instanceId: string,
    expectedGeneration: number,
    document: WorldInstanceDocument,
    executionId: string,
    finish: FinishExecutionInput,
    phase?: "step" | "admission" | "instance",
    correlation?: RuntimeCorrelation,
  ): { instance: StoredWorldInstance };
}

function isAtomicStore(store: WorldInstanceStore): store is AtomicExecutionInstanceStore {
  const candidate = store as Partial<AtomicExecutionInstanceStore>;
  return typeof candidate.createInstanceAndFinishExecution === "function" &&
    typeof candidate.compareAndSwapInstanceAndFinishExecution === "function";
}

export interface WorldHostOptions {
  repository: WorldRepository;
  store: WorldInstanceStore;
  provider: StructuredModelProvider;
  catalogManager?: WorldCatalogManager;
  ledger?: ExecutionLedger;
  algorithmRegistry?: WorldExecutionAlgorithmRegistry;
  now?: () => Date;
  idFactory?: () => string;
  observer?: RuntimeObserver;
  maxActiveParticipants?: number;
  runLeaseMaxCommits?: number;
  runLeaseMaxWallTimeMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class WorldHostError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WorldHostError";
  }
}

const ARRIVAL_SYSTEM = `你只根据所给角色私有视角写第一人称入场。
不得推断隐藏真相，不得输出世界状态修改。
三条建议必须可编辑且不得声称已执行。只输出 schema 指定的 JSON。`;

function policyRoster(state: Readonly<SimulationState>): Record<string, PolicyBinding> {
  return Object.fromEntries(Object.values(state.agents).map((agent) => [agent.id, {
    kind: "model" as const,
    agentId: agent.id,
    profiles: structuredClone(agent.modelProfiles),
  }]));
}

function currentRun(document: WorldInstanceDocument): WorldRunRecord | undefined {
  return Object.values(document.runs)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
}

function externalDecisionAgentIds(document: WorldInstanceDocument): string[] {
  const decisionAgents = new Set(document.state.history.at(-1)?.decisionPoints.map((point) => point.agentId) ?? []);
  const busyAgents = new Set(Object.values(document.state.truth.activities)
    .filter((activity) => activity.status === "active" || activity.status === "paused")
    .flatMap((activity) => activity.participantAgentIds));
  return Object.values(document.policyBindings)
    .filter((binding): binding is Extract<PolicyBinding, { kind: "external" }> => binding.kind === "external")
    .map((binding) => binding.agentId)
    .filter((agentId) => !busyAgents.has(agentId) || decisionAgents.has(agentId))
    .sort();
}

function activeParticipants(document: WorldInstanceDocument): ParticipantRecord[] {
  return Object.values(document.participants)
    .filter((participant) => participant.status === "active")
    .sort((left, right) => left.id.localeCompare(right.id));
}

function publicSummary(document: WorldInstanceDocument): PublicInstanceSummary {
  return {
    id: document.id,
    worldId: document.world.id,
    title: document.title,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    revision: document.state.revision,
    step: document.state.step,
    elapsedSeconds: document.state.truth.elapsedSeconds,
    participantCount: activeParticipants(document).length,
    schedulerMode: document.scheduler.mode,
    ...(currentRun(document) ? { runStatus: currentRun(document)!.status } : {}),
  };
}

function publicWorld(document: WorldInstanceDocument) {
  return {
    id: document.world.id,
    name: document.world.name,
    version: document.world.manifestVersion,
    contentHash: document.world.contentHash,
    description: document.world.description,
    participation: document.world.participation ? "open" as const : "headless" as const,
  };
}

function privateView(document: WorldInstanceDocument, agentId: string): AgentPrivateView {
  const agent = document.state.agents[agentId];
  if (!agent) throw new WorldHostError(`Agent not found: ${agentId}`, 404);
  const entity = document.state.truth.entities[agent.entityId];
  const placementId = document.state.truth.placements[agent.entityId];
  return {
    agentId,
    entity: {
      name: entity.name,
      description: entity.description,
      location: placementId ? document.state.truth.entities[placementId]?.name ?? null : null,
    },
    character: structuredClone(agent.character),
    belief: structuredClone(agent.belief),
    observations: document.state.history.flatMap((step) => step.observations
      .filter((packet) => packet.observerId === agentId)
      .map((packet) => ({ step: packet.step, summary: packet.summary }))),
  };
}

function conversationFor(
  document: WorldInstanceDocument,
  participant: ParticipantRecord,
): PublicConversation {
  const arrival = participant.arrival;
  const turns: PublicConversationTurn[] = [{
    id: arrival.id,
    agentId: participant.agentId,
    baseRevision: arrival.revision,
    createdAt: arrival.createdAt,
    status: "committed",
    response: {
      revision: arrival.revision,
      step: arrival.step,
      title: arrival.title,
      text: arrival.scene,
      suggestions: [...arrival.suggestions],
      generated: arrival.generated,
    },
  }];
  for (const intent of document.participantIntents.filter((entry) => entry.participantId === participant.id)) {
    const run = document.runs[intent.runId];
    const committedSteps = (run?.committedRevisions ?? []).flatMap((revision) => {
      const committed = document.state.history.find((step) => step.revision === revision);
      return committed ? [committed] : [];
    });
    const responses = committedSteps.map((committed) => {
      const summaries = committed.observations
        .filter((observation) => observation.observerId === intent.agentId)
        .map((observation) => observation.summary);
      const activity = Object.values(committed.temporalState.activities)
        .filter((candidate) => candidate.actorId === intent.agentId)
        .sort((left, right) => right.updatedAtSeconds - left.updatedAtSeconds || right.id.localeCompare(left.id))[0];
      const publicActivity = activity ? {
        id: activity.id,
        status: activity.status,
        description: activity.plan.description,
        stage: activity.plan.stages[activity.stageIndex]?.name ?? null,
        progress: structuredClone(activity.progress),
        nextBoundaryAtSeconds: activity.nextBoundaryAtSeconds,
        completionAtSeconds: activity.completionAtSeconds,
      } : null;
      const progressText = publicActivity?.progress
        ? `${publicActivity.description}：${publicActivity.progress.current}/${publicActivity.progress.target} ${publicActivity.progress.unit}`
        : publicActivity ? `${publicActivity.description}：${publicActivity.status}` : "世界时间继续推进。";
      return {
        revision: committed.revision,
        step: committed.step,
        text: summaries.length > 0 ? summaries.join("\n\n") : progressText,
        worldTimeSeconds: committed.temporalBoundary.toElapsedSeconds,
        activity: publicActivity,
      };
    });
    const status: PublicConversationTurn["status"] = run?.status === "completed" ||
      run?.status === "awaiting-decision" && run.committedRevisions.length > 0
      ? "committed"
      : run?.status === "failed"
        ? "failed"
        : run?.status === "paused" || run?.status === "budget-paused"
          ? "paused"
        : run?.status === "running" || run?.status === "queued" || run?.status === "pausing"
          ? "running"
          : "awaiting";
    turns.push({
      id: `intent:${intent.submissionId}`,
      agentId: intent.agentId,
      baseRevision: intent.revision,
      createdAt: intent.submittedAt,
      status,
      action: { submissionId: intent.submissionId, text: intent.text },
      ...(responses.length > 0 ? { response: responses.at(-1), responses } : {}),
    });
  }
  return { participantId: participant.id, agentId: participant.agentId, turns };
}

function observerAgent(document: WorldInstanceDocument, agentId: string): ObserverAgentSummary {
  const agent = document.state.agents[agentId];
  const entity = document.state.truth.entities[agent.entityId];
  const placementId = document.state.truth.placements[agent.entityId];
  const binding = document.policyBindings[agentId];
  return {
    id: agentId,
    name: entity.name,
    description: entity.description,
    location: placementId ? document.state.truth.entities[placementId]?.name ?? null : null,
    policy: binding.kind === "external" ? "model" : binding.kind,
  };
}

function observerPerspective(document: WorldInstanceDocument, agentId: string): ObserverAgentPerspective {
  const agent = document.state.agents[agentId];
  if (!agent) throw new WorldHostError(`Agent not found: ${agentId}`, 404);
  const turns = document.state.history.flatMap((step) => {
    const action = step.actions.find((candidate) => candidate.actorId === agentId);
    const observations = step.observations
      .filter((observation) => observation.observerId === agentId)
      .map((observation) => observation.summary);
    if (!action && observations.length === 0) return [];
    return [{
      id: `perspective:${agentId}:${step.revision}`,
      revision: step.revision,
      step: step.step,
      action: action?.rawText ?? null,
      observation: observations.length > 0 ? observations.join("\n\n") : null,
    }];
  });
  return {
    agent: observerAgent(document, agentId),
    character: structuredClone(agent.character),
    belief: structuredClone(agent.belief),
    turns,
  };
}

function agentStateFromOrigin(
  state: Readonly<SimulationState>,
  origin: WorldOrigin,
  agentId: string,
  displayName: string,
  appearance: string,
  motivation: string,
): AgentState {
  const selfId = `${agentId}-self`;
  const locationId = `${agentId}-location`;
  return {
    id: agentId,
    entityId: agentId,
    modelProfiles: structuredClone(origin.modelProfiles),
    character: {
      persona: {
        summary: appearance ? `${origin.persona}\n外观：${appearance}` : origin.persona,
        voice: "",
        updatedAtStep: state.step,
        evidenceIds: [],
      },
      traits: {},
      values: {},
      emotions: {},
      attitudes: {},
      goals: {
        [`${agentId}-motivation`]: {
          id: `${agentId}-motivation`,
          description: motivation || origin.defaultGoal,
          priority: 0.8,
          progress: 0,
          targetIds: [],
          motivatedByIds: [],
          status: "active",
          createdAtStep: state.step,
          updatedAtStep: state.step,
          evidenceIds: [],
        },
      },
      commitments: {},
    },
    belief: {
      localEntities: {
        [selfId]: {
          id: selfId,
          name: displayName,
          description: appearance || origin.persona,
          status: "observed",
        },
        [locationId]: {
          id: locationId,
          name: state.truth.entities[origin.spawnEntityId].name,
          description: state.truth.entities[origin.spawnEntityId].description,
          status: "observed",
        },
      },
      claims: {},
      evidence: {},
    },
    bindings: {
      [selfId]: { localEntityId: selfId, canonicalEntityIds: [agentId] },
      [locationId]: { localEntityId: locationId, canonicalEntityIds: [origin.spawnEntityId] },
    },
    observationCursorStep: state.step,
    nextAction: null,
  };
}

export class WorldHost {
  private static singleton: WorldHost | undefined;
  private readonly registry: WorldExecutionAlgorithmRegistry;
  private readonly committer = new CanonicalCommitter();
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly maxActiveParticipants: number;
  private readonly runLeaseMaxCommits: number;
  private readonly runLeaseMaxWallTimeMs: number;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly runTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly runControllers = new Map<string, AbortController>();
  private readonly setTimer: WorldHostOptions["setTimer"];
  private readonly clearTimer: NonNullable<WorldHostOptions["clearTimer"]>;
  readonly runtimeObserver: RuntimeObserver;

  constructor(private readonly options: WorldHostOptions) {
    if (options.ledger && !isAtomicStore(options.store)) {
      throw new Error("Execution Ledger requires atomic instance/execution persistence");
    }
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.maxActiveParticipants = options.maxActiveParticipants ?? 1;
    this.runLeaseMaxCommits = options.runLeaseMaxCommits ?? 100;
    this.runLeaseMaxWallTimeMs = options.runLeaseMaxWallTimeMs ?? 15 * 60 * 1_000;
    if (!Number.isSafeInteger(this.runLeaseMaxCommits) || this.runLeaseMaxCommits < 1 ||
      !Number.isSafeInteger(this.runLeaseMaxWallTimeMs) || this.runLeaseMaxWallTimeMs < 1) {
      throw new Error("world run lease budgets must be positive integers");
    }
    this.runtimeObserver = options.observer ?? NOOP_RUNTIME_OBSERVER;
    this.registry = options.algorithmRegistry ?? new WorldExecutionAlgorithmRegistry();
    if (!options.algorithmRegistry) {
      this.registry.register(EAGER_REFERENCE_MANIFEST, () =>
        new EagerReferenceAlgorithm(options.provider, options.repository.rulePackages));
    }
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? clearTimeout;
    for (const stored of options.store.listInstances()) this.restoreSchedule(stored);
  }

  static get(): WorldHost {
    if (!this.singleton) {
      const catalog = loadModelCatalog(path.resolve(
        /* turbopackIgnore: true */ process.env.LIVINGWORLD_MODEL_CATALOG_PATH ?? "config/models.yaml",
      ));
      const provider = createModelGateway(catalog, process.env);
      const dataRoot = path.resolve(
        /* turbopackIgnore: true */ process.env.LIVINGWORLD_DATA_ROOT ?? ".livingworld-v15",
      );
      const database = new LocalDatabase(path.join(dataRoot, "livingworld.sqlite"));
      this.singleton = new WorldHost({
        repository: database,
        store: database,
        catalogManager: database,
        provider,
        ledger: database,
      });
    }
    return this.singleton;
  }

  static observer(): RuntimeObserver {
    return this.singleton?.runtimeObserver ?? NOOP_RUNTIME_OBSERVER;
  }

  static setForTests(host: WorldHost | undefined): void {
    this.singleton = host;
  }

  listWorlds() {
    return this.options.repository.list();
  }

  importWorld(buffer: Buffer, replace = false, expectedWorldId?: string): WorldImportResult {
    if (!this.options.catalogManager) throw new WorldHostError("world import is unavailable", 501);
    return this.options.catalogManager.importWorld(buffer, this.options.provider.catalog, replace, expectedWorldId);
  }

  deleteWorld(worldId: string): void {
    if (!this.options.catalogManager) throw new WorldHostError("world management is unavailable", 501);
    this.options.catalogManager.deleteWorld(worldId);
  }

  worldAsset(worldId: string, hash: string): { mime: string; bytes: Buffer } {
    const definition = this.options.repository.load(worldId, 1, this.options.provider.catalog);
    const asset = definition.assetData[hash];
    if (!asset) throw new WorldHostError("world asset not found", 404);
    return { mime: asset.mime, bytes: Buffer.from(asset.bytesBase64, "base64") };
  }

  private definition(document: WorldInstanceDocument): WorldDefinition {
    const seed = document.state.historyBase?.truth.rng.seed ?? document.state.truth.rng.seed;
    const definition = this.options.repository.loadVersion(
      document.world.id,
      document.world.contentHash,
      seed,
      this.options.provider.catalog,
    );
    if (contentHash(toWorldRuntimeContract(definition)) !== contentHash(document.world)) {
      throw new Error("instance world contract does not match its pinned world version");
    }
    validateWorldModelProfiles(definition, this.options.provider.catalog);
    return definition;
  }

  private read(id: string): StoredWorldInstance {
    try {
      const stored = this.options.store.readInstance(id, { instanceId: id });
      this.definition(stored.document);
      return stored;
    } catch (error) {
      if (error instanceof WorldInstanceNotFoundError) throw new WorldHostError(`world instance not found: ${id}`, 404);
      throw error;
    }
  }

  private persist(stored: StoredWorldInstance, document: WorldInstanceDocument): StoredWorldInstance {
    try {
      return this.options.store.compareAndSwapInstance(document.id, stored.generation, document, { instanceId: document.id });
    } catch (error) {
      if (error instanceof WorldInstanceConflictError) throw new WorldHostError("world instance changed concurrently", 409);
      throw error;
    }
  }

  private async serialized<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.locks.set(id, queued);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(id) === queued) this.locks.delete(id);
    }
  }

  private beginExecution(
    document: WorldInstanceDocument,
    kind: "interactive" | "diagnostic" | "benchmark" | "replay",
    trigger: string,
    policyBindings: Readonly<Record<string, PolicyBinding>> = document.policyBindings,
  ) {
    if (!this.options.ledger) return undefined;
    const id = randomUUID();
    const code = runtimeCodeIdentity();
    const bindings = Object.values(policyBindings);
    const trace = this.options.ledger.beginExecution({
      id,
      kind,
      instanceId: document.id,
      step: document.state.step,
      manifest: EAGER_REFERENCE_MANIFEST,
      worldHash: document.state.worldHash,
      codeRevision: code.revision,
      codeDirty: code.dirty,
      modelCatalogHash: this.options.provider.catalog.hash,
      seed: document.state.historyBase?.truth.rng.seed ?? document.state.truth.rng.seed,
      runtimeConfig: {
        trigger,
        realtimeIntervalMs: document.runtime.realtimeIntervalMs,
        actionWindowMs: document.runtime.actionWindowMs,
        policyRosterHash: contentHash(policyBindings),
        participants: activeParticipants(document).length,
        autonomousAgents: bindings.filter((binding) => binding.kind === "model").length,
        externalAgents: bindings.filter((binding) => binding.kind === "external").length,
        idleAgents: bindings.filter((binding) => binding.kind === "idle").length,
      },
    });
    return { id, trace };
  }

  private failExecution(executionId: string | undefined, error: unknown): void {
    if (!executionId || !this.options.ledger || this.options.ledger.execution(executionId)?.status !== "running") return;
    this.options.ledger.finishExecution(executionId, {
      status: error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed",
      error,
    });
  }

  worldStartOptions(worldId: string): WorldStartOptions {
    const definition = this.options.repository.load(worldId, 1, this.options.provider.catalog);
    return {
      world: {
        id: definition.id,
        name: definition.name,
        version: definition.manifestVersion,
        contentHash: definition.contentHash,
        description: definition.description,
        participation: definition.participation ? "open" : "headless",
      },
      origins: (definition.participation?.origins ?? []).map((origin) => ({
        id: origin.id,
        title: origin.title,
        fantasy: origin.fantasy,
        description: origin.description,
        location: definition.initialState.truth.entities[origin.spawnEntityId].name,
        relationshipHooks: [...origin.relationshipHooks],
        risks: [...origin.risks],
        ...(origin.image ? { image: structuredClone(origin.image) } : {}),
      })),
      observerAvailable: true,
    };
  }

  async createInstance(input: CreateInstanceInput, principalId = "local"): Promise<PublicInstanceDetail> {
    const definition = this.options.repository.load(input.worldId, input.seed ?? 1, this.options.provider.catalog);
    this.options.provider.assertProfilesAvailable(worldModelProfileIds(definition));
    const id = this.idFactory();
    const now = this.now().toISOString();
    const initial: WorldInstanceDocument = {
      schemaVersion: 15,
      id,
      world: toWorldRuntimeContract(definition),
      title: input.title?.trim() || definition.name,
      createdAt: now,
      updatedAt: now,
      state: structuredClone(definition.initialState),
      participants: {},
      policyBindings: policyRoster(definition.initialState),
      actionWindow: null,
      runtime: structuredClone(definition.runtimeDefaults),
      scheduler: { mode: "paused", generation: 1, nextTickAt: null },
      runs: {},
      participantIntents: [],
    };
    const execution = this.beginExecution(initial, "interactive", "bootstrap");
    const engine = new SimulationEngine(
      definition,
      this.registry.create(EAGER_REFERENCE_MANIFEST.id, EAGER_REFERENCE_MANIFEST.version),
    );
    try {
      initial.state = await engine.bootstrapAgents({
        workloadId: id,
        batchId: `bootstrap:${id}`,
        correlation: { executionId: execution?.id, instanceId: id, revision: 0, step: 0 },
        observer: execution?.trace ?? this.runtimeObserver,
      });
      initial.policyBindings = policyRoster(initial.state);
      if (input.start.kind === "origin") {
        const start = input.start;
        if (!definition.participation) throw new WorldHostError("this world does not define Origins", 409);
        const origin = definition.participation.origins.find((entry) => entry.id === start.originId);
        if (!origin) throw new WorldHostError("origin not found", 404);
        const displayName = start.displayName.trim();
        const appearance = start.appearance.trim();
        const motivation = start.motivation.trim();
        if (!displayName || displayName.length > 80 || appearance.length > 500 || motivation.length > 500) {
          throw new WorldHostError("participant customization is invalid", 400);
        }
        let ordinal = 1;
        let agentId: string;
        do agentId = `${origin.id}-${ordinal++}`; while (initial.state.agents[agentId]);
        const agent = agentStateFromOrigin(initial.state, origin, agentId, displayName, appearance, motivation);
        const mechanicsProfile = initial.state.truth.mechanics.entityMechanicsProfiles[origin.mechanicsProfileId];
        if (!mechanicsProfile) throw new WorldHostError("origin mechanics profile is unavailable", 500);
        const admitted = this.committer.admit(initial.state, {
          entity: {
            id: agentId,
            kind: origin.entityKind,
            name: displayName,
            description: appearance ? `${origin.description}\n外观：${appearance}` : origin.description,
            lifecycle: "active",
            createdAtStep: initial.state.step,
          },
          placementId: origin.spawnEntityId,
          agent,
          meters: mechanicsProfile.meters.map((entry) => ({
            id: `${agentId}-${entry.definitionId}`,
            definitionId: entry.definitionId,
            entityId: agentId,
            current: entry.current,
            firedThresholdIds: [],
          })),
          quantities: mechanicsProfile.quantities.map((entry) => ({
            id: quantityId(initial.state.worldHash, entry.definitionId, agentId),
            definitionId: entry.definitionId,
            holderId: agentId,
            amount: entry.amount,
          })),
          ratings: mechanicsProfile.ratings.map((entry) => ({
            id: `${agentId}-${entry.definitionId}`,
            definitionId: entry.definitionId,
            entityId: agentId,
            value: entry.value,
          })),
          conditions: [],
        });
        initial.state = admitted.state;
        initial.policyBindings = policyRoster(initial.state);
        const participantId = this.idFactory();
        const joinedAt = this.now().toISOString();
        const fallback: ParticipantArrivalRecord = {
          id: this.idFactory(),
          revision: initial.state.revision,
          step: initial.state.step,
          title: "你已进入世界",
          scene: origin.fallbackArrival,
          suggestions: ["观察四周", "确认自己所在的位置", "寻找一个可以交谈的人"],
          generated: false,
          createdAt: joinedAt,
        };
        initial.participants[participantId] = {
          id: participantId,
          principalId,
          displayName,
          agentId,
          status: "active",
          joinedAt,
          updatedAt: joinedAt,
          controlledSinceRevision: initial.state.revision,
          ...(agent.nextAction ? { suppressedActionId: agent.nextAction.id } : {}),
          arrival: fallback,
        };
        initial.policyBindings[agentId] = { kind: "external", agentId, participantId };
        const arrival = await this.generateArrival(initial, participantId, origin.fallbackArrival);
        initial.participants[participantId].arrival = {
          ...fallback,
          title: arrival.title,
          scene: arrival.scene,
          suggestions: [...arrival.suggestions],
          generated: arrival.generated,
        };
      }
      const finish: FinishExecutionInput = {
        status: "succeeded",
        semanticHash: contentHash(initial.state),
        stateHash: contentHash(initial.state),
        commitRevision: initial.state.revision,
      };
      const stored = execution && this.options.ledger && isAtomicStore(this.options.store)
        ? this.options.store.createInstanceAndFinishExecution(initial, execution.id, finish).instance
        : this.options.store.createInstance(initial);
      if (execution && this.options.ledger && !isAtomicStore(this.options.store)) {
        this.options.ledger.finishExecution(execution.id, finish);
      }
      return this.project(stored.document, principalId);
    } catch (error) {
      this.failExecution(execution?.id, error);
      throw error;
    }
  }

  listInstances(): PublicInstanceSummary[] {
    return this.options.store.listInstances().map(({ document }) => publicSummary(document));
  }

  inspectorWindow(id: string, input: { beforeRevision?: number; limit: number }) {
    const document = this.read(id).document;
    const records = this.options.ledger?.executions({ instanceId: id }) ?? [];
    const events = this.options.ledger?.instanceEvents(id) ?? [];
    return buildWorldInspectorWindow(document, records, events, input);
  }

  inspectorStep(id: string, revision: number) {
    const document = this.read(id).document;
    const detail = buildWorldInspectorStepDetail(
      document,
      revision,
      this.options.ledger?.instanceEvents(id) ?? [],
    );
    if (!detail) throw new WorldHostError(`committed revision not found: ${revision}`, 404);
    return detail;
  }

  inspectorAttempt(id: string, executionId: string) {
    const document = this.read(id).document;
    const record = this.options.ledger?.execution(executionId);
    if (!record || record.instanceId !== id) throw new WorldHostError("execution not found", 404);
    const detail = buildWorldInspectorAttemptDetail(
      executionId,
      record,
      this.options.ledger?.executionEvents(executionId) ?? [],
      Object.keys(document.state.agents),
    );
    if (!detail) throw new WorldHostError("execution not found", 404);
    return detail;
  }

  inspectorRuntimeEvent(id: string, eventId: string) {
    this.read(id);
    const detail = buildWorldInspectorRuntimeEventDetail(
      eventId,
      this.options.ledger?.instanceEvents(id) ?? [],
    );
    if (!detail) throw new WorldHostError("runtime event not found", 404);
    return detail;
  }

  subscribeInspectorEvents(id: string, listener: (event: ReturnType<typeof summarizeRuntimeEvent>) => void): () => void {
    this.read(id);
    return this.options.ledger?.subscribe((event) => {
      if (event.correlation?.instanceId === id) listener(summarizeRuntimeEvent(event));
    }) ?? (() => undefined);
  }

  subscribeInstanceChanges(id: string, listener: () => void): () => void {
    this.read(id);
    return this.options.ledger?.subscribe((event) => {
      if (event.correlation?.instanceId === id) listener();
    }) ?? (() => undefined);
  }

  instance(id: string, principalId = "local"): PublicInstanceDetail {
    return this.project(this.read(id).document, principalId);
  }

  observer(id: string, agentId?: string): WorldObserverDetail {
    const document = this.read(id).document;
    if (activeParticipants(document).length > 0) {
      throw new WorldHostError("detach before opening the observer console", 409);
    }
    const agents = Object.keys(document.state.agents)
      .filter((candidate) => document.state.truth.entities[document.state.agents[candidate].entityId]?.lifecycle === "active")
      .sort((left, right) => {
        const leftName = document.state.truth.entities[document.state.agents[left].entityId].name;
        const rightName = document.state.truth.entities[document.state.agents[right].entityId].name;
        return leftName.localeCompare(rightName) || left.localeCompare(right);
      })
      .map((candidate) => observerAgent(document, candidate));
    const selectedId = agentId ?? agents[0]?.id;
    if (selectedId && !agents.some((agent) => agent.id === selectedId)) {
      throw new WorldHostError(`Agent not found: ${selectedId}`, 404);
    }
    return {
      summary: publicSummary(document),
      world: publicWorld(document),
      agents,
      ...(selectedId ? { selected: observerPerspective(document, selectedId) } : {}),
    };
  }

  controlOptions(id: string): ControlOptions {
    const document = this.read(id).document;
    return {
      agents: Object.keys(document.state.agents)
        .filter((agentId) => {
          const agent = document.state.agents[agentId];
          const entity = document.state.truth.entities[agent.entityId];
          const binding = document.policyBindings[agentId];
          return entity?.lifecycle === "active" && binding?.kind !== "external";
        })
        .map((agentId) => {
          const agent = document.state.agents[agentId];
          const entity = document.state.truth.entities[agent.entityId];
          const placementId = document.state.truth.placements[agent.entityId];
          return {
            id: agentId,
            name: entity.name,
            location: placementId ? document.state.truth.entities[placementId]?.name ?? null : null,
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    };
  }

  renameInstance(id: string, title: string): PublicInstanceDetail {
    const normalized = title.trim();
    if (!normalized || normalized.length > 80) throw new WorldHostError("title must contain 1–80 characters", 400);
    const stored = this.read(id);
    const document = structuredClone(stored.document);
    document.title = normalized;
    document.updatedAt = this.now().toISOString();
    return this.project(this.persist(stored, document).document);
  }

  deleteInstance(id: string): void {
    const stored = this.read(id);
    this.cancelTimer(id);
    this.options.store.deleteInstance(id, stored.generation, { instanceId: id });
  }

  private project(document: WorldInstanceDocument, principalId = "local"): PublicInstanceDetail {
    const definition = this.definition(document);
    const observedBy = new Map<string, Set<string>>();
    for (const step of document.state.history) {
      for (const observation of step.observations) {
        for (const eventId of observation.sourceEventIds) {
          const observers = observedBy.get(eventId) ?? new Set<string>();
          observers.add(observation.observerId);
          observedBy.set(eventId, observers);
        }
      }
    }
    const allAgents = Object.keys(document.state.agents).length;
    const active = activeParticipants(document);
    const controlled = active.find((participant) => participant.principalId === principalId);
    const run = currentRun(document);
    const activity = controlled ? Object.values(document.state.truth.activities)
      .filter((candidate) => candidate.actorId === controlled.agentId)
      .sort((left, right) => right.updatedAtSeconds - left.updatedAtSeconds || right.id.localeCompare(left.id))[0] : undefined;
    return {
      summary: publicSummary(document),
      world: publicWorld(document),
      publicEvents: document.state.truth.events
        .filter((event) => allAgents > 0 && (observedBy.get(event.id)?.size ?? 0) === allAgents)
        .map(({ id, step, description, impact }) => ({ id, step, description, impact })),
      participants: active.map(({ id, displayName, agentId, status, joinedAt }) => ({
        id, displayName, agentId, status, joinedAt,
      })),
      actionWindow: document.actionWindow && document.actionWindow.status !== "committed" &&
        document.actionWindow.status !== "cancelled" ? {
          id: document.actionWindow.id,
          baseRevision: document.actionWindow.baseRevision,
          requiredAgentIds: [...document.actionWindow.requiredAgentIds],
          submittedAgentIds: Object.keys(document.actionWindow.submissions).sort(),
          deadlineAt: document.actionWindow.deadlineAt,
          status: document.actionWindow.status,
        } : null,
      origins: (definition.participation?.origins ?? []).map((origin) => ({
        id: origin.id,
        title: origin.title,
        fantasy: origin.fantasy,
        description: origin.description,
        location: document.state.truth.entities[origin.spawnEntityId].name,
        relationshipHooks: [...origin.relationshipHooks],
        risks: [...origin.risks],
        ...(origin.image ? { image: structuredClone(origin.image) } : {}),
      })),
      ...(run ? {
        run: {
          id: run.id,
          generation: run.generation,
          status: run.status,
          committedRevisions: [...run.committedRevisions],
          stopReason: run.stopReason,
          lease: run.lease ? {
            commitCount: run.lease.commitCount,
            maxCommits: run.lease.maxCommits,
            maxWallTimeMs: run.lease.maxWallTimeMs,
            startedAt: run.lease.startedAt,
          } : null,
          activity: activity ? {
            id: activity.id,
            status: activity.status,
            description: activity.plan.description,
            stage: activity.plan.stages[activity.stageIndex]?.name ?? null,
            progress: structuredClone(activity.progress),
            nextBoundaryAtSeconds: activity.nextBoundaryAtSeconds,
            completionAtSeconds: activity.completionAtSeconds,
          } : null,
        },
      } : {}),
      ...(controlled ? {
        controlledView: privateView(document, controlled.agentId),
        conversation: conversationFor(document, controlled),
      } : {}),
    };
  }

  async advance(id: string, input: AdvanceWorldInput): Promise<PublicInstanceDetail> {
    const started = await this.serialized(id, async () => {
      const stored = this.read(id);
      if (input.expectedRevision !== stored.document.state.revision) {
        throw new WorldHostError("world revision changed; refresh before advancing", 409);
      }
      const document = structuredClone(stored.document);
      const existing = currentRun(document);
      if (existing && ["queued", "running", "pausing", "paused", "budget-paused"].includes(existing.status)) {
        throw new WorldHostError("another world run is already in progress", 409);
      }
      const requiredAgentIds = externalDecisionAgentIds(document);
      const run = this.createRun(document, input.trigger, input.trigger === "batch"
        ? Math.max(1, Math.min(100, input.steps ?? 1))
        : 1, requiredAgentIds.length > 0 ? "awaiting-decision" : "queued");
      if (requiredAgentIds.length > 0) document.actionWindow = this.openWindow(document, requiredAgentIds);
      document.updatedAt = run.updatedAt;
      return this.persist(stored, document).document;
    });
    const run = currentRun(started)!;
    if (run.status === "queued") await this.driveRun(id, run.id);
    const document = this.read(id).document;
    if (document.actionWindow) this.scheduleWindowDeadline(document);
    if (document.scheduler.mode === "realtime") this.scheduleRealtime(document);
    return this.project(document);
  }

  private openWindow(document: WorldInstanceDocument, requiredAgentIds: string[]): ActionWindow {
    const deadlineAt = document.runtime.actionWindowMs > 0
      ? new Date(this.now().getTime() + document.runtime.actionWindowMs).toISOString()
      : null;
    return {
      id: this.idFactory(),
      generation: 1,
      baseRevision: document.state.revision,
      requiredAgentIds,
      submissions: {},
      deadlineAt,
      status: "open",
    };
  }

  private createRun(
    document: WorldInstanceDocument,
    trigger: WorldRunRecord["trigger"],
    requestedBoundaryCount: number | null,
    status: WorldRunRecord["status"],
  ): WorldRunRecord {
    const now = this.now().toISOString();
    const run: WorldRunRecord = {
      id: this.idFactory(),
      generation: 1,
      trigger,
      status,
      rootIntents: [],
      activityIds: [],
      requestedBoundaryCount,
      createdAt: now,
      updatedAt: now,
      executionIds: [],
      committedRevisions: [],
      stopReason: status === "awaiting-decision" ? "external-decision-required" : null,
      lease: null,
    };
    document.runs[run.id] = run;
    return run;
  }

  private scheduleRun(instanceId: string, runId: string): void {
    const existing = this.runTimers.get(runId);
    if (existing) this.clearTimer(existing);
    const timer = this.setTimer!(async () => {
      this.runTimers.delete(runId);
      await this.driveRun(instanceId, runId).catch(() => undefined);
    }, 0);
    this.runTimers.set(runId, timer);
  }

  private async driveRun(instanceId: string, runId: string): Promise<void> {
    while (true) {
      const prepared = await this.serialized(instanceId, async () => {
        const stored = this.read(instanceId);
        const document = structuredClone(stored.document);
        const run = document.runs[runId];
        if (!run || run.status !== "queued") return null;
        if (!run.lease) {
          run.lease = {
            id: this.idFactory(),
            generation: run.generation,
            startedAt: this.now().toISOString(),
            maxCommits: this.runLeaseMaxCommits,
            maxWallTimeMs: this.runLeaseMaxWallTimeMs,
            commitCount: 0,
          };
        }
        run.status = "running";
        run.stopReason = null;
        run.updatedAt = this.now().toISOString();
        if (document.actionWindow?.status === "open") document.actionWindow.status = "resolving";
        document.updatedAt = run.updatedAt;
        return this.persist(stored, document);
      });
      if (!prepared) return;
      const committed = await this.executeRunBoundary(prepared, runId);
      const run = committed.document.runs[runId];
      if (!run || run.status !== "queued") {
        if (committed.document.actionWindow) this.scheduleWindowDeadline(committed.document);
        if (committed.document.scheduler.mode === "realtime") this.scheduleRealtime(committed.document);
        return;
      }
    }
  }

  private async executeRunBoundary(
    stored: StoredWorldInstance,
    runId: string,
  ): Promise<StoredWorldInstance> {
    const document = structuredClone(stored.document);
    const runRecord = document.runs[runId];
    if (!runRecord || runRecord.status !== "running" || !runRecord.lease) {
      throw new WorldHostError("world run is not executable", 409);
    }
    const runGeneration = runRecord.generation;
    const window = document.actionWindow;
    const effectiveRoster = structuredClone(document.policyBindings);
    const externalActions: ExternalActionInput[] = [];
    let timeoutNoops = 0;
    if (window) {
      window.status = "resolving";
      for (const agentId of window.requiredAgentIds) {
        const submission = window.submissions[agentId];
        if (submission) externalActions.push(structuredClone(submission));
        else {
          effectiveRoster[agentId] = { kind: "idle", agentId, reason: "timeout" };
          timeoutNoops += 1;
        }
      }
    }
    const execution = this.beginExecution(document, "interactive", runRecord.trigger, effectiveRoster);
    if (execution) runRecord.executionIds.push(execution.id);
    const definition = this.definition(document);
    const engine = new SimulationEngine(
      definition,
      this.registry.create(EAGER_REFERENCE_MANIFEST.id, EAGER_REFERENCE_MANIFEST.version),
      document.state,
    );
    const request: WorldAdvanceRequest = {
      expectedRevision: document.state.revision,
      trigger: runRecord.trigger,
      externalActions,
    };
    const controller = new AbortController();
    this.runControllers.set(runId, controller);
    try {
      execution?.trace.emit({
        event: "action_window.resolved",
        attributes: { trigger: request.trigger },
        counts: {
          requiredExternalAgents: window?.requiredAgentIds.length ?? 0,
          submittedExternalActions: externalActions.length,
          timeoutNoops,
        },
        measurements: {
          actionWindowWaitMs: window?.deadlineAt
            ? Math.max(0, document.runtime.actionWindowMs - (Date.parse(window.deadlineAt) - this.now().getTime()))
            : 0,
        },
      });
      const result = await engine.step(effectiveRoster, request, {
        workloadId: document.id,
        batchId: `step:${document.state.revision + 1}`,
        correlation: {
          executionId: execution?.id,
          instanceId: document.id,
          revision: document.state.revision,
          step: document.state.step + 1,
        },
        observer: execution?.trace ?? this.runtimeObserver,
        abortSignal: controller.signal,
      });
      this.runControllers.delete(runId);
      document.state = result.state;
      for (const agent of Object.values(document.state.agents)) {
        if (!document.policyBindings[agent.id]) {
          document.policyBindings[agent.id] = {
            kind: "model",
            agentId: agent.id,
            profiles: structuredClone(agent.modelProfiles),
          };
        }
      }
      for (const agentId of Object.keys(document.policyBindings)) {
        if (!document.state.agents[agentId]) delete document.policyBindings[agentId];
      }
      for (const binding of Object.values(document.policyBindings)) {
        if (binding.kind === "model") delete binding.resumeFromRevision;
      }
      runRecord.committedRevisions.push(document.state.revision);
      runRecord.activityIds = [...new Set([
        ...runRecord.activityIds,
        ...result.committed.temporalPlans.flatMap((plan) => Object.values(document.state.truth.activities)
          .filter((activity) => activity.plan.id === plan.id)
          .map((activity) => activity.id)),
      ])].sort();
      runRecord.lease.commitCount += 1;
      runRecord.updatedAt = this.now().toISOString();
      document.actionWindow = null;
      if (document.scheduler.mode === "realtime") {
        document.scheduler.nextTickAt = new Date(
          this.now().getTime() + document.runtime.realtimeIntervalMs,
        ).toISOString();
      }
      const requestedComplete = runRecord.requestedBoundaryCount !== null &&
        runRecord.committedRevisions.length >= runRecord.requestedBoundaryCount;
      const rootComplete = runRecord.activityIds.length > 0 && runRecord.activityIds.every((activityId) => {
        const status = document.state.truth.activities[activityId]?.status;
        return status !== "active" && status !== "paused";
      });
      const requiredAgentIds = externalDecisionAgentIds(document);
      const budgetReached = runRecord.lease.commitCount >= runRecord.lease.maxCommits ||
        this.now().getTime() - Date.parse(runRecord.lease.startedAt) >= runRecord.lease.maxWallTimeMs;
      if (requestedComplete) {
        runRecord.status = "completed";
        runRecord.stopReason = "requested-boundaries-completed";
      } else if (rootComplete && runRecord.trigger === "participant_action") {
        runRecord.status = "completed";
        runRecord.stopReason = "root-activity-completed";
        if (requiredAgentIds.length > 0) {
          const decisionRun = this.createRun(document, "participant_action", null, "awaiting-decision");
          decisionRun.stopReason = "external-decision-required";
          document.actionWindow = this.openWindow(document, requiredAgentIds);
        }
      } else if (requiredAgentIds.length > 0) {
        runRecord.status = "awaiting-decision";
        runRecord.stopReason = "external-decision-required";
        document.actionWindow = this.openWindow(document, requiredAgentIds);
      } else if (budgetReached) {
        runRecord.status = "budget-paused";
        runRecord.stopReason = runRecord.lease.commitCount >= runRecord.lease.maxCommits
          ? "commit-budget-exhausted"
          : "wall-time-budget-exhausted";
      } else {
        runRecord.status = "queued";
        runRecord.stopReason = null;
      }
      document.updatedAt = runRecord.updatedAt;
      const finish: FinishExecutionInput = {
        status: "succeeded",
        semanticHash: result.committed.semanticHash,
        stateHash: contentHash(document.state),
        commitRevision: document.state.revision,
      };
      const latest = this.read(document.id);
      const latestRun = latest.document.runs[runId];
      if (!latestRun || latestRun.generation !== runGeneration || latestRun.status !== "running" ||
        latest.document.state.revision !== request.expectedRevision) {
        const cancelled = new Error("world run generation changed before commit");
        cancelled.name = "AbortError";
        this.failExecution(execution?.id, cancelled);
        return latest;
      }
      const committed = execution && this.options.ledger && isAtomicStore(this.options.store)
        ? this.options.store.compareAndSwapInstanceAndFinishExecution(
            document.id,
            latest.generation,
            document,
            execution.id,
            finish,
          ).instance
        : this.persist(latest, document);
      if (execution && this.options.ledger && !isAtomicStore(this.options.store)) {
        this.options.ledger.finishExecution(execution.id, finish);
      }
      return committed;
    } catch (error) {
      this.runControllers.delete(runId);
      this.failExecution(execution?.id, error);
      const latest = this.read(document.id);
      const failed = structuredClone(latest.document);
      const failedRun = failed.runs[runId];
      if (!failedRun || failedRun.generation !== runGeneration) return latest;
      failedRun.status = error instanceof Error && error.name === "AbortError" ? "paused" : "failed";
      failedRun.stopReason = error instanceof Error && error.name === "AbortError" ? "user-paused" : "execution-failed";
      failedRun.error = error instanceof Error ? error.message : String(error);
      failedRun.updatedAt = this.now().toISOString();
      failed.actionWindow = null;
      failed.updatedAt = failedRun.updatedAt;
      if (failed.scheduler.mode === "realtime") {
        failed.scheduler.nextTickAt = new Date(
          this.now().getTime() + failed.runtime.realtimeIntervalMs,
        ).toISOString();
      }
      try {
        return this.persist(latest, failed);
      } catch {
        throw error;
      }
    }
  }

  async submitAction(
    instanceId: string,
    participantId: string,
    input: SubmitExternalActionInput,
    principalId = "local",
  ): Promise<PublicInstanceDetail> {
    const accepted = await this.serialized(instanceId, async () => {
      const stored = this.read(instanceId);
      const document = structuredClone(stored.document);
      const participant = document.participants[participantId];
      if (!participant || participant.status !== "active" || participant.principalId !== principalId) {
        throw new WorldHostError("active participant not found", 404);
      }
      const submissionId = input.submissionId.trim();
      if (!submissionId || submissionId.length > 128) throw new WorldHostError("invalid action submission identity", 400);
      const text = input.text.trim();
      if (!text || text.length > 4_000) throw new WorldHostError("action must contain 1–4000 characters", 400);
      const existingIntent = document.participantIntents.find((intent) =>
        intent.participantId === participantId && intent.submissionId === submissionId);
      if (existingIntent) {
        if (existingIntent.text !== text || existingIntent.agentId !== participant.agentId) {
          throw new WorldHostError("submission identity was already used for a different action", 409);
        }
        return { document, runId: existingIntent.runId, complete: false };
      }
      if (input.expectedRevision !== document.state.revision) throw new WorldHostError("world revision changed", 409);

      let requiredAgentIds = externalDecisionAgentIds(document);
      const pausedRun = currentRun(document);
      if (pausedRun && (pausedRun.status === "paused" || pausedRun.status === "budget-paused") &&
        document.policyBindings[participant.agentId]?.kind === "external") {
        pausedRun.status = "completed";
        pausedRun.stopReason = "replaced-by-external-action";
        pausedRun.updatedAt = this.now().toISOString();
        document.actionWindow = null;
        requiredAgentIds = [participant.agentId];
        this.createRun(document, "participant_action", null, "awaiting-decision");
      }
      if (!requiredAgentIds.includes(participant.agentId)) {
        throw new WorldHostError("participant does not control an external policy", 409);
      }
      let run = currentRun(document);
      if (!run || run.status !== "awaiting-decision") {
        run = this.createRun(document, "participant_action", null, "awaiting-decision");
      }
      if (run.status !== "awaiting-decision") throw new WorldHostError("another world run is already in progress", 409);
      if (!document.actionWindow) document.actionWindow = this.openWindow(document, requiredAgentIds);
      const window = document.actionWindow;
      if (window.status !== "open" || window.baseRevision !== input.expectedRevision) {
        throw new WorldHostError("the current action window is not accepting actions", 409);
      }
      const existing = window.submissions[participant.agentId];
      if (existing) throw new WorldHostError("this Agent already submitted an action", 409);
      window.submissions[participant.agentId] = {
        submissionId,
        agentId: participant.agentId,
        rawText: text,
        goal: text,
        means: null,
        targetIds: [],
      };
      window.generation += 1;
      document.participantIntents.push({
        participantId,
        agentId: participant.agentId,
        runId: run.id,
        submissionId,
        revision: document.state.revision,
        text,
        submittedAt: this.now().toISOString(),
      });
      const complete = window.requiredAgentIds.every((agentId) => window.submissions[agentId]);
      if (complete) {
        run.rootIntents = window.requiredAgentIds.map((agentId) => structuredClone(window.submissions[agentId]!));
        run.status = "queued";
        run.stopReason = null;
        run.lease = null;
        run.generation += 1;
      }
      run.updatedAt = this.now().toISOString();
      document.updatedAt = run.updatedAt;
      const persisted = this.persist(stored, document).document;
      return { document: persisted, runId: run.id, complete };
    });
    if (accepted.complete) this.scheduleRun(instanceId, accepted.runId);
    else if (accepted.document.actionWindow) this.scheduleWindowDeadline(accepted.document);
    return this.project(accepted.document, principalId);
  }

  async pauseRun(
    instanceId: string,
    input: WorldRunControlInput,
    principalId = "local",
  ): Promise<PublicInstanceDetail> {
    const document = await this.serialized(instanceId, async () => {
      const stored = this.read(instanceId);
      const next = structuredClone(stored.document);
      const run = next.runs[input.runId];
      if (!run || run.generation !== input.generation) throw new WorldHostError("world run changed", 409);
      if (!["queued", "running", "pausing"].includes(run.status)) {
        if (run.status === "paused") return next;
        throw new WorldHostError("world run cannot be paused", 409);
      }
      run.generation += 1;
      run.status = "paused";
      run.stopReason = "user-paused";
      run.lease = null;
      run.updatedAt = this.now().toISOString();
      next.updatedAt = run.updatedAt;
      return this.persist(stored, next).document;
    });
    const timer = this.runTimers.get(input.runId);
    if (timer) this.clearTimer(timer);
    this.runTimers.delete(input.runId);
    this.runControllers.get(input.runId)?.abort("user-paused");
    return this.project(document, principalId);
  }

  async resumeRun(
    instanceId: string,
    input: WorldRunControlInput,
    principalId = "local",
  ): Promise<PublicInstanceDetail> {
    const document = await this.serialized(instanceId, async () => {
      const stored = this.read(instanceId);
      const next = structuredClone(stored.document);
      const run = next.runs[input.runId];
      if (!run || run.generation !== input.generation) throw new WorldHostError("world run changed", 409);
      if (run.status !== "paused" && run.status !== "budget-paused") {
        throw new WorldHostError("world run cannot be resumed", 409);
      }
      run.generation += 1;
      run.status = "queued";
      run.stopReason = null;
      run.lease = null;
      delete run.error;
      run.updatedAt = this.now().toISOString();
      next.updatedAt = run.updatedAt;
      return this.persist(stored, next).document;
    });
    this.scheduleRun(instanceId, input.runId);
    return this.project(document, principalId);
  }

  async transferControl(
    instanceId: string,
    input: ControlTransferInput,
    principalId = "local",
  ): Promise<PublicInstanceDetail> {
    return this.serialized(instanceId, async () => {
      const stored = this.read(instanceId);
      const document = structuredClone(stored.document);
      if (input.expectedRevision !== document.state.revision) {
        throw new WorldHostError("world revision changed", 409);
      }
      const activeRun = currentRun(document);
      if (["queued", "running", "pausing"].includes(activeRun?.status ?? "") ||
        (document.actionWindow && document.actionWindow.status !== "open")) {
        throw new WorldHostError("control can change only at a committed revision boundary", 409);
      }
      const current = activeParticipants(document)
        .find((participant) => participant.principalId === principalId);
      if (input.target.kind === "agent" && current?.agentId === input.target.agentId) {
        return this.project(document, principalId);
      }
      const reconcileActionWindow = (): string | null => {
        const window = document.actionWindow;
        if (!window) return null;
        const requiredAgentIds = externalDecisionAgentIds(document);
        if (requiredAgentIds.length === 0) {
          document.actionWindow = null;
          if (activeRun?.status === "awaiting-decision") {
            activeRun.status = "completed";
            activeRun.stopReason = "control-transferred";
            activeRun.updatedAt = this.now().toISOString();
          }
          return null;
        }
        window.requiredAgentIds = requiredAgentIds;
        window.submissions = Object.fromEntries(Object.entries(window.submissions)
          .filter(([agentId]) => requiredAgentIds.includes(agentId)));
        window.generation += 1;
        const complete = requiredAgentIds.every((agentId) => window.submissions[agentId]);
        if (!complete || activeRun?.status !== "awaiting-decision") return null;
        window.status = "resolving";
        activeRun.rootIntents = requiredAgentIds.map((agentId) => structuredClone(window.submissions[agentId]!));
        activeRun.status = "queued";
        activeRun.stopReason = null;
        activeRun.lease = null;
        activeRun.generation += 1;
        activeRun.updatedAt = this.now().toISOString();
        return activeRun.id;
      };
      if (current) {
        current.status = "released";
        current.updatedAt = this.now().toISOString();
        const releasedAgent = document.state.agents[current.agentId];
        document.policyBindings[current.agentId] = {
          kind: "model",
          agentId: releasedAgent.id,
          profiles: structuredClone(releasedAgent.modelProfiles),
          resumeFromRevision: current.controlledSinceRevision,
        };
      }
      if (input.target.kind === "observer") {
        const runToSchedule = reconcileActionWindow();
        document.updatedAt = this.now().toISOString();
        const persisted = this.persist(stored, document).document;
        if (runToSchedule) this.scheduleRun(instanceId, runToSchedule);
        return this.project(persisted, principalId);
      }
      const agentId = input.target.agentId;
      const agent = document.state.agents[agentId];
      const entity = agent ? document.state.truth.entities[agent.entityId] : undefined;
      if (!agent || !entity || entity.lifecycle !== "active") {
        throw new WorldHostError("only a living Agent can be controlled", 409);
      }
      const binding = document.policyBindings[agentId];
      if (binding.kind === "external") throw new WorldHostError("Agent is already controlled", 409);
      if (activeParticipants(document).length - (current ? 1 : 0) >= this.maxActiveParticipants) {
        throw new WorldHostError("this instance has reached its active participant limit", 409);
      }
      const participantId = this.idFactory();
      const joinedAt = this.now().toISOString();
      const fallbackText = `你把注意力放回 ${entity.name} 的此刻。`;
      const fallback: ParticipantArrivalRecord = {
        id: this.idFactory(),
        revision: document.state.revision,
        step: document.state.step,
        title: `此刻，你是${entity.name}`,
        scene: fallbackText,
        suggestions: ["观察四周", "回想刚才发生的事", "确认自己接下来要做什么"],
        generated: false,
        createdAt: joinedAt,
      };
      document.participants[participantId] = {
        id: participantId,
        principalId,
        displayName: entity.name,
        agentId,
        status: "active",
        joinedAt,
        updatedAt: joinedAt,
        controlledSinceRevision: document.state.revision,
        ...(agent.nextAction ? { suppressedActionId: agent.nextAction.id } : {}),
        arrival: fallback,
      };
      document.policyBindings[agentId] = { kind: "external", agentId, participantId };
      const runToSchedule = reconcileActionWindow();
      document.scheduler.mode = "paused";
      document.scheduler.generation += 1;
      document.scheduler.nextTickAt = null;
      this.cancelTimer(instanceId);
      const arrival = await this.generateArrival(document, participantId, fallbackText);
      document.participants[participantId].arrival = {
        ...fallback,
        title: arrival.title,
        scene: arrival.scene,
        suggestions: [...arrival.suggestions],
        generated: arrival.generated,
      };
      document.updatedAt = this.now().toISOString();
      const persisted = this.persist(stored, document).document;
      if (runToSchedule) this.scheduleRun(instanceId, runToSchedule);
      return this.project(persisted, principalId);
    });
  }

  private async generateArrival(
    document: WorldInstanceDocument,
    participantId: string,
    fallback: string,
  ): Promise<ArrivalView> {
    const participant = document.participants[participantId];
    const definition = this.definition(document);
    const execution = this.beginExecution(document, "interactive", "arrival");
    try {
      const scope = {
        workloadId: document.id,
        batchId: `arrival:${participantId}`,
        correlation: { executionId: execution?.id, instanceId: document.id, revision: document.state.revision },
        observer: execution?.trace ?? this.runtimeObserver,
        runtimeIdentity: { worldHash: document.state.worldHash, revision: document.state.revision },
      };
      const identity = modelInvocationIdentity(scope, "arrival-generator", participant.agentId, 1);
      const result = await this.options.provider.generateStructured({
        ...scope,
        ...identity,
        profileId: definition.modelProfiles.arrival,
        role: "arrival-generator",
        subjectId: participant.agentId,
        promptVersion: "arrival-v1",
        schemaName: "arrival",
        system: ARRIVAL_SYSTEM,
        context: privateView(document, participant.agentId),
        schema: arrivalDraftSchema,
      });
      execution?.trace.emit({ event: "arrival.generated", attributes: { status: "accepted" }, payload: result.value });
      if (execution && this.options.ledger) {
        this.options.ledger.finishExecution(execution.id, {
          status: "succeeded",
          semanticHash: contentHash(result.value),
          stateHash: contentHash(document.state),
          commitRevision: document.state.revision,
        });
      }
      return { ...result.value, generated: true };
    } catch (error) {
      this.failExecution(execution?.id, error);
      return {
        title: "你已进入世界",
        scene: fallback,
        suggestions: ["观察四周", "确认自己所在的位置", "寻找一个可以交谈的人"],
        generated: false,
      };
    }
  }

  async setRealtime(instanceId: string, enabled: boolean): Promise<PublicInstanceDetail> {
    return this.serialized(instanceId, async () => {
      const stored = this.read(instanceId);
      const document = structuredClone(stored.document);
      document.scheduler.mode = enabled ? "realtime" : "paused";
      document.scheduler.generation += 1;
      document.scheduler.nextTickAt = enabled
        ? new Date(this.now().getTime() + document.runtime.realtimeIntervalMs).toISOString()
        : null;
      document.updatedAt = this.now().toISOString();
      const committed = this.persist(stored, document);
      if (enabled) this.scheduleRealtime(committed.document);
      else this.cancelTimer(instanceId);
      return this.project(committed.document);
    });
  }

  private cancelTimer(instanceId: string): void {
    const timer = this.timers.get(instanceId);
    if (timer) this.clearTimer(timer);
    this.timers.delete(instanceId);
  }

  private scheduleAt(instanceId: string, at: string, task: () => Promise<void>): void {
    this.cancelTimer(instanceId);
    const delay = Math.max(0, Date.parse(at) - this.now().getTime());
    const timer = this.setTimer!(async () => {
      this.timers.delete(instanceId);
      await task().catch(() => undefined);
    }, delay);
    this.timers.set(instanceId, timer);
  }

  private scheduleWindowDeadline(document: WorldInstanceDocument): void {
    if (!document.actionWindow?.deadlineAt) return;
    this.scheduleAt(document.id, document.actionWindow.deadlineAt, async () => {
      const runId = await this.serialized(document.id, async () => {
        const stored = this.read(document.id);
        const next = structuredClone(stored.document);
        const window = next.actionWindow;
        if (!window || window.id !== document.actionWindow!.id || window.status !== "open") return;
        const run = currentRun(next);
        if (!run || run.status !== "awaiting-decision") return;
        run.rootIntents = window.requiredAgentIds.flatMap((agentId) =>
          window.submissions[agentId] ? [structuredClone(window.submissions[agentId]!)] : []);
        run.status = "queued";
        run.stopReason = null;
        run.lease = null;
        run.generation += 1;
        run.updatedAt = this.now().toISOString();
        next.updatedAt = run.updatedAt;
        this.persist(stored, next);
        return run.id;
      });
      if (runId) this.scheduleRun(document.id, runId);
    });
  }

  private scheduleRealtime(document: WorldInstanceDocument): void {
    if (document.scheduler.mode !== "realtime") return;
    const generation = document.scheduler.generation;
    const at = document.scheduler.nextTickAt ??
      new Date(this.now().getTime() + document.runtime.realtimeIntervalMs).toISOString();
    this.scheduleAt(document.id, at, async () => {
      const current = this.read(document.id).document;
      if (current.scheduler.mode !== "realtime" || current.scheduler.generation !== generation) return;
      await this.advance(document.id, {
        expectedRevision: current.state.revision,
        trigger: "realtime",
        steps: 1,
      });
    });
  }

  private restoreSchedule(stored: StoredWorldInstance): void {
    let current = stored;
    const recovered = structuredClone(stored.document);
    let changed = false;
    for (const run of Object.values(recovered.runs)) {
      if (!["queued", "running", "pausing"].includes(run.status)) continue;
      run.generation += 1;
      run.status = "paused";
      run.stopReason = "process-recovered";
      run.lease = null;
      run.updatedAt = this.now().toISOString();
      recovered.updatedAt = run.updatedAt;
      changed = true;
    }
    if (changed) current = this.persist(stored, recovered);
    const document = current.document;
    if (document.actionWindow?.status === "open" && document.actionWindow.deadlineAt) {
      this.scheduleWindowDeadline(document);
    } else if (document.scheduler.mode === "realtime") {
      const restored = structuredClone(document);
      restored.scheduler.generation += 1;
      restored.scheduler.nextTickAt = new Date(this.now().getTime() + restored.runtime.realtimeIntervalMs).toISOString();
      restored.updatedAt = this.now().toISOString();
      this.scheduleRealtime(this.persist(current, restored).document);
    }
  }
}
