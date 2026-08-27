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
import { validateSimulationState } from "../engine/transaction";
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
  CreateParticipantInput,
  PublicInstanceDetail,
  PublicInstanceSummary,
  ReleaseParticipantInput,
  SubmitExternalActionInput,
} from "../shared/world-api";
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
  ParticipantRecord,
  StoredWorldInstance,
  WorldAdvanceRecord,
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

function currentAdvance(document: WorldInstanceDocument): WorldAdvanceRecord | undefined {
  return Object.values(document.advances)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
}

function activeParticipants(document: WorldInstanceDocument): ParticipantRecord[] {
  return Object.values(document.participants)
    .filter((participant) => participant.status === "active")
    .sort((left, right) => left.id.localeCompare(right.id));
}

function claimableAgentIds(document: WorldInstanceDocument, definition: WorldDefinition): string[] {
  return [...new Set([
    ...(definition.participation?.claimableAgentIds ?? []),
    ...Object.values(document.participants)
      .filter((participant) => participant.status === "released")
      .map((participant) => participant.agentId),
  ])].filter((agentId) => document.state.agents[agentId]).sort();
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
    ...(currentAdvance(document) ? { advanceStatus: currentAdvance(document)!.status } : {}),
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
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
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
        /* turbopackIgnore: true */ process.env.LIVINGWORLD_DATA_ROOT ?? ".livingworld-v12",
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
        simulatedSeconds: document.runtime.simulatedSeconds,
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

  async createInstance(input: { worldId: string; seed?: number; title?: string }): Promise<PublicInstanceDetail> {
    const definition = this.options.repository.load(input.worldId, input.seed ?? 1, this.options.provider.catalog);
    this.options.provider.assertProfilesAvailable(worldModelProfileIds(definition));
    const id = this.idFactory();
    const now = this.now().toISOString();
    const initial: WorldInstanceDocument = {
      schemaVersion: 12,
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
      advances: {},
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
      return this.project(stored.document);
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

  instance(id: string, principalId = "local"): PublicInstanceDetail {
    return this.project(this.read(id).document, principalId);
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
    const claimed = new Set(active.map((participant) => participant.agentId));
    return {
      summary: publicSummary(document),
      world: {
        id: document.world.id,
        name: document.world.name,
        version: document.world.manifestVersion,
        contentHash: document.world.contentHash,
        description: document.world.description,
        participation: document.world.participation ? "open" : "headless",
      },
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
      claimableAgents: claimableAgentIds(document, definition)
        .map((agentId) => {
          const agent = document.state.agents[agentId];
          const entity = document.state.truth.entities[agent.entityId];
          const placement = document.state.truth.placements[entity.id];
          return {
            id: agentId,
            name: entity.name,
            description: entity.description,
            location: placement ? document.state.truth.entities[placement]?.name ?? null : null,
            claimable: !claimed.has(agentId),
          };
        }),
      ...(controlled ? { controlledView: privateView(document, controlled.agentId) } : {}),
    };
  }

  async advance(id: string, input: AdvanceWorldInput): Promise<PublicInstanceDetail> {
    return this.serialized(id, async () => this.advanceLocked(id, input));
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

  private async advanceLocked(id: string, input: AdvanceWorldInput): Promise<PublicInstanceDetail> {
    let stored = this.read(id);
    if (input.expectedRevision !== stored.document.state.revision) {
      throw new WorldHostError("world revision changed; refresh before advancing", 409);
    }
    const steps = input.trigger === "batch" ? Math.max(1, Math.min(100, input.steps ?? 1)) : 1;
    for (let index = 0; index < steps; index += 1) {
      const document = structuredClone(stored.document);
      const externalIds = Object.values(document.policyBindings)
        .filter((binding): binding is Extract<PolicyBinding, { kind: "external" }> => binding.kind === "external")
        .map((binding) => binding.agentId)
        .sort();
      let advance = currentAdvance(document);
      if (!advance || !["awaiting_actions", "queued", "running"].includes(advance.status)) {
        const now = this.now().toISOString();
        advance = {
          id: this.idFactory(),
          request: {
            expectedRevision: document.state.revision,
            trigger: input.trigger,
            simulatedSeconds: input.simulatedSeconds ?? document.runtime.simulatedSeconds,
            externalActions: [],
          },
          status: externalIds.length > 0 ? "awaiting_actions" : "queued",
          createdAt: now,
          updatedAt: now,
          executionIds: [],
          committedRevisions: [],
        };
        document.advances[advance.id] = advance;
      }
      if (externalIds.length > 0) {
        if (!document.actionWindow) document.actionWindow = this.openWindow(document, externalIds);
        const expired = document.actionWindow.deadlineAt !== null &&
          Date.parse(document.actionWindow.deadlineAt) <= this.now().getTime();
        const complete = document.actionWindow.requiredAgentIds.every((agentId) => document.actionWindow!.submissions[agentId]);
        if (!complete && !expired) {
          advance.status = "awaiting_actions";
          advance.updatedAt = this.now().toISOString();
          document.updatedAt = advance.updatedAt;
          stored = this.persist(stored, document);
          this.scheduleWindowDeadline(document);
          return this.project(stored.document);
        }
      }
      stored = await this.executeStep(stored, advance);
      if (stored.document.actionWindow || input.trigger === "batch" && activeParticipants(stored.document).length > 0) break;
    }
    if (stored.document.scheduler.mode === "realtime") this.scheduleRealtime(stored.document);
    return this.project(stored.document);
  }

  private async executeStep(
    stored: StoredWorldInstance,
    advance: WorldAdvanceRecord,
  ): Promise<StoredWorldInstance> {
    const document = structuredClone(stored.document);
    const advanceRecord = document.advances[advance.id] ?? structuredClone(advance);
    document.advances[advanceRecord.id] = advanceRecord;
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
    advanceRecord.status = "running";
    advanceRecord.updatedAt = this.now().toISOString();
    const execution = this.beginExecution(document, "interactive", advanceRecord.request.trigger, effectiveRoster);
    if (execution) advanceRecord.executionIds.push(execution.id);
    const definition = this.definition(document);
    const engine = new SimulationEngine(
      definition,
      this.registry.create(EAGER_REFERENCE_MANIFEST.id, EAGER_REFERENCE_MANIFEST.version),
      document.state,
    );
    const request: WorldAdvanceRequest = {
      expectedRevision: document.state.revision,
      trigger: advanceRecord.request.trigger,
      simulatedSeconds: advanceRecord.request.simulatedSeconds,
      externalActions,
    };
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
      });
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
      advanceRecord.status = "committed";
      advanceRecord.committedRevisions.push(document.state.revision);
      advanceRecord.updatedAt = this.now().toISOString();
      document.actionWindow = null;
      if (document.scheduler.mode === "realtime") {
        document.scheduler.nextTickAt = new Date(
          this.now().getTime() + document.runtime.realtimeIntervalMs,
        ).toISOString();
      }
      document.updatedAt = advanceRecord.updatedAt;
      const finish: FinishExecutionInput = {
        status: "succeeded",
        semanticHash: result.committed.semanticHash,
        stateHash: contentHash(document.state),
        commitRevision: document.state.revision,
      };
      const committed = execution && this.options.ledger && isAtomicStore(this.options.store)
        ? this.options.store.compareAndSwapInstanceAndFinishExecution(
            document.id,
            stored.generation,
            document,
            execution.id,
            finish,
          ).instance
        : this.persist(stored, document);
      if (execution && this.options.ledger && !isAtomicStore(this.options.store)) {
        this.options.ledger.finishExecution(execution.id, finish);
      }
      return committed;
    } catch (error) {
      this.failExecution(execution?.id, error);
      const failed = structuredClone(stored.document);
      const failedAdvance = failed.advances[advanceRecord.id] ?? structuredClone(advanceRecord);
      failed.advances[failedAdvance.id] = failedAdvance;
      failedAdvance.status = "failed";
      failedAdvance.error = error instanceof Error ? error.message : String(error);
      failedAdvance.updatedAt = this.now().toISOString();
      failed.updatedAt = failedAdvance.updatedAt;
      if (failed.scheduler.mode === "realtime") {
        failed.scheduler.nextTickAt = new Date(
          this.now().getTime() + failed.runtime.realtimeIntervalMs,
        ).toISOString();
      }
      try {
        return this.persist(stored, failed);
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
    return this.serialized(instanceId, async () => {
      let stored = this.read(instanceId);
      const document = structuredClone(stored.document);
      const participant = document.participants[participantId];
      if (!participant || participant.status !== "active" || participant.principalId !== principalId) {
        throw new WorldHostError("active participant not found", 404);
      }
      if (input.expectedRevision !== document.state.revision) throw new WorldHostError("world revision changed", 409);
      const window = document.actionWindow;
      if (!window || window.status !== "open" || window.baseRevision !== input.expectedRevision) {
        throw new WorldHostError("no action window is open for this revision", 409);
      }
      const submissionId = input.submissionId.trim();
      if (!submissionId || submissionId.length > 128) throw new WorldHostError("invalid action submission identity", 400);
      const existing = window.submissions[participant.agentId];
      if (existing) {
        if (existing.submissionId !== submissionId || existing.rawText !== input.text.trim()) {
          throw new WorldHostError("this Agent already submitted a different action", 409);
        }
        return this.project(document, principalId);
      }
      const text = input.text.trim();
      if (!text || text.length > 4_000) throw new WorldHostError("action must contain 1–4000 characters", 400);
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
        submissionId,
        revision: document.state.revision,
        text,
        submittedAt: this.now().toISOString(),
      });
      document.updatedAt = this.now().toISOString();
      stored = this.persist(stored, document);
      const complete = window.requiredAgentIds.every((agentId) => window.submissions[agentId]);
      if (!complete) return this.project(stored.document, principalId);
      const advance = currentAdvance(stored.document);
      if (!advance) throw new Error("action window has no advance record");
      const committed = await this.executeStep(stored, advance);
      if (committed.document.scheduler.mode === "realtime") this.scheduleRealtime(committed.document);
      return this.project(committed.document, principalId);
    });
  }

  async createParticipant(
    instanceId: string,
    input: CreateParticipantInput,
    principalId = "local",
  ): Promise<{ instance: PublicInstanceDetail; participantId: string; arrival: ArrivalView }> {
    return this.serialized(instanceId, async () => {
      const stored = this.read(instanceId);
      const document = structuredClone(stored.document);
      if (input.expectedRevision !== document.state.revision) {
        throw new WorldHostError("world revision changed", 409);
      }
      if (document.actionWindow || currentAdvance(document)?.status === "running") {
        throw new WorldHostError("join only at a committed revision boundary", 409);
      }
      if (activeParticipants(document).length >= this.maxActiveParticipants) {
        throw new WorldHostError("this instance has reached its active participant limit", 409);
      }
      if (activeParticipants(document).some((participant) => participant.principalId === principalId)) {
        throw new WorldHostError("this principal already controls an Agent", 409);
      }
      const definition = this.definition(document);
      if (!definition.participation) throw new WorldHostError("this world is headless-only", 409);
      const displayName = input.displayName.trim();
      const appearance = input.appearance.trim();
      const motivation = input.motivation.trim();
      if (!displayName || displayName.length > 80 || appearance.length > 500 || motivation.length > 500) {
        throw new WorldHostError("participant customization is invalid", 400);
      }
      const participantId = this.idFactory();
      const execution = this.beginExecution(document, "interactive", "participant_admission");
      let agentId: string;
      let fallbackArrival: string;
      let commitPhase: "admission" | "instance";
      try {
        execution?.trace.emit({
          event: "participant.admission.started",
          attributes: { mode: input.claimAgentId ? "claim" : "origin" },
          counts: { activeParticipants: activeParticipants(document).length },
        });
        if (input.claimAgentId) {
          commitPhase = "instance";
          agentId = input.claimAgentId;
          if (!claimableAgentIds(document, definition).includes(agentId)) {
            throw new WorldHostError("Agent is not claimable", 409);
          }
          if (activeParticipants(document).some((participant) => participant.agentId === agentId)) {
            throw new WorldHostError("Agent was claimed concurrently", 409);
          }
          fallbackArrival = `你重新把注意力放回 ${document.state.truth.entities[document.state.agents[agentId].entityId].name} 的此刻。`;
        } else {
          commitPhase = "admission";
          const origin = definition.participation.origins.find((entry) => entry.id === input.originId);
          if (!origin) throw new WorldHostError("origin not found", 404);
          let ordinal = 1;
          do agentId = `${origin.id}-${ordinal++}`; while (document.state.agents[agentId]);
          const agent = agentStateFromOrigin(document.state, origin, agentId, displayName, appearance, motivation);
          const quantities = origin.resources.map((resource) => ({
            id: quantityId(document.state.worldHash, resource.definitionId, agentId),
            definitionId: resource.definitionId,
            holderId: agentId,
            amount: resource.amount,
          }));
          const admitted = this.committer.admit(document.state, {
            entity: {
              id: agentId,
              kind: origin.entityKind,
              name: displayName,
              description: appearance ? `${origin.description}\n外观：${appearance}` : origin.description,
              lifecycle: "active",
              createdAtStep: document.state.step,
            },
            placementId: origin.spawnEntityId,
            agent,
            quantities,
          });
          document.state = admitted.state;
          for (const binding of Object.values(document.policyBindings)) {
            if (binding.kind === "model") binding.resumeFromRevision = admitted.committed.baseRevision;
          }
          execution?.trace.emit({
            event: "participant.admission.candidate",
            attributes: { mode: "origin", agentId },
            hashes: { semantic: admitted.committed.semanticHash, state: contentHash(document.state) },
            payload: admitted.committed,
          });
          fallbackArrival = origin.fallbackArrival;
        }
        const joinedAt = this.now().toISOString();
        document.participants[participantId] = {
          id: participantId,
          principalId,
          displayName,
          agentId,
          status: "active",
          joinedAt,
          updatedAt: joinedAt,
          controlledSinceRevision: document.state.revision,
          ...(execution ? { admissionExecutionId: execution.id } : {}),
          ...(document.state.agents[agentId].nextAction
            ? { suppressedActionId: document.state.agents[agentId].nextAction!.id }
            : {}),
        };
        document.policyBindings[agentId] = { kind: "external", agentId, participantId };
        document.updatedAt = joinedAt;
        validateSimulationState(document.state, false, true);
        const finish: FinishExecutionInput = {
          status: "succeeded",
          semanticHash: commitPhase === "admission"
            ? document.state.admissions.at(-1)!.semanticHash
            : contentHash({ participantId, agentId, mode: "claim", revision: document.state.revision }),
          stateHash: contentHash(document.state),
          commitRevision: document.state.revision,
        };
        const committed = execution && this.options.ledger && isAtomicStore(this.options.store)
          ? this.options.store.compareAndSwapInstanceAndFinishExecution(
              document.id,
              stored.generation,
              document,
              execution.id,
              finish,
              commitPhase,
            ).instance
          : this.persist(stored, document);
        if (execution && this.options.ledger && !isAtomicStore(this.options.store)) {
          this.options.ledger.finishExecution(execution.id, finish);
        }
        const arrival = await this.generateArrival(committed.document, participantId, fallbackArrival);
        return { instance: this.project(committed.document, principalId), participantId, arrival };
      } catch (error) {
        this.failExecution(execution?.id, error);
        throw error;
      }
    });
  }

  async releaseParticipant(
    instanceId: string,
    participantId: string,
    input: ReleaseParticipantInput,
    principalId = "local",
  ): Promise<PublicInstanceDetail> {
    return this.serialized(instanceId, async () => {
      let stored = this.read(instanceId);
      if (input.expectedRevision !== stored.document.state.revision) {
        throw new WorldHostError("world revision changed", 409);
      }
      const document = structuredClone(stored.document);
      const participant = document.participants[participantId];
      if (!participant || participant.status !== "active" || participant.principalId !== principalId) {
        throw new WorldHostError("active participant not found", 404);
      }
      participant.status = "released";
      participant.updatedAt = this.now().toISOString();
      const agent = document.state.agents[participant.agentId];
      document.policyBindings[participant.agentId] = input.disposition === "model"
        ? {
            kind: "model",
            agentId: agent.id,
            profiles: structuredClone(agent.modelProfiles),
            resumeFromRevision: participant.controlledSinceRevision,
          }
        : { kind: "idle", agentId: agent.id, reason: "released" };
      if (document.actionWindow?.status === "open") {
        document.actionWindow.requiredAgentIds = document.actionWindow.requiredAgentIds
          .filter((agentId) => agentId !== participant.agentId);
        delete document.actionWindow.submissions[participant.agentId];
        document.actionWindow.generation += 1;
      }
      document.updatedAt = participant.updatedAt;
      stored = this.persist(stored, document);
      if (stored.document.actionWindow?.status === "open" &&
        stored.document.actionWindow.requiredAgentIds.length === 0) {
        const advance = currentAdvance(stored.document);
        if (advance && ["awaiting_actions", "queued"].includes(advance.status)) {
          stored = await this.executeStep(stored, advance);
        }
      }
      if (stored.document.scheduler.mode === "realtime") this.scheduleRealtime(stored.document);
      return this.project(stored.document, principalId);
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
      await this.serialized(document.id, async () => {
        const stored = this.read(document.id);
        const window = stored.document.actionWindow;
        if (!window || window.id !== document.actionWindow!.id || window.status !== "open") return;
        const advance = currentAdvance(stored.document);
        if (!advance) return;
        const committed = await this.executeStep(stored, advance);
        if (committed.document.scheduler.mode === "realtime") this.scheduleRealtime(committed.document);
      });
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
    const document = stored.document;
    if (document.actionWindow?.status === "open" && document.actionWindow.deadlineAt) {
      this.scheduleWindowDeadline(document);
    } else if (document.scheduler.mode === "realtime") {
      const restored = structuredClone(document);
      restored.scheduler.generation += 1;
      restored.scheduler.nextTickAt = new Date(this.now().getTime() + restored.runtime.realtimeIntervalMs).toISOString();
      restored.updatedAt = this.now().toISOString();
      this.scheduleRealtime(this.persist(stored, restored).document);
    }
  }
}
