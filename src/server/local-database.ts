import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { canonicalize, contentHash } from "../engine/model-audit";
import { attachExecutionRef } from "../engine/canonical-committer";
import type { ModelCatalog } from "../engine/model-catalog";
import {
  validateExecutionProducerManifest,
} from "../engine/execution";
import {
  NOOP_RUNTIME_OBSERVER,
  materializeRuntimeEvent,
  redactRuntimePayload,
  runtimeEventEmitter,
  serializeRuntimeError,
  type RuntimeCorrelation,
  type RuntimeError,
  type RuntimeObserver,
  type RuntimeEvent,
  type RuntimeEventInput,
} from "../engine/observability";
import type { ExecutionTraceWriter } from "../engine/execution";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "../engine/rule-package";
import { buildWorldDefinition, hashWorldTemplate, parseWorldTemplate } from "../script/world-loader";
import type { WorldCatalogEntry, WorldRepository } from "../script/world-repository";
import { parseWorldArchive, WorldImportError, type WorldImportResult } from "./world-import";
import {
  parseWorldInstanceDocument,
  serializeWorldInstanceDocument,
  WorldInstanceConflictError,
  WorldInstanceNotFoundError,
  type WorldInstanceStore,
} from "./world-instance-store";
import type { StoredWorldInstance, WorldInstanceDocument } from "./world-instance-types";
import type {
  BeginExecutionInput,
  ExecutionArtifactRecord,
  ExecutionLedger,
  ExecutionRecord,
  FinishExecutionInput,
} from "./execution-ledger";

const INSTANCE_HEARTBEAT_MS = 5_000;
const INSTANCE_LEASE_MS = 15_000;
const VALIDATED_INSTANCE_CACHE_LIMIT = 8;
const MAX_PENDING_EXECUTION_EVENTS = 64;
const EXECUTION_ROOT_EVENTS = new Set([
  "benchmark.matrix.started",
  "instance.bootstrap.started",
  "step.started",
]);

function executionError(value: unknown): RuntimeError {
  if (value instanceof Error) return serializeRuntimeError(value);
  if (value && typeof value === "object") {
    const candidate = value as Partial<RuntimeError>;
    if (typeof candidate.name === "string" && typeof candidate.message === "string") {
      return structuredClone(candidate as RuntimeError);
    }
  }
  return serializeRuntimeError(value);
}

interface LocalDatabaseOptions {
  ownerId?: string;
  now?: () => number;
  heartbeat?: boolean;
  rulePackages?: RulePackageRegistry;
  observer?: RuntimeObserver;
}

interface WorldRow {
  id: string;
  name: string;
  version: string;
  content_hash: string;
  description: string;
  template_json: string;
}

interface InstanceRow {
  generation: number;
  document_json: string;
}

interface ListedInstanceRow extends InstanceRow {
  id: string;
}

interface ValidatedInstanceCacheEntry {
  generation: number;
  serialized: string;
  documentUtf8Bytes: number;
  document: WorldInstanceDocument;
}

interface LockRow {
  owner_id: string;
  expires_at: number;
}

interface ExecutionRow {
  id: string;
  kind: BeginExecutionInput["kind"];
  parent_execution_id: string | null;
  instance_id: string | null;
  advance_id: string | null;
  step: number | null;
  manifest_json: string;
  world_hash: string;
  code_revision: string;
  code_dirty: number;
  model_catalog_hash: string;
  seed: number;
  runtime_config_json: string;
  status: ExecutionRecord["status"];
  trace_id: string;
  semantic_hash: string | null;
  state_hash: string | null;
  commit_revision: number | null;
  terminal_event_sequence: number | null;
  trace_hash: string | null;
  error_artifact_hash: string | null;
  started_at: string;
  finished_at: string | null;
}

interface ExecutionEventRow {
  sequence: number;
  event_json: string;
  artifact_hash: string | null;
}

interface ExecutionArtifactRow {
  hash: string;
  execution_id: string;
  kind: string;
  media_type: string;
  encoding: "gzip";
  raw_bytes: number;
  stored_bytes: number;
  body: Buffer;
  created_at: string;
}

class LocalExecutionTraceWriter implements ExecutionTraceWriter {
  readonly mode = "full" as const;
  readonly degraded = false;
  readonly critical = true;
  private readonly pendingEvents: RuntimeEventInput[] = [];

  constructor(
    private readonly ledger: ExecutionLedger,
    readonly executionId: string,
    readonly traceId: string,
    private readonly parentLink?: { traceId: string; spanId: string },
  ) {}

  private rootSpanId(): string {
    return this.traceId.slice(0, 16);
  }

  private phaseSpanId(phase: string): string {
    return contentHash({ executionId: this.executionId, phase }).slice(0, 16);
  }

  private spanId(input: RuntimeEventInput): string {
    const correlation = input.correlation;
    if (correlation?.transportAttempt !== undefined && correlation.modelInvocationId) {
      return contentHash({
        executionId: this.executionId,
        invocation: correlation.modelInvocationId,
        transportAttempt: correlation.transportAttempt,
      }).slice(0, 16);
    }
    if (correlation?.modelInvocationId) {
      return contentHash({ executionId: this.executionId, invocation: correlation.modelInvocationId }).slice(0, 16);
    }
    if (EXECUTION_ROOT_EVENTS.has(input.event)) return this.rootSpanId();
    return contentHash({
      executionId: this.executionId,
      phase: input.attributes?.phase ?? input.event.split(".").slice(0, 2).join("."),
    }).slice(0, 16);
  }

  private parentSpanId(input: RuntimeEventInput, spanId = this.spanId(input)): string | undefined {
    const correlation = input.correlation;
    if (correlation?.transportAttempt !== undefined && correlation.modelInvocationId) {
      return contentHash({ executionId: this.executionId, invocation: correlation.modelInvocationId }).slice(0, 16);
    }
    if (correlation?.modelInvocationId) {
      return this.phaseSpanId(correlation.step === 0 ? "bootstrap" : "step");
    }
    const rootSpanId = this.rootSpanId();
    return spanId === rootSpanId ? undefined : rootSpanId;
  }

