// Save system: WorldState <-> JSON serialization + version validation +
// filesystem persistence. Saves are plain JSON snapshots (immutable state
// makes this trivial) with a version gate — unknown versions are rejected
// (migration tooling is a later blueprint).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { SaveFile, WorldState, WorldDefinition } from "./types";

/** Bump on breaking WorldState shape changes. */
export const SAVE_SCHEMA_VERSION = 1;

export class SaveError extends Error {}

/** Default save root (relative to repo): .chatgame/saves/<scriptId>/. */
export function saveDirForScript(scriptId: string): string {
  return path.join(".chatgame", "saves", scriptId);
}

/**
 * Serializes a world state to a save file object. Uses a stable JSON
 * serialization (deep-copied plain object) so save->load round-trips are
 * deep-equal.
 */
export function serializeSave(
  definition: WorldDefinition,
  state: WorldState,
  createdAt?: string,
): SaveFile {
  const now = createdAt ?? new Date().toISOString();
  return {
    saveSchemaVersion: SAVE_SCHEMA_VERSION,
    scriptId: definition.script.id,
    createdAt: now,
    updatedAt: now,
    worldState: JSON.parse(JSON.stringify(state)) as WorldState,
  };
}

/**
 * Deserializes a save file, validating the schema version and script id.
 * Throws SaveError on unknown versions or mismatched script.
 */
export function deserializeSave(
  data: unknown,
  expectedScriptId?: string,
): SaveFile {
  if (!data || typeof data !== "object") {
    throw new SaveError("save file is not an object");
  }
  const save = data as Partial<SaveFile>;
  if (save.saveSchemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new SaveError(
      `save schema version ${String(save.saveSchemaVersion)} is not supported (expected ${SAVE_SCHEMA_VERSION})`,
    );
  }
  if (typeof save.scriptId !== "string") {
    throw new SaveError("save file is missing scriptId");
  }
  if (expectedScriptId && save.scriptId !== expectedScriptId) {
    throw new SaveError(
      `save is for script "${save.scriptId}" but expected "${expectedScriptId}"`,
    );
  }
  if (!save.worldState || typeof save.worldState !== "object") {
    throw new SaveError("save file is missing worldState");
  }
  return save as SaveFile;
}

/** Writes a save file to disk under .chatgame/saves/<scriptId>/<runId>.json. */
export function writeSave(
  definition: WorldDefinition,
  state: WorldState,
  runId?: string,
): string {
  const id = runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const dir = saveDirForScript(definition.script.id);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.json`);
  const save = serializeSave(definition, state);
  writeFileSync(filePath, JSON.stringify(save, null, 2), "utf8");
  return filePath;
}

/** Reads a save file from disk. */
export function readSave(filePath: string, expectedScriptId?: string): SaveFile {
  if (!existsSync(filePath)) {
    throw new SaveError(`save file not found: ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SaveError(`save file is not valid JSON: ${message}`);
  }
  return deserializeSave(raw, expectedScriptId);
}

/** Lists existing save files for a script (sorted newest-first). */
export function listSaves(scriptId: string): string[] {
  const dir = saveDirForScript(scriptId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
}

/**
 * Round-trip helper: serialize + deserialize and return the restored state.
 * Used by tests to assert save/load stability.
 */
export function roundTrip(state: WorldState, definition: WorldDefinition): WorldState {
  const save = serializeSave(definition, state);
  const restored = deserializeSave(save, definition.script.id);
  return restored.worldState;
}
