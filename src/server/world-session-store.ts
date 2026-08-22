import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { validateSimulationState } from "../engine/transaction";
import type { WorldSessionDocument } from "./world-run-types";

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) throw new Error(`invalid ${label}: ${value}`);
}

const envelopeSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  document: z.object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    scriptId: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    state: z.unknown(),
    runs: z.record(z.string(), z.unknown()),
  }).strict(),
}).strict();

function checksum(json: string): string {
  return createHash("sha256").update(json).digest("hex");
}

function serialize(document: WorldSessionDocument): string {
  const documentJson = JSON.stringify(document);
  return JSON.stringify({ checksum: checksum(documentJson), document });
}

function parse(serialized: string): WorldSessionDocument {
  const envelope = envelopeSchema.parse(JSON.parse(serialized));
  const documentJson = JSON.stringify(envelope.document);
  if (checksum(documentJson) !== envelope.checksum) throw new Error("world session checksum mismatch");
  const document = envelope.document as WorldSessionDocument;
  try {
    validateSimulationState(document.state, true);
    for (const [runId, run] of Object.entries(document.runs)) {
      if (!run || typeof run !== "object") throw new Error(`invalid run ${runId}`);
      const candidate = run as WorldSessionDocument["runs"][string];
      if (candidate.id !== runId || candidate.sessionId !== document.id || !Array.isArray(candidate.events)) {
        throw new Error(`invalid run ${runId}`);
      }
    }
  } catch (error) {
    throw new Error(`invalid world session: ${error instanceof Error ? error.message : String(error)}`);
  }
  return document;
}

export interface WorldSessionStore {
  write(document: WorldSessionDocument): void;
  read(sessionId: string): WorldSessionDocument;
  list(): string[];
}

export class MemoryWorldSessionStore implements WorldSessionStore {
  private readonly values = new Map<string, string>();
  writeCount = 0;

  write(document: WorldSessionDocument): void {
    this.writeCount += 1;
    this.values.set(document.id, serialize(document));
  }

  read(sessionId: string): WorldSessionDocument {
    const serialized = this.values.get(sessionId);
    if (!serialized) throw new Error(`world session not found: ${sessionId}`);
    return parse(serialized);
  }

  list(): string[] {
    return [...this.values.keys()].sort();
  }
}

export class FileWorldSessionStore implements WorldSessionStore {
  constructor(readonly root: string) {}

  private file(sessionId: string): string {
    assertIdentifier(sessionId, "session id");
    return path.join(this.root, "sessions", `${sessionId}.json`);
  }

  write(document: WorldSessionDocument): void {
    const file = this.file(document.id);
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, serialize(document), "utf8");
    renameSync(temporary, file);
  }

  read(sessionId: string): WorldSessionDocument {
    const file = this.file(sessionId);
    if (!existsSync(file)) throw new Error(`world session not found: ${sessionId}`);
    return parse(readFileSync(file, "utf8"));
  }

  list(): string[] {
    const directory = path.join(this.root, "sessions");
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5))
      .sort();
  }
}
