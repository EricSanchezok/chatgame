import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { canonicalize } from "../engine/model-audit";
import type { ModelCatalog } from "../engine/model-catalog";
import {
  NOOP_RUNTIME_OBSERVER,
  runtimeEventEmitter,
  serializeRuntimeError,
  type RuntimeCorrelation,
  type RuntimeObserver,
} from "../engine/observability";
import { createCoreRulePackageRegistry, type RulePackageRegistry } from "../engine/rule-package";
import { buildWorldDefinition, hashWorldTemplate, parseWorldTemplate } from "../script/world-loader";
import type { WorldCatalogEntry, WorldRepository } from "../script/world-repository";
import { parseWorldArchive, WorldImportError, type WorldImportResult } from "./world-import";
import {
  parseWorldSessionDocument,
  serializeWorldSessionDocument,
  WorldSessionConflictError,
  WorldSessionNotFoundError,
  type StoredWorldSession,
  type WorldSessionStore,
} from "./world-session-store";
import type { WorldSessionDocument } from "./world-run-types";

const INSTANCE_HEARTBEAT_MS = 5_000;
const INSTANCE_LEASE_MS = 15_000;
const VALIDATED_SESSION_CACHE_LIMIT = 8;

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

interface SessionRow {
  generation: number;
  document_json: string;
}

interface ListedSessionRow extends SessionRow {
  id: string;
}

interface ValidatedSessionCacheEntry {
  generation: number;
  serialized: string;
  documentUtf8Bytes: number;
  document: WorldSessionDocument;
}

interface LockRow {
  owner_id: string;
  expires_at: number;
}

export class LocalDatabaseInUseError extends Error {
  constructor(file: string) {
    super(`local database is already owned by another Living World Engine instance: ${file}`);
    this.name = "LocalDatabaseInUseError";
  }
}

