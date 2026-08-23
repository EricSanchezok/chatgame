import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { canonicalize } from "../engine/model-audit";
import type { ModelCatalog } from "../engine/model-catalog";
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

interface LocalDatabaseOptions {
  ownerId?: string;
  now?: () => number;
  heartbeat?: boolean;
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

interface LockRow {
  owner_id: string;
  expires_at: number;
}

export class LocalDatabaseInUseError extends Error {
  constructor(file: string) {
    super(`local database is already owned by another chatgame instance: ${file}`);
    this.name = "LocalDatabaseInUseError";
  }
}

export class LocalDatabase implements WorldRepository, WorldSessionStore {
  private readonly connection: Database.Database;
  private readonly ownerId: string;
  private readonly now: () => number;
  private readonly heartbeatTimer?: NodeJS.Timeout;
  private closed = false;

  constructor(readonly file: string, options: LocalDatabaseOptions = {}) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.connection = new Database(file, { timeout: 5_000 });
    this.ownerId = options.ownerId ?? `${process.pid}:${randomUUID()}`;
    this.now = options.now ?? Date.now;
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
    const template = parseWorldTemplate(JSON.parse(row.template_json));
    if (hashWorldTemplate(template) !== row.content_hash) throw new Error(`world ${worldId} content hash mismatch`);
    return buildWorldDefinition(template, { seed, modelCatalog });
  }

  importWorld(buffer: Buffer, modelCatalog: ModelCatalog, replace = false): WorldImportResult {
    const archive = parseWorldArchive(buffer, modelCatalog);
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

  create(document: WorldSessionDocument): StoredWorldSession {
    const serialized = serializeWorldSessionDocument(document);
    return this.connection.transaction(() => {
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
      return { generation: 1, document: parseWorldSessionDocument(serialized, document.id) };
    })();
  }

  read(sessionId: string): StoredWorldSession {
    const row = this.connection.prepare(
      "SELECT generation, document_json FROM world_sessions WHERE id = ?",
    ).get(sessionId) as SessionRow | undefined;
    if (!row) throw new WorldSessionNotFoundError(sessionId);
    return { generation: row.generation, document: parseWorldSessionDocument(row.document_json, sessionId) };
  }

  compareAndSwap(
    sessionId: string,
    expectedGeneration: number,
    document: WorldSessionDocument,
  ): StoredWorldSession {
    if (document.id !== sessionId) throw new Error("session document id mismatch");
    const serialized = serializeWorldSessionDocument(document);
    return this.connection.transaction(() => {
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
      return { generation: expectedGeneration + 1, document: parseWorldSessionDocument(serialized, sessionId) };
    })();
  }

  listSessions(): StoredWorldSession[] {
    const ids = this.connection.prepare("SELECT id FROM world_sessions ORDER BY id").all() as Array<{ id: string }>;
    return ids.map(({ id }) => this.read(id));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    try {
      this.connection.prepare("DELETE FROM instance_lock WHERE singleton = 1 AND owner_id = ?").run(this.ownerId);
    } finally {
      this.connection.close();
    }
  }
}
