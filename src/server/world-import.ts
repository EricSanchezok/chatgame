import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { loadWorldScript } from "../script/world-loader";

export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const MAX_ENTRY_COUNT = 5_000;
export const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;

export class WorldImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "WorldImportError";
  }
}

function safeEntryName(name: string): string {
  if (name.includes("\\") || name.includes("\0")) throw new WorldImportError(`unsafe archive entry: ${name}`);
  const normalized = path.posix.normalize(name);
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) {
    throw new WorldImportError(`unsafe archive entry: ${name}`);
  }
  return normalized.replace(/\/$/, "");
}

function locateRoot(staging: string): string {
  if (existsSync(path.join(staging, "script.yaml"))) return staging;
  const candidates = new Set<string>();
  for (const entry of readdirSync(staging, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(path.join(staging, entry.name, "script.yaml"))) {
      candidates.add(path.join(staging, entry.name));
    }
  }
  if (candidates.size !== 1) {
    throw new WorldImportError("archive must contain one world root with script.yaml");
  }
  return [...candidates][0];
}

function extractArchive(buffer: Buffer, staging: string): string {
  if (buffer.byteLength > MAX_ARCHIVE_BYTES) throw new WorldImportError("archive exceeds 50 MiB");
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (error) {
    throw new WorldImportError(`invalid zip archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  const entries = zip.getEntries();
  if (entries.length > MAX_ENTRY_COUNT) throw new WorldImportError("archive contains too many entries");
  let expandedBytes = 0;
  for (const entry of entries) {
    const name = safeEntryName(entry.entryName);
    if (!name) continue;
    const target = path.join(staging, ...name.split("/"));
    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    const data = entry.getData();
    expandedBytes += data.byteLength;
    if (expandedBytes > MAX_EXPANDED_BYTES) throw new WorldImportError("archive expands beyond 100 MiB");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
  return locateRoot(staging);
}

export interface WorldImportResult {
  id: string;
  name: string;
  description: string;
  replaced: boolean;
}

export function importWorldArchive(
  buffer: Buffer,
  scriptsRoot: string,
  replace = false,
): WorldImportResult {
  const resolvedRoot = path.resolve(scriptsRoot);
  mkdirSync(path.dirname(resolvedRoot), { recursive: true });
  const staging = mkdtempSync(path.join(path.dirname(resolvedRoot), ".chatgame-world-import-"));
  let backup: string | undefined;
  try {
    const source = extractArchive(buffer, staging);
    const definition = loadWorldScript(source, 1);
    mkdirSync(resolvedRoot, { recursive: true });
    const destination = path.join(resolvedRoot, definition.id);
    const exists = existsSync(destination);
    if (exists && !replace) throw new WorldImportError(`world ${definition.id} already exists`, 409);
    if (exists) {
      backup = `${destination}.backup-${randomUUID()}`;
      renameSync(destination, backup);
    }
    try {
      renameSync(source, destination);
    } catch (error) {
      if (backup && existsSync(/* turbopackIgnore: true */ backup)) renameSync(backup, destination);
      throw error;
    }
    if (backup) rmSync(backup, { recursive: true, force: true });
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      replaced: exists,
    };
  } catch (error) {
    if (error instanceof WorldImportError) throw error;
    throw new WorldImportError(error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
