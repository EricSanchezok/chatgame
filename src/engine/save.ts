// Save system: WorldState <-> JSON serialization + version gate +
// persistence. Saves are plain JSON snapshots (immutable state makes this
// trivial). Agile mode: no backward compatibility — only the current
// schema version is accepted and stale saves are rejected.
//
// All filesystem access goes through the SaveStore abstraction
// (src/engine/save-store.ts): callers never touch fs details directly,
// and writes are atomic (temp + rename).
import path from "node:path";
import type { SaveFile, WorldState, WorldDefinition } from "./types";
import { emptyContextSummary } from "./context";
import { fsSaveStore, saveDirForScript as storeSaveDir, type SaveStore } from "./save-store";

/** Bump on breaking WorldState shape changes. Older versions are rejected. */
export const SAVE_SCHEMA_VERSION = 4;

export class SaveError extends Error {}

/** Default save root (relative to repo): .chatgame/saves/<scriptId>/. */
export function saveDirForScript(scriptId: string): string {
  return storeSaveDir(scriptId);
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
 * Throws SaveError on any version mismatch (no migration — agile mode).
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

/** Writes a save file via the SaveStore (atomic write; path unchanged). */
export function writeSave(
  definition: WorldDefinition,
  state: WorldState,
  runId?: string,
  store: SaveStore = fsSaveStore,
): string {
  const id = runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const save = serializeSave(definition, state);
  store.write(definition.script.id, `${id}.json`, JSON.stringify(save, null, 2));
  // The returned path mirrors the store's root so callers can locate the
  // file regardless of which backend (or test root) is in use.
  return path.join(storeSaveDir(definition.script.id, store.root ?? ".chatgame"), `${id}.json`);
}

/**
 * Reads a save file from its absolute path (the caller owns the path;
 * the store owns the fs access). Version/script gates still apply.
 */
export function readSave(
  filePath: string,
  expectedScriptId?: string,
  store: SaveStore = fsSaveStore,
): SaveFile {
  const runId = path.basename(filePath);
  const scriptId = expectedScriptId ?? path.basename(path.dirname(filePath));
  let raw: unknown;
  try {
    raw = JSON.parse(store.read(scriptId, runId)) as unknown;
  } catch (err) {
    if (err instanceof SaveError) throw err;
    if (err instanceof Error && err.message.includes("not found")) {
      throw new SaveError(`save file not found: ${filePath}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new SaveError(`save file is not valid JSON: ${message}`);
  }
  return deserializeSave(raw, expectedScriptId);
}

/** Lists existing save files for a script (sorted newest-first). */
export function listSaves(
  scriptId: string,
  store: SaveStore = fsSaveStore,
): string[] {
  return store.list(scriptId).map((s) => s.runId);
}

/**
 * Save file metadata (filename + mtime) for the launcher's continue list.
 * Uses stat.mtime only — no JSON parsing per save.
 */
export function saveSummaries(
  scriptId: string,
  store: SaveStore = fsSaveStore,
): Array<{ runId: string; updatedAt: string }> {
  return store.list(scriptId);
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

/**
 * Normalizes a world state against its definition: fills any missing
 * derived fields (locationInventories from locations[].items, secretHolders
 * from NPC secrets) so every v2 snapshot is complete. No-op on fresh saves.
 */
export function normalizeWorldState(
  definition: WorldDefinition,
  state: WorldState,
): WorldState {
  let next = state;
  if (!next.locationInventories) {
    const locationInventories: Record<string, WorldState["locationInventories"][string]> = {};
    for (const loc of definition.locations.values()) {
      locationInventories[loc.id] = {
        stacks: (loc.items ?? []).map((itemId) => ({ itemId, quantity: 1 })),
        currency: 0,
      };
    }
    next = { ...next, locationInventories };
  }
  if (!next.secretHolders) {
    const secretHolders: Record<string, string> = {};
    for (const npcDef of definition.npcs.values()) {
      for (const secret of npcDef.secrets ?? []) {
        secretHolders[secret.id] = npcDef.id;
      }
    }
    next = { ...next, secretHolders };
  }
  if (!next.playedEventIds) next = { ...next, playedEventIds: [] };
  if (!next.eventLastPlayedDay) next = { ...next, eventLastPlayedDay: {} };
  if (!next.actionCooldowns) next = { ...next, actionCooldowns: {} };
  if (!next.transcript) next = { ...next, transcript: [] };
  if (!next.contextSummary) next = { ...next, contextSummary: emptyContextSummary() };
  return next;
}
