// SaveStore: the storage abstraction for save files. The engine and host
// never touch filesystem details directly — they go through this interface,
// so a cloud backend (KV/Blob/Postgres) can replace the fs implementation
// later without touching serialization or session logic.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Storage contract for save files (one JSON document per runId). */
export interface SaveStore {
  /** Base directory of this store (undefined for non-fs backends). */
  readonly root?: string;
  /** Persists a save document under `<root>/saves/<scriptId>/<runId>.json`. */
  write(scriptId: string, runId: string, json: string): void;
  /** Reads a save document; throws when missing. */
  read(scriptId: string, runId: string): string;
  /** Lists existing saves for a script (runId basenames, newest first). */
  list(scriptId: string): Array<{ runId: string; updatedAt: string }>;
  /** Optional removal (unused today; cloud backends may support it). */
  delete?(scriptId: string, runId: string): void;
}

/**
 * Guards a runId: must be a plain basename ending in .json (no separators,
 * no traversal). Throws on anything else so store paths stay inside the
 * script's save directory.
 */
export function assertSafeRunId(runId: string): void {
  if (runId !== path.basename(runId) || !runId.endsWith(".json")) {
    throw new Error(`invalid save id: ${runId}`);
  }
}

/** Default save root (relative to repo): .chatgame/saves/<scriptId>/. */
export function saveDirForScript(scriptId: string, root = ".chatgame"): string {
  return path.join(root, "saves", scriptId);
}

/** Meta-progression root: <root>/meta/<scriptId>.json. */
export function metaPathForScript(scriptId: string, root = ".chatgame"): string {
  return path.join(root, "meta", `${scriptId}.json`);
}

/**
 * Filesystem SaveStore with atomic writes (temp file + rename) and
 * stat-based listing (no JSON parsing). `root` defaults to `.chatgame`
 * (the repo-local data dir); tests inject a temp root for isolation.
 */
export function createFsSaveStore(root = ".chatgame"): SaveStore {
  const base = (scriptId: string): string => path.join(root, "saves", scriptId);

  return {
    root,

    write(scriptId: string, runId: string, json: string): void {
      assertSafeRunId(runId);
      const dir = base(scriptId);
      mkdirSync(dir, { recursive: true });
      const target = path.join(dir, runId);
      const tmp = path.join(dir, `${runId}.tmp`);
      // Write the full document to a temp file, then atomically rename over
      // the target. A crash mid-write leaves only a stale .tmp, never a
      // half-written save (rename is atomic on POSIX/NTFS).
      writeFileSync(tmp, json, "utf8");
      renameSync(tmp, target);
    },

    read(scriptId: string, runId: string): string {
      assertSafeRunId(runId);
      const filePath = path.join(base(scriptId), runId);
      if (!existsSync(filePath)) {
        throw new Error(`save file not found: ${filePath}`);
      }
      return readFileSync(filePath, "utf8");
    },

    list(scriptId: string): Array<{ runId: string; updatedAt: string }> {
      const dir = base(scriptId);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const abs = path.join(dir, f);
          let updatedAt = "";
          try {
            updatedAt = statSync(abs).mtime.toISOString();
          } catch {
            // Stat failed (vanished between readdir and stat): keep the
            // filename with an empty timestamp rather than crashing the list.
          }
          return { runId: f, updatedAt };
        })
        .sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));
    },
  };
}

/** Default store: repo-local .chatgame directory. */
export const fsSaveStore: SaveStore = createFsSaveStore();

/**
 * Store rooted at an explicit data root (or the repo-local `.chatgame`
 * directory). The host singleton uses this so CHATGAME_DATA_ROOT can
 * relocate saves/meta outside the repo (tests, deployments).
 */
export function createDataStore(dataRoot?: string): SaveStore {
  return createFsSaveStore(dataRoot ? path.resolve(dataRoot) : ".chatgame");
}