  emit(input: RuntimeEventInput): RuntimeEvent | undefined {
    const spanId = input.spanId ?? this.spanId(input);
    this.pendingEvents.push(structuredClone({
      ...input,
      traceId: input.traceId ?? this.traceId,
      spanId,
      parentSpanId: input.parentSpanId ?? this.parentSpanId(input, spanId),
      links: input.links ?? (spanId === this.rootSpanId() && this.parentLink ? [this.parentLink] : undefined),
      correlation: { ...input.correlation, executionId: this.executionId },
    }));
    if (this.pendingEvents.length < MAX_PENDING_EXECUTION_EVENTS) return undefined;
    return this.flushEvents().at(-1);
  }

  private flushEvents(): RuntimeEvent[] {
    if (this.pendingEvents.length === 0) return [];
    const batch = this.pendingEvents.splice(0);
    try {
      return this.ledger.appendExecutionEvents(this.executionId, batch);
    } catch (error) {
      this.pendingEvents.unshift(...batch);
      throw error;
    }
  }

  flush(): void {
    this.flushEvents();
  }

  artifact(kind: string, value: unknown): string {
    this.flush();
    return this.ledger.putExecutionArtifact(this.executionId, kind, value);
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    return this.ledger.subscribe(listener);
  }
}

export class LocalDatabaseInUseError extends Error {
  constructor(file: string) {
    super(`local database is already owned by another Living World Engine instance: ${file}`);
    this.name = "LocalDatabaseInUseError";
  }
}

export class LocalDatabase implements WorldRepository, WorldInstanceStore, ExecutionLedger {
  readonly created: boolean;
  readonly rulePackages: RulePackageRegistry;
  private readonly connection: Database.Database;
  private readonly ownerId: string;
  private readonly now: () => number;
  private readonly heartbeatTimer?: NodeJS.Timeout;
  private readonly observer: RuntimeObserver;
  private readonly observe: ReturnType<typeof runtimeEventEmitter>;
  private readonly validatedInstances = new Map<string, ValidatedInstanceCacheEntry>();
  private readonly executionListeners = new Set<(event: RuntimeEvent) => void>();
  private readonly executionWriters = new Map<string, LocalExecutionTraceWriter>();
  private closed = false;