export class LocalDatabase implements WorldRepository, WorldSessionStore {
  readonly rulePackages: RulePackageRegistry;
  private readonly connection: Database.Database;
  private readonly ownerId: string;
  private readonly now: () => number;
  private readonly heartbeatTimer?: NodeJS.Timeout;
  private readonly observer: RuntimeObserver;
  private readonly observe: ReturnType<typeof runtimeEventEmitter>;
  private readonly validatedSessions = new Map<string, ValidatedSessionCacheEntry>();
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
      this.migrate();
      this.acquireInstanceLease();
    } catch (error) {
      this.connection.close();
      throw error;
    }
    if (options.heartbeat !== false) {
      this.heartbeatTimer = setInterval(() => this.renewInstanceLease(), INSTANCE_HEARTBEAT_MS);
      this.heartbeatTimer.unref();
    }
  }

  private cacheValidatedSession(
    sessionId: string,
    generation: number,
    serialized: string,
    document: WorldSessionDocument,
  ): ValidatedSessionCacheEntry {
    const entry = {
      generation,
      serialized,
      documentUtf8Bytes: Buffer.byteLength(serialized, "utf8"),
      document: structuredClone(document),
    };
    this.validatedSessions.delete(sessionId);
    this.validatedSessions.set(sessionId, entry);
    while (this.validatedSessions.size > VALIDATED_SESSION_CACHE_LIMIT) {
      const oldestSessionId = this.validatedSessions.keys().next().value;
      if (oldestSessionId === undefined) break;
      this.validatedSessions.delete(oldestSessionId);
    }
    return entry;
  }

  private cachedSession(
    sessionId: string,
    row: SessionRow,
    promote = true,
  ): ValidatedSessionCacheEntry | undefined {
    const cached = this.validatedSessions.get(sessionId);
    if (!cached || cached.generation !== row.generation || cached.serialized !== row.document_json) {
      if (cached) this.validatedSessions.delete(sessionId);
      return undefined;
    }
    if (promote) {
      this.validatedSessions.delete(sessionId);
      this.validatedSessions.set(sessionId, cached);
    }
    return cached;
  }

  private observeCachedRead(
    sessionId: string,
    cached: ValidatedSessionCacheEntry,
    startedAt: number,
    correlation?: RuntimeCorrelation,
  ): void {
    this.observe?.({
      event: "persistence.read.completed",
      correlation: { ...correlation, sessionId },
      durationMs: Math.max(0, Date.now() - startedAt),
      attributes: { sink: "sqlite", cacheHit: true },
      measurements: { documentUtf8Bytes: cached.documentUtf8Bytes },
      counts: {
        history: cached.document.state.history.length,
        runs: Object.keys(cached.document.runs).length,
      },
    });
  }

  private migrate(): void {
    this.connection.transaction(() => {
      this.connection.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        ) STRICT;
      `);
      const current = this.connection.prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get() as { version: number | null };
      if ((current.version ?? 0) > 1) throw new Error("local database schema is newer than this application");
      if ((current.version ?? 0) === 1) return;
      this.connection.exec(`
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
        CREATE TABLE world_sessions (
          id TEXT PRIMARY KEY,
          generation INTEGER NOT NULL CHECK (generation > 0),
          world_id TEXT NOT NULL,
          world_hash TEXT NOT NULL,
          document_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE INDEX world_sessions_world_version
          ON world_sessions(world_id, world_hash);
      `);
      this.connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)")
        .run(new Date(this.now()).toISOString());
    })();
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
    if (!lock || lock.owner_id !== this.ownerId || lock.expires_at <= this.now()) {
      throw new LocalDatabaseInUseError(this.file);
    }
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

  importWorld(buffer: Buffer, modelCatalog: ModelCatalog, replace = false): WorldImportResult {
    const archive = parseWorldArchive(buffer, modelCatalog, this.rulePackages);
    return this.connection.transaction(() => {
      this.assertInstanceLease();
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

  create(document: WorldSessionDocument, correlation?: RuntimeCorrelation): StoredWorldSession {
    const startedAt = Date.now();
    const serialized = serializeWorldSessionDocument(document, this.observer, correlation);
    try {
      this.connection.transaction(() => {
        this.assertInstanceLease();
        try {
          this.connection.prepare(`
            INSERT INTO world_sessions(
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
            throw new WorldSessionConflictError(document.id);
          }
          throw error;
        }
      })();
      const cached = this.cacheValidatedSession(document.id, 1, serialized, document);
      this.observe?.({
        event: "persistence.write.completed",
        correlation: { ...correlation, sessionId: document.id },
        durationMs: Math.max(0, Date.now() - startedAt),
        measurements: { documentUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
        attributes: { sink: "sqlite", operation: "create" },
      });
      return { generation: 1, document: structuredClone(cached.document) };
    } catch (error) {
      this.observe?.({
        event: "persistence.write.failed",
        level: "error",
        correlation: { ...correlation, sessionId: document.id },
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { sink: "sqlite", operation: "create" },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
  }

  read(sessionId: string, correlation?: RuntimeCorrelation): StoredWorldSession {
    const startedAt = Date.now();
    const row = this.connection.prepare(
      "SELECT generation, document_json FROM world_sessions WHERE id = ?",
    ).get(sessionId) as SessionRow | undefined;
    if (!row) throw new WorldSessionNotFoundError(sessionId);
    const cached = this.cachedSession(sessionId, row);
    if (cached) {
      this.observeCachedRead(sessionId, cached, startedAt, correlation);
      return { generation: cached.generation, document: structuredClone(cached.document) };
    }
    const document = parseWorldSessionDocument(
      row.document_json,
      sessionId,
      this.observer,
      correlation,
      { sink: "sqlite", cacheHit: false },
    );
    this.cacheValidatedSession(sessionId, row.generation, row.document_json, document);
    return {
      generation: row.generation,
      document,
    };
  }

  compareAndSwap(
    sessionId: string,
    expectedGeneration: number,
    document: WorldSessionDocument,
    correlation?: RuntimeCorrelation,
  ): StoredWorldSession {
    if (document.id !== sessionId) throw new Error("session document id mismatch");
    const startedAt = Date.now();
    const serialized = serializeWorldSessionDocument(document, this.observer, correlation);
    try {
      this.connection.transaction(() => {
        this.assertInstanceLease();
        const result = this.connection.prepare(`
          UPDATE world_sessions
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
          sessionId,
          expectedGeneration,
        );
        if (result.changes !== 1) {
          const exists = this.connection.prepare("SELECT 1 FROM world_sessions WHERE id = ?").get(sessionId);
          if (!exists) throw new WorldSessionNotFoundError(sessionId);
          throw new WorldSessionConflictError(sessionId);
        }
      })();
      const generation = expectedGeneration + 1;
      const cached = this.cacheValidatedSession(sessionId, generation, serialized, document);
      this.observe?.({
        event: "persistence.write.completed",
        correlation: { ...correlation, sessionId },
        durationMs: Math.max(0, Date.now() - startedAt),
        measurements: { documentUtf8Bytes: Buffer.byteLength(serialized, "utf8") },
        attributes: { sink: "sqlite", operation: "compare_and_swap" },
      });
      return { generation, document: structuredClone(cached.document) };
    } catch (error) {
      this.observe?.({
        event: "persistence.write.failed",
        level: "error",
        correlation: { ...correlation, sessionId },
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { sink: "sqlite", operation: "compare_and_swap" },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
  }

  listSessions(correlation?: RuntimeCorrelation): StoredWorldSession[] {
    const rows = this.connection.prepare(
      "SELECT id, generation, document_json FROM world_sessions ORDER BY id",
    ).all() as ListedSessionRow[];
    const persistedIds = new Set(rows.map((row) => row.id));
    for (const sessionId of this.validatedSessions.keys()) {
      if (!persistedIds.has(sessionId)) this.validatedSessions.delete(sessionId);
    }
    const misses: Array<{ row: ListedSessionRow; document: WorldSessionDocument }> = [];
    const sessions = rows.map((row): StoredWorldSession => {
      const startedAt = Date.now();
      const cached = this.cachedSession(row.id, row, false);
      if (cached) {
        this.observeCachedRead(row.id, cached, startedAt, correlation);
        return { generation: cached.generation, document: structuredClone(cached.document) };
      }
      const document = parseWorldSessionDocument(
        row.document_json,
        row.id,
        this.observer,
        correlation,
        { sink: "sqlite", cacheHit: false },
      );
      misses.push({ row, document });
      return { generation: row.generation, document };
    });
    for (const { row, document } of misses) {
      if (this.validatedSessions.size >= VALIDATED_SESSION_CACHE_LIMIT) break;
      this.cacheValidatedSession(row.id, row.generation, row.document_json, document);
    }
    return sessions;
  }

  delete(sessionId: string, expectedGeneration: number, correlation?: RuntimeCorrelation): void {
    const startedAt = Date.now();
    try {
      this.connection.transaction(() => {
        this.assertInstanceLease();
        const result = this.connection.prepare(
          "DELETE FROM world_sessions WHERE id = ? AND generation = ?",
        ).run(sessionId, expectedGeneration);
        if (result.changes === 1) return;
        const exists = this.connection.prepare("SELECT 1 FROM world_sessions WHERE id = ?").get(sessionId);
        if (!exists) throw new WorldSessionNotFoundError(sessionId);
        throw new WorldSessionConflictError(sessionId);
      })();
      this.validatedSessions.delete(sessionId);
      this.observe?.({
        event: "persistence.delete.completed",
        correlation: { ...correlation, sessionId },
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { sink: "sqlite" },
      });
    } catch (error) {
      this.observe?.({
        event: "persistence.delete.failed",
        level: "error",
        correlation: { ...correlation, sessionId },
        durationMs: Math.max(0, Date.now() - startedAt),
        attributes: { sink: "sqlite" },
        error: serializeRuntimeError(error),
      });
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.validatedSessions.clear();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    try {
      this.connection.prepare("DELETE FROM instance_lock WHERE singleton = 1 AND owner_id = ?").run(this.ownerId);
    } finally {
      this.connection.close();
    }
  }
}