  constructor(readonly file: string, options: LocalDatabaseOptions = {}) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.connection = new Database(file, { timeout: 5_000 });
    this.ownerId = options.ownerId ?? `${process.pid}:${randomUUID()}`;
    this.now = options.now ?? Date.now;
    this.rulePackages = options.rulePackages ?? createCoreRulePackageRegistry();
    this.observer = options.observer ?? NOOP_RUNTIME_OBSERVER;
    this.observe = runtimeEventEmitter(this.observer);
    try {
      this.connection.pragma("journal_mode = WAL");
      this.connection.pragma("synchronous = FULL");
      this.connection.pragma("foreign_keys = ON");
      this.connection.pragma("busy_timeout = 5000");
      this.connection.pragma("trusted_schema = OFF");
      this.created = this.migrate();
      this.acquireInstanceLease();
      this.recoverInterruptedExecutions();
    } catch (error) {
      this.connection.close();
      throw error;
    }
    if (options.heartbeat !== false) {
      this.heartbeatTimer = setInterval(() => this.renewInstanceLease(), INSTANCE_HEARTBEAT_MS);
      this.heartbeatTimer.unref();
    }
  }

  private cacheValidatedInstance(
    instanceId: string,
    generation: number,
    serialized: string,
    document: WorldInstanceDocument,
  ): ValidatedInstanceCacheEntry {
    const entry = {
      generation,
      serialized,
      documentUtf8Bytes: Buffer.byteLength(serialized, "utf8"),
      document: structuredClone(document),
    };
    this.validatedInstances.delete(instanceId);
    this.validatedInstances.set(instanceId, entry);
    while (this.validatedInstances.size > VALIDATED_INSTANCE_CACHE_LIMIT) {
      const oldestInstanceId = this.validatedInstances.keys().next().value;
      if (oldestInstanceId === undefined) break;
      this.validatedInstances.delete(oldestInstanceId);
    }
    return entry;
  }

  private cachedInstance(
    instanceId: string,
    row: InstanceRow,
    promote = true,
  ): ValidatedInstanceCacheEntry | undefined {
    const cached = this.validatedInstances.get(instanceId);
    if (!cached || cached.generation !== row.generation || cached.serialized !== row.document_json) {
      if (cached) this.validatedInstances.delete(instanceId);
      return undefined;
    }
    if (promote) {
      this.validatedInstances.delete(instanceId);
      this.validatedInstances.set(instanceId, cached);
    }
    return cached;
  }

  private observeCachedRead(
    instanceId: string,
    cached: ValidatedInstanceCacheEntry,
    startedAt: number,
    correlation?: RuntimeCorrelation,
  ): void {
    this.observe?.({
      event: "persistence.read.completed",
      correlation: { ...correlation, instanceId },
      durationMs: Math.max(0, Date.now() - startedAt),
      attributes: { sink: "sqlite", cacheHit: true },
      measurements: { documentUtf8Bytes: cached.documentUtf8Bytes },
      counts: {
        history: cached.document.state.history.length,
        participants: Object.keys(cached.document.participants).length,
      },
    });
  }

  private migrate(): boolean {
    return this.connection.transaction(() => {
      this.connection.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        ) STRICT;
      `);
      const current = this.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get() as { version: number | null };
      const currentVersion = current.version ?? 0;
      if (currentVersion > 6) throw new Error("local database schema is newer than this application");
      if (currentVersion > 0 && currentVersion < 6) {
        throw new Error("local database schema is older than v6; use a new LIVINGWORLD_DATA_ROOT");
      }
      if (currentVersion === 0) this.connection.exec(`
        CREATE TABLE instance_lock (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          owner_id TEXT NOT NULL,
          pid INTEGER NOT NULL,
          acquired_at INTEGER NOT NULL,
          heartbeat_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE world_versions (
          world_id TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest_version TEXT NOT NULL,
          description TEXT NOT NULL,
          template_json TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          PRIMARY KEY (world_id, content_hash)
        ) STRICT;
        CREATE TABLE world_catalog (
          world_id TEXT PRIMARY KEY,
          current_content_hash TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (world_id, current_content_hash)
            REFERENCES world_versions(world_id, content_hash)
        ) STRICT;
        CREATE TABLE executions (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('interactive', 'diagnostic', 'benchmark', 'replay')),
          parent_execution_id TEXT,
          instance_id TEXT,
          advance_id TEXT,
          step INTEGER,
          manifest_json TEXT NOT NULL,
          world_hash TEXT NOT NULL,
          code_revision TEXT NOT NULL,
          code_dirty INTEGER NOT NULL CHECK (code_dirty IN (0, 1)),
          model_catalog_hash TEXT NOT NULL,
          seed INTEGER NOT NULL,
          runtime_config_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
          trace_id TEXT NOT NULL UNIQUE,
          semantic_hash TEXT,
          state_hash TEXT,
          commit_revision INTEGER,
          terminal_event_sequence INTEGER,
          trace_hash TEXT,
          error_artifact_hash TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          FOREIGN KEY (parent_execution_id) REFERENCES executions(id)
        ) STRICT;
        CREATE INDEX executions_instance_step ON executions(instance_id, step, started_at);
        CREATE INDEX executions_parent ON executions(parent_execution_id, started_at);
        CREATE TABLE execution_artifacts (
          hash TEXT PRIMARY KEY,
          execution_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          media_type TEXT NOT NULL,
          encoding TEXT NOT NULL CHECK (encoding = 'gzip'),
          raw_bytes INTEGER NOT NULL CHECK (raw_bytes >= 0),
          stored_bytes INTEGER NOT NULL CHECK (stored_bytes >= 0),
          body BLOB NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (execution_id) REFERENCES executions(id)
        ) STRICT;
        CREATE TABLE execution_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id TEXT NOT NULL,
          trace_id TEXT NOT NULL,
          span_id TEXT NOT NULL,
          parent_span_id TEXT,
          event_name TEXT NOT NULL,
          phase TEXT,
          level TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          duration_ms REAL,
          attributes_json TEXT NOT NULL,
          measurements_json TEXT NOT NULL,
          counts_json TEXT NOT NULL,
          hashes_json TEXT NOT NULL,
          links_json TEXT NOT NULL,
          correlation_json TEXT NOT NULL,
          artifact_hash TEXT,
          error_json TEXT,
          event_json TEXT NOT NULL,
          FOREIGN KEY (execution_id) REFERENCES executions(id),
          FOREIGN KEY (artifact_hash) REFERENCES execution_artifacts(hash)
        ) STRICT;
        CREATE INDEX execution_events_execution_sequence ON execution_events(execution_id, sequence);
        CREATE INDEX execution_events_instance ON execution_events(
          json_extract(correlation_json, '$.instanceId'), sequence
        );
        CREATE TABLE world_instances (
          id TEXT PRIMARY KEY,
          generation INTEGER NOT NULL CHECK (generation > 0),
          world_id TEXT NOT NULL,
          world_hash TEXT NOT NULL,
          document_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX world_instances_world_version ON world_instances(world_id, world_hash);
      `);
      if (currentVersion === 0) {
        this.connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (6, ?)")
          .run(new Date(this.now()).toISOString());
      }
      return currentVersion === 0;
    })();
  }

  beginExecution(input: BeginExecutionInput): ExecutionTraceWriter {
    this.assertInstanceLease();
    validateExecutionProducerManifest(input.manifest);
    const traceId = randomUUID().replaceAll("-", "");
    const startedAt = input.startedAt ?? new Date(this.now()).toISOString();
    const parentTrace = input.parentExecutionId
      ? this.connection.prepare("SELECT trace_id FROM executions WHERE id = ?")
          .get(input.parentExecutionId) as { trace_id: string } | undefined
      : undefined;
    if (input.parentExecutionId && !parentTrace) {
      throw new Error(`parent execution not found: ${input.parentExecutionId}`);
    }
    this.connection.prepare(`
      INSERT INTO executions(
        id, kind, parent_execution_id, instance_id, advance_id, step, manifest_json,
        world_hash, code_revision, code_dirty, model_catalog_hash, seed,
        runtime_config_json, status, trace_id, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(
      input.id,
      input.kind,
      input.parentExecutionId ?? null,
      input.instanceId ?? null,
      input.advanceId ?? null,
      input.step ?? null,
      JSON.stringify(canonicalize(input.manifest)),
      input.worldHash,
      input.codeRevision,
      input.codeDirty ? 1 : 0,
      input.modelCatalogHash,
      input.seed,
      JSON.stringify(canonicalize(input.runtimeConfig)),
      traceId,
      startedAt,
    );
    const writer = new LocalExecutionTraceWriter(
      this,
      input.id,
      traceId,
      parentTrace ? { traceId: parentTrace.trace_id, spanId: parentTrace.trace_id.slice(0, 16) } : undefined,
    );
    this.executionWriters.set(input.id, writer);
    return writer;
  }

  private requireRunningExecution(executionId: string): { trace_id: string } {
    const execution = this.connection.prepare(
      "SELECT trace_id, status FROM executions WHERE id = ?",
    ).get(executionId) as { trace_id: string; status: string } | undefined;
    if (!execution) throw new Error(`execution not found: ${executionId}`);
    if (execution.status !== "running") throw new Error(`execution is already terminal: ${executionId}`);
    return { trace_id: execution.trace_id };
  }

  private persistExecutionArtifact(executionId: string, kind: string, value: unknown): string {
    if (!kind.trim()) throw new Error("execution artifact kind cannot be empty");
    const normalized = canonicalize(value);
    const serialized = JSON.stringify(normalized);
    if (serialized === undefined) throw new Error("execution artifact must be JSON serializable");
    const raw = Buffer.from(serialized, "utf8");
    const hash = contentHash(normalized);
    const compressed = gzipSync(raw);
    this.connection.prepare(`
      INSERT OR IGNORE INTO execution_artifacts(
        hash, execution_id, kind, media_type, encoding, raw_bytes, stored_bytes, body, created_at
      ) VALUES (?, ?, ?, 'application/json', 'gzip', ?, ?, ?, ?)
    `).run(
      hash,
      executionId,
      kind,
      raw.byteLength,
      compressed.byteLength,
      compressed,
      new Date(this.now()).toISOString(),
    );
    return hash;
  }

  putExecutionArtifact(executionId: string, kind: string, value: unknown): string {
    return this.connection.transaction(() => {
      this.assertInstanceLease();
      this.requireRunningExecution(executionId);
      return this.persistExecutionArtifact(executionId, kind, value);
    })();
  }

  appendExecutionEvent(executionId: string, input: RuntimeEventInput): RuntimeEvent {
    return this.appendExecutionEvents(executionId, [input])[0];
  }

  private persistExecutionEvents(executionId: string, inputs: readonly RuntimeEventInput[]): RuntimeEvent[] {
    this.assertInstanceLease();
    const execution = this.requireRunningExecution(executionId);
    const writeStartedAt = performance.now();
    const persistedEvents = inputs.map((input) => {
        const safeInput = redactRuntimePayload(input) as RuntimeEventInput;
        const artifactHash = safeInput.payload === undefined
          ? null
          : this.persistExecutionArtifact(executionId, `${safeInput.event}.payload`, safeInput.payload);
        const artifactSize = artifactHash
          ? this.connection.prepare("SELECT raw_bytes, stored_bytes FROM execution_artifacts WHERE hash = ?")
              .get(artifactHash) as { raw_bytes: number; stored_bytes: number }
          : undefined;
        const timestamp = new Date(this.now());
        const provisional = materializeRuntimeEvent({
          ...safeInput,
          payload: undefined,
          traceId: safeInput.traceId ?? execution.trace_id,
          spanId: safeInput.spanId ?? randomUUID().replaceAll("-", "").slice(0, 16),
          correlation: { ...safeInput.correlation, executionId },
        }, 0, timestamp, "full");
        const measurements = {
          ...provisional.measurements,
          ledgerArtifactRawBytes: artifactSize?.raw_bytes ?? 0,
          ledgerArtifactStoredBytes: artifactSize?.stored_bytes ?? 0,
          ledgerSqliteWriteMs: 0,
        };
        const persisted = { ...provisional, measurements };
        const result = this.connection.prepare(`
          INSERT INTO execution_events(
            execution_id, trace_id, span_id, parent_span_id, event_name, phase, level,
            timestamp, duration_ms, attributes_json, measurements_json, counts_json,
            hashes_json, links_json, correlation_json, artifact_hash, error_json, event_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          executionId,
          provisional.traceId,
          provisional.spanId,
          provisional.parentSpanId ?? null,
          provisional.event,
          typeof provisional.attributes?.phase === "string" ? provisional.attributes.phase : null,
          provisional.level,
          provisional.timestamp,
          provisional.durationMs ?? null,
          JSON.stringify(canonicalize(provisional.attributes ?? {})),
          JSON.stringify(canonicalize(measurements)),
          JSON.stringify(canonicalize(provisional.counts ?? {})),
          JSON.stringify(canonicalize(provisional.hashes ?? {})),
          JSON.stringify(canonicalize(provisional.links ?? [])),
          JSON.stringify(canonicalize(provisional.correlation ?? {})),
          artifactHash,
          provisional.error ? JSON.stringify(canonicalize(provisional.error)) : null,
          JSON.stringify(canonicalize(persisted)),
        );
        const sequence = Number(result.lastInsertRowid);
        return {
          ...provisional,
          sequence,
          measurements,
          ...(safeInput.payload === undefined ? {} : { payload: structuredClone(safeInput.payload) }),
        } satisfies RuntimeEvent;
    });
    const lastEvent = persistedEvents.at(-1)!;
    const measurements = {
      ...lastEvent.measurements,
      ledgerSqliteWriteMs: Math.max(0, performance.now() - writeStartedAt),
    };
    const completed = { ...lastEvent, measurements };
    const result = this.connection.prepare(`
        UPDATE execution_events
        SET measurements_json = ?, event_json = ?
        WHERE sequence = ?
      `).run(
      JSON.stringify(canonicalize(measurements)),
      JSON.stringify(canonicalize({ ...completed, payload: undefined })),
      lastEvent.sequence,
    );
    if (result.changes !== 1) throw new Error("execution event batch measurement update failed");
    persistedEvents[persistedEvents.length - 1] = completed;
    return persistedEvents;
  }

  private publishExecutionEvents(events: readonly RuntimeEvent[]): void {
    for (const event of events) {
      for (const listener of this.executionListeners) {
        try {
          listener(structuredClone(event));
        } catch {
          // Query projections cannot change execution persistence.
        }
      }
    }
  }

  appendExecutionEvents(executionId: string, inputs: readonly RuntimeEventInput[]): RuntimeEvent[] {
    if (inputs.length === 0) return [];
    const events = this.connection.transaction(() => this.persistExecutionEvents(executionId, inputs))();
    this.publishExecutionEvents(events);
    return events;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.executionListeners.add(listener);
    return () => this.executionListeners.delete(listener);
  }

  finishExecution(executionId: string, input: FinishExecutionInput): import("../engine/execution").ExecutionRef {
    this.executionWriters.get(executionId)?.flush();
    const terminalError = input.error === undefined ? undefined : executionError(input.error);
    let terminalEvents: RuntimeEvent[] = [];
    const reference = this.connection.transaction(() => {
      this.assertInstanceLease();
      const current = this.connection.prepare("SELECT status FROM executions WHERE id = ?")
        .get(executionId) as { status: string } | undefined;
      if (!current) throw new Error(`execution not found: ${executionId}`);
      if (current.status !== "running") throw new Error(`execution is already terminal: ${executionId}`);
      if (terminalError) {
        terminalEvents = this.persistExecutionEvents(executionId, [{
          event: `execution.${input.status}`,
          level: input.status === "cancelled" ? "warn" : "error",
          attributes: { terminalStatus: input.status },
          error: terminalError,
        }]);
      }
      const errorArtifactHash = terminalError === undefined
        ? null
        : this.persistExecutionArtifact(
            executionId,
            "execution.error",
            terminalError,
          );
      const currentReference = this.currentExecutionRef(executionId);
      const result = this.connection.prepare(`
        UPDATE executions SET
          status = ?, semantic_hash = ?, state_hash = ?, commit_revision = ?,
          terminal_event_sequence = ?, trace_hash = ?, error_artifact_hash = ?, finished_at = ?
        WHERE id = ? AND status = 'running'
      `).run(
        input.status,
        input.semanticHash ?? null,
        input.stateHash ?? null,
        input.commitRevision ?? null,
        currentReference.terminalEventSequence,
        currentReference.traceHash,
        errorArtifactHash,
        input.finishedAt ?? new Date(this.now()).toISOString(),
        executionId,
      );
      if (result.changes !== 1) throw new Error(`execution terminal update failed: ${executionId}`);
      return currentReference;
    })();
    this.executionWriters.delete(executionId);
    this.publishExecutionEvents(terminalEvents);
    return reference;
  }

  private currentExecutionRef(executionId: string): import("../engine/execution").ExecutionRef {
    const rows = this.connection.prepare(`
      SELECT sequence, trace_id, span_id, parent_span_id, event_name, level, timestamp,
             attributes_json, counts_json, hashes_json, links_json, correlation_json,
             artifact_hash, error_json
      FROM execution_events WHERE execution_id = ? ORDER BY sequence
    `).all(executionId) as Array<{
      sequence: number;
      trace_id: string;
      span_id: string;
      parent_span_id: string | null;
      event_name: string;
      level: string;
      timestamp: string;
      attributes_json: string;
      counts_json: string;
      hashes_json: string;
      links_json: string;
      correlation_json: string;
      artifact_hash: string | null;
      error_json: string | null;
    }>;
    const terminalEventSequence = rows.at(-1)?.sequence ?? 0;
    if (terminalEventSequence <= 0) throw new Error(`execution has no durable events: ${executionId}`);
    const traceHash = contentHash(rows.map((row) => ({
      sequence: row.sequence,
      traceId: row.trace_id,
      spanId: row.span_id,
      parentSpanId: row.parent_span_id,
      event: row.event_name,
      level: row.level,
      timestamp: row.timestamp,
      attributes: JSON.parse(row.attributes_json),
      counts: JSON.parse(row.counts_json),
      hashes: JSON.parse(row.hashes_json),
      links: JSON.parse(row.links_json),
      correlation: JSON.parse(row.correlation_json),
      artifactHash: row.artifact_hash,
      error: row.error_json ? JSON.parse(row.error_json) : null,
    })));
    return { executionId, terminalEventSequence, traceHash };
  }

  private recoverInterruptedExecutions(): void {
    const interrupted = this.connection.prepare(
      "SELECT id FROM executions WHERE status = 'running' ORDER BY started_at, id",
    ).all() as Array<{ id: string }>;
    for (const { id } of interrupted) {
      this.appendExecutionEvent(id, {
        event: "execution.recovered_as_failed",
        level: "error",
        attributes: { reason: "process_interrupted" },
        error: {
          name: "ExecutionInterruptedError",
          message: "execution was running when the prior database owner stopped",
        },
      });
      this.finishExecution(id, {
        status: "failed",
        error: {
          name: "ExecutionInterruptedError",
          message: "execution was running when the prior database owner stopped",
        },
      });
    }
  }

  execution(executionId: string): ExecutionRecord | undefined {
    const row = this.connection.prepare("SELECT * FROM executions WHERE id = ?")
      .get(executionId) as ExecutionRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      kind: row.kind,
      ...(row.parent_execution_id ? { parentExecutionId: row.parent_execution_id } : {}),
      ...(row.instance_id ? { instanceId: row.instance_id } : {}),
      ...(row.advance_id ? { advanceId: row.advance_id } : {}),
      ...(row.step === null ? {} : { step: row.step }),
      manifest: JSON.parse(row.manifest_json),
      worldHash: row.world_hash,
      codeRevision: row.code_revision,
      codeDirty: row.code_dirty === 1,
      modelCatalogHash: row.model_catalog_hash,
      seed: row.seed,
      runtimeConfig: JSON.parse(row.runtime_config_json),
      status: row.status,
      traceId: row.trace_id,
      startedAt: row.started_at,
      ...(row.semantic_hash ? { semanticHash: row.semantic_hash } : {}),
      ...(row.state_hash ? { stateHash: row.state_hash } : {}),
      ...(row.commit_revision === null ? {} : { commitRevision: row.commit_revision }),
      ...(row.terminal_event_sequence === null ? {} : { terminalEventSequence: row.terminal_event_sequence }),
      ...(row.trace_hash ? { traceHash: row.trace_hash } : {}),
      ...(row.error_artifact_hash ? { errorArtifactHash: row.error_artifact_hash } : {}),
      ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    };
  }

  executions(input: {
    kind?: import("../engine/execution").ExecutionKind;
    parentExecutionId?: string;
    instanceId?: string;
  } = {}): ExecutionRecord[] {
    const clauses: string[] = [];
    const parameters: string[] = [];
    if (input.kind) {
      clauses.push("kind = ?");
      parameters.push(input.kind);
    }
    if (input.parentExecutionId) {
      clauses.push("parent_execution_id = ?");
      parameters.push(input.parentExecutionId);
    }
    if (input.instanceId) {
      clauses.push("instance_id = ?");
      parameters.push(input.instanceId);
    }
    const rows = this.connection.prepare(`
      SELECT id FROM executions
      ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY started_at, id
    `).all(...parameters) as Array<{ id: string }>;
    return rows.map((row) => this.execution(row.id)!);
  }

  private eventsFor(where: string, value: string): RuntimeEvent[] {
    const rows = this.connection.prepare(`
      SELECT events.sequence, events.event_json, events.artifact_hash
      FROM execution_events AS events
      JOIN executions ON executions.id = events.execution_id
      WHERE ${where} = ? ORDER BY events.sequence
    `).all(value) as ExecutionEventRow[];
    return rows.map((row) => {
      const event = JSON.parse(row.event_json) as RuntimeEvent;
      event.sequence = row.sequence;
      if (row.artifact_hash) event.payload = this.artifact(row.artifact_hash)?.value;
      return event;
    });
  }

  executionEvents(executionId: string): RuntimeEvent[] {
    this.executionWriters.get(executionId)?.flush();
    return this.eventsFor("executions.id", executionId);
  }

  instanceEvents(instanceId: string): RuntimeEvent[] {
    const runningIds = this.connection.prepare(
      "SELECT id FROM executions WHERE instance_id = ? AND status = 'running'",
    ).all(instanceId) as Array<{ id: string }>;
    for (const { id } of runningIds) this.executionWriters.get(id)?.flush();
    return this.eventsFor("executions.instance_id", instanceId);
  }

  artifact(hash: string): ExecutionArtifactRecord | undefined {
    const row = this.connection.prepare("SELECT * FROM execution_artifacts WHERE hash = ?")
      .get(hash) as ExecutionArtifactRow | undefined;
    if (!row) return undefined;
    return {
      hash: row.hash,
      executionId: row.execution_id,
      kind: row.kind,
      mediaType: row.media_type,
      encoding: row.encoding,
      rawBytes: row.raw_bytes,
      storedBytes: row.stored_bytes,
      createdAt: row.created_at,
      value: JSON.parse(gunzipSync(row.body).toString("utf8")),
    };
  }

  private acquireInstanceLease(): void {
    this.connection.transaction(() => {
      const now = this.now();
      const lock = this.connection.prepare("SELECT owner_id, expires_at FROM instance_lock WHERE singleton = 1")
        .get() as LockRow | undefined;
      if (lock && lock.owner_id !== this.ownerId && lock.expires_at > now) {
        throw new LocalDatabaseInUseError(this.file);
      }
      this.connection.prepare(`
        INSERT INTO instance_lock(singleton, owner_id, pid, acquired_at, heartbeat_at, expires_at)
        VALUES (1, ?, ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          owner_id = excluded.owner_id,
          pid = excluded.pid,
          acquired_at = excluded.acquired_at,
          heartbeat_at = excluded.heartbeat_at,
          expires_at = excluded.expires_at
      `).run(this.ownerId, process.pid, now, now, now + INSTANCE_LEASE_MS);
    })();
  }

  private assertInstanceLease(): void {
    const lock = this.connection.prepare("SELECT owner_id, expires_at FROM instance_lock WHERE singleton = 1")
      .get() as LockRow | undefined;
    if (!lock || lock.owner_id !== this.ownerId) {
      throw new LocalDatabaseInUseError(this.file);
    }
    const now = this.now();
    if (lock.expires_at > now) return;
    const renewed = this.connection.prepare(`
      UPDATE instance_lock SET heartbeat_at = ?, expires_at = ?
      WHERE singleton = 1 AND owner_id = ?
    `).run(now, now + INSTANCE_LEASE_MS, this.ownerId);
    if (renewed.changes !== 1) throw new LocalDatabaseInUseError(this.file);
  }

  private renewInstanceLease(): void {
    if (this.closed) return;
    const now = this.now();
    const result = this.connection.prepare(`
      UPDATE instance_lock
      SET heartbeat_at = ?, expires_at = ?
      WHERE singleton = 1 AND owner_id = ?
    `).run(now, now + INSTANCE_LEASE_MS, this.ownerId);
    if (result.changes !== 1) {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    }
  }

  list(): WorldCatalogEntry[] {
    const rows = this.connection.prepare(`
      SELECT versions.world_id AS id,
             versions.name,
             versions.manifest_version AS version,
             versions.content_hash,
             versions.description,
             versions.template_json
      FROM world_catalog AS catalog
      JOIN world_versions AS versions
        ON versions.world_id = catalog.world_id
       AND versions.content_hash = catalog.current_content_hash
      ORDER BY versions.world_id
    `).all() as WorldRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      contentHash: row.content_hash,
      description: row.description,
      participation: parseWorldTemplate(JSON.parse(row.template_json)).participation ? "open" as const : "headless" as const,
    }));
  }

  load(worldId: string, seed: number | undefined, modelCatalog: ModelCatalog) {
    const row = this.connection.prepare(`
      SELECT versions.world_id AS id,
             versions.name,
             versions.manifest_version AS version,
             versions.content_hash,
             versions.description,
             versions.template_json
      FROM world_catalog AS catalog
      JOIN world_versions AS versions
        ON versions.world_id = catalog.world_id
       AND versions.content_hash = catalog.current_content_hash
      WHERE catalog.world_id = ?
    `).get(worldId) as WorldRow | undefined;
    if (!row) throw new Error(`world not found: ${worldId}`);
    return this.definitionFromWorldRow(row, seed, modelCatalog);
  }

  loadVersion(
    worldId: string,
    contentHash: string,
    seed: number | undefined,
    modelCatalog: ModelCatalog,
  ) {
    const row = this.connection.prepare(`
      SELECT world_id AS id,
             name,
             manifest_version AS version,
             content_hash,
             description,
             template_json
      FROM world_versions
      WHERE world_id = ? AND content_hash = ?
    `).get(worldId, contentHash) as WorldRow | undefined;
    if (!row) throw new Error(`world version not found: ${worldId}@${contentHash}`);
    return this.definitionFromWorldRow(row, seed, modelCatalog);
  }

  private definitionFromWorldRow(
    row: WorldRow,
    seed: number | undefined,
    modelCatalog: ModelCatalog,
  ) {
    const template = parseWorldTemplate(JSON.parse(row.template_json));
    if (hashWorldTemplate(template) !== row.content_hash) throw new Error(`world ${row.id} content hash mismatch`);
    return buildWorldDefinition(template, { seed, modelCatalog, rulePackages: this.rulePackages });
  }

  importWorld(
    buffer: Buffer,
    modelCatalog: ModelCatalog,
    replace = false,
    expectedWorldId?: string,
  ): WorldImportResult {
    const archive = parseWorldArchive(buffer, modelCatalog, this.rulePackages);
    return this.connection.transaction(() => {
      this.assertInstanceLease();
      if (expectedWorldId !== undefined && archive.id !== expectedWorldId) {
        throw new WorldImportError(
          `archive world ${archive.id} does not match expected world ${expectedWorldId}`,
          409,
        );
      }
      const current = this.connection.prepare("SELECT current_content_hash FROM world_catalog WHERE world_id = ?")
        .get(archive.id) as { current_content_hash: string } | undefined;
      if (current && !replace) throw new WorldImportError(`world ${archive.id} already exists`, 409);
      this.connection.prepare(`
        INSERT OR IGNORE INTO world_versions(
          world_id, content_hash, name, manifest_version, description, template_json, imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        archive.id,
        archive.contentHash,
        archive.name,
        archive.version,
        archive.description,
        JSON.stringify(canonicalize(archive.template)),
        new Date(this.now()).toISOString(),
      );
      this.connection.prepare(`
        INSERT INTO world_catalog(world_id, current_content_hash, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(world_id) DO UPDATE SET
          current_content_hash = excluded.current_content_hash,
          updated_at = excluded.updated_at
      `).run(archive.id, archive.contentHash, new Date(this.now()).toISOString());
      return {
        id: archive.id,
        name: archive.name,
        description: archive.description,
        replaced: Boolean(current),
      };
    })();
  }

  deleteWorld(worldId: string): void {
    this.connection.transaction(() => {
      this.assertInstanceLease();
      const installed = this.connection.prepare("SELECT 1 FROM world_catalog WHERE world_id = ?")
        .get(worldId) as { 1: number } | undefined;
      if (!installed) throw new WorldImportError(`world ${worldId} not found`, 404);
      const instance = this.connection.prepare("SELECT 1 FROM world_instances WHERE world_id = ? LIMIT 1")
        .get(worldId) as { 1: number } | undefined;
      if (instance) throw new WorldImportError(`world ${worldId} still has instances`, 409);
      this.connection.prepare("DELETE FROM world_catalog WHERE world_id = ?").run(worldId);
      this.connection.prepare("DELETE FROM world_versions WHERE world_id = ?").run(worldId);
    })();
  }

  createInstance(document: WorldInstanceDocument, correlation?: RuntimeCorrelation): StoredWorldInstance {
    const startedAt = Date.now();
    const serialized = serializeWorldInstanceDocument(document);
    try {
      this.connection.transaction(() => {
        this.assertInstanceLease();
        try {
          this.connection.prepare(`
            INSERT INTO world_instances(
              id, generation, world_id, world_hash, document_json, created_at, updated_at
            ) VALUES (?, 1, ?, ?, ?, ?, ?)
          `).run(
            document.id,
            document.world.id,
            document.world.contentHash,
            serialized,
            document.createdAt,
            document.updatedAt,
          );
        } catch (error) {
          if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
            throw new WorldInstanceConflictError(document.id);
          }
          throw error;
        }
      })();
      const cached = this.cacheValidatedInstance(document.id, 1, serialized, document);
      this.observe?.({
        event: "persistence.write.completed",
        correlation: { ...correlation, instanceId: document.id },
        durationMs: Math.max(0, Date.now() - startedAt),
        measurements: { documentUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
        attributes: { sink: "sqlite", operation: "create" },
      });
      return { generation: 1, document: structuredClone(cached.document) };
    } catch (error) {
      this.observe?.({
        event: "persistence.write.failed",
        level: "error",
        correlation: { ...correlation, instanceId: document.id },
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { sink: "sqlite", operation: "create" },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
  }

  readInstance(instanceId: string, correlation?: RuntimeCorrelation): StoredWorldInstance {
    const startedAt = Date.now();
    const row = this.connection.prepare(
      "SELECT generation, document_json FROM world_instances WHERE id = ?",
    ).get(instanceId) as InstanceRow | undefined;
    if (!row) throw new WorldInstanceNotFoundError(instanceId);
    const cached = this.cachedInstance(instanceId, row);
    if (cached) {
      this.observeCachedRead(instanceId, cached, startedAt, correlation);
      return { generation: cached.generation, document: structuredClone(cached.document) };
    }
    const document = parseWorldInstanceDocument(
      row.document_json,
      instanceId,
    );
    this.cacheValidatedInstance(instanceId, row.generation, row.document_json, document);
    return {
      generation: row.generation,
      document,
    };
  }

  compareAndSwapInstance(
    instanceId: string,
    expectedGeneration: number,
    document: WorldInstanceDocument,
    correlation?: RuntimeCorrelation,
  ): StoredWorldInstance {
    if (document.id !== instanceId) throw new Error("instance document id mismatch");
    const startedAt = Date.now();
    const serialized = serializeWorldInstanceDocument(document);
    try {
      this.connection.transaction(() => {
        this.assertInstanceLease();
        const result = this.connection.prepare(`
          UPDATE world_instances
          SET generation = generation + 1,
              world_id = ?,
              world_hash = ?,
              document_json = ?,
              updated_at = ?
          WHERE id = ? AND generation = ?
        `).run(
          document.world.id,
          document.world.contentHash,
          serialized,
          document.updatedAt,
          instanceId,
          expectedGeneration,
        );
        if (result.changes !== 1) {
          const exists = this.connection.prepare("SELECT 1 FROM world_instances WHERE id = ?").get(instanceId);
          if (!exists) throw new WorldInstanceNotFoundError(instanceId);
          throw new WorldInstanceConflictError(instanceId);
        }
      })();
      const generation = expectedGeneration + 1;
      const cached = this.cacheValidatedInstance(instanceId, generation, serialized, document);
      this.observe?.({
        event: "persistence.write.completed",
        correlation: { ...correlation, instanceId },
        durationMs: Math.max(0, Date.now() - startedAt),
        measurements: { documentUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
        attributes: { sink: "sqlite", operation: "compare_and_swap" },
      });
      return { generation, document: structuredClone(cached.document) };
    } catch (error) {
      this.observe?.({
        event: "persistence.write.failed",
        level: "error",
        correlation: { ...correlation, instanceId },
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { sink: "sqlite", operation: "compare_and_swap" },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
  }

  private completeAtomicCommitEvent(
    event: RuntimeEvent,
    durationMs: number,
    documentUtf8Bytes: number,
  ): void {
    const measurements = {
      ...event.measurements,
      documentUtf8Bytes,
      sqliteWriteMs: durationMs,
    };
    const completed = { ...event, durationMs, measurements, payload: undefined };
    const result = this.connection.prepare(`
      UPDATE execution_events
      SET duration_ms = ?, measurements_json = ?, event_json = ?
      WHERE sequence = ? AND event_name = 'persistence.atomic_commit'
    `).run(
      durationMs,
      JSON.stringify(canonicalize(measurements)),
      JSON.stringify(canonicalize(completed)),
      event.sequence,
    );
    if (result.changes !== 1) throw new Error("atomic commit event update failed");
  }

  createInstanceAndFinishExecution(
    document: WorldInstanceDocument,
    executionId: string,
    finish: FinishExecutionInput,
    correlation?: RuntimeCorrelation,
  ): { instance: StoredWorldInstance; executionRef: import("../engine/execution").ExecutionRef } {
    this.executionWriters.get(executionId)?.flush();
    return this.connection.transaction(() => {
      const commitEvent = this.appendExecutionEvent(executionId, {
        event: "persistence.atomic_commit",
        attributes: { operation: "create", sink: "sqlite", phase: "commit", status: "completed" },
      });
      const expectedRef = this.currentExecutionRef(executionId);
      const finalizedDocument = structuredClone(document);
      finalizedDocument.state = attachExecutionRef(finalizedDocument.state, expectedRef, "bootstrap");
      const documentUtf8Bytes = Buffer.byteLength(JSON.stringify(canonicalize(finalizedDocument)), "utf8");
      const writeStartedAt = performance.now();
      const instance = this.createInstance(finalizedDocument, correlation);
      this.completeAtomicCommitEvent(
        commitEvent,
        Math.max(0, performance.now() - writeStartedAt),
        documentUtf8Bytes,
      );
      const executionRef = this.finishExecution(executionId, finish);
      if (contentHash(executionRef) !== contentHash(expectedRef)) throw new Error("execution reference changed during commit");
      return { instance, executionRef };
    })();
  }

  compareAndSwapInstanceAndFinishExecution(
    instanceId: string,
    expectedGeneration: number,
    document: WorldInstanceDocument,
    executionId: string,
    finish: FinishExecutionInput,
    phase: "step" | "admission" | "instance" = "step",
    correlation?: RuntimeCorrelation,
  ): { instance: StoredWorldInstance; executionRef: import("../engine/execution").ExecutionRef } {
    this.executionWriters.get(executionId)?.flush();
    return this.connection.transaction(() => {
      const commitEvent = this.appendExecutionEvent(executionId, {
        event: "persistence.atomic_commit",
        attributes: { operation: "compare_and_swap", sink: "sqlite", phase: "commit", status: "completed" },
      });
      const expectedRef = this.currentExecutionRef(executionId);
      const finalizedDocument = structuredClone(document);
      if (phase !== "instance") {
        finalizedDocument.state = attachExecutionRef(finalizedDocument.state, expectedRef, phase);
      }
      const documentUtf8Bytes = Buffer.byteLength(JSON.stringify(canonicalize(finalizedDocument)), "utf8");
      const writeStartedAt = performance.now();
      const instance = this.compareAndSwapInstance(
        instanceId,
        expectedGeneration,
        finalizedDocument,
        correlation,
      );
      this.completeAtomicCommitEvent(
        commitEvent,
        Math.max(0, performance.now() - writeStartedAt),
        documentUtf8Bytes,
      );
      const executionRef = this.finishExecution(executionId, finish);
      if (contentHash(executionRef) !== contentHash(expectedRef)) throw new Error("execution reference changed during commit");
      return { instance, executionRef };
    })();
  }

  listInstances(correlation?: RuntimeCorrelation): StoredWorldInstance[] {
    const rows = this.connection.prepare(
      "SELECT id, generation, document_json FROM world_instances ORDER BY id",
    ).all() as ListedInstanceRow[];
    const persistedIds = new Set(rows.map((row) => row.id));
    for (const instanceId of this.validatedInstances.keys()) {
      if (!persistedIds.has(instanceId)) this.validatedInstances.delete(instanceId);
    }
    const misses: Array<{ row: ListedInstanceRow; document: WorldInstanceDocument }> = [];
    const instances = rows.map((row): StoredWorldInstance => {
      const startedAt = Date.now();
      const cached = this.cachedInstance(row.id, row, false);
      if (cached) {
        this.observeCachedRead(row.id, cached, startedAt, correlation);
        return { generation: cached.generation, document: structuredClone(cached.document) };
      }
      const document = parseWorldInstanceDocument(
        row.document_json,
        row.id,
      );
      misses.push({ row, document });
      return { generation: row.generation, document };
    });
    for (const { row, document } of misses) {
      if (this.validatedInstances.size >= VALIDATED_INSTANCE_CACHE_LIMIT) break;
      this.cacheValidatedInstance(row.id, row.generation, row.document_json, document);
    }
    return instances;
  }

  deleteInstance(instanceId: string, expectedGeneration: number, correlation?: RuntimeCorrelation): void {
    const startedAt = Date.now();
    try {
      this.connection.transaction(() => {
        this.assertInstanceLease();
        const result = this.connection.prepare(
          "DELETE FROM world_instances WHERE id = ? AND generation = ?",
        ).run(instanceId, expectedGeneration);
        if (result.changes === 1) return;
        const exists = this.connection.prepare("SELECT 1 FROM world_instances WHERE id = ?").get(instanceId);
        if (!exists) throw new WorldInstanceNotFoundError(instanceId);
        throw new WorldInstanceConflictError(instanceId);
      })();
      this.validatedInstances.delete(instanceId);
      this.observe?.({
        event: "persistence.delete.completed",
        correlation: { ...correlation, instanceId },
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { sink: "sqlite" },
      });
    } catch (error) {
      this.observe?.({
        event: "persistence.delete.failed",
        level: "error",
        correlation: { ...correlation, instanceId },
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { sink: "sqlite" },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    for (const writer of this.executionWriters.values()) writer.flush();
    this.executionWriters.clear();
    this.closed = true;
    this.validatedInstances.clear();
    this.executionListeners.clear();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    try {
      this.connection.prepare("DELETE FROM instance_lock WHERE singleton = 1 AND owner_id = ?").run(this.ownerId);
    } finally {
      this.connection.close();
    }
  }
}
