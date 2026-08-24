import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type { RuntimeEvent } from "../engine/observability";
import { RUNTIME_LOG_FILE_PATTERN } from "./runtime-observer";

interface IndexedSegment {
  degraded: boolean;
  lines: IndexedRuntimeLine[];
  mtimeMs: number;
  offset: number;
  remainder: Buffer;
}

interface IndexedRuntimeLine {
  length: number;
  offset: number;
  sessionId?: string;
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<RuntimeEvent>;
  return event.schemaVersion === 1 && Number.isSafeInteger(event.sequence) &&
    typeof event.timestamp === "string" && typeof event.level === "string" &&
    typeof event.event === "string";
}

function readRange(target: string, start: number, size: number): Buffer {
  if (size <= 0) return Buffer.alloc(0);
  const fd = openSync(target, "r");
  try {
    const buffer = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const read = readSync(fd, buffer, offset, size - offset, start + offset);
      if (read <= 0) break;
      offset += read;
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

function readIndexedEvents(target: string, lines: readonly IndexedRuntimeLine[]): RuntimeEvent[] {
  if (lines.length === 0) return [];
  const fd = openSync(target, "r");
  try {
    return lines.map((line) => {
      const buffer = Buffer.allocUnsafe(line.length);
      let offset = 0;
      while (offset < line.length) {
        const read = readSync(fd, buffer, offset, line.length - offset, line.offset + offset);
        if (read <= 0) throw new Error("runtime trace line was truncated during inspection");
        offset += read;
      }
      const parsed: unknown = JSON.parse(buffer.toString("utf8"));
      if (!isRuntimeEvent(parsed)) throw new Error("runtime trace line changed during inspection");
      return parsed;
    });
  } finally {
    closeSync(fd);
  }
}

export class RuntimeTraceIndex {
  private readonly segments = new Map<string, IndexedSegment>();

  constructor(readonly directory: string) {}

  get degraded(): boolean {
    return [...this.segments.values()].some((segment) => segment.degraded);
  }

  refresh(): void {
    if (!existsSync(this.directory)) {
      this.segments.clear();
      return;
    }
    const names = readdirSync(this.directory)
      .filter((name) => RUNTIME_LOG_FILE_PATTERN.test(name))
      .sort();
    const retained = new Set(names);
    for (const name of this.segments.keys()) {
      if (!retained.has(name)) this.segments.delete(name);
    }
    for (const name of names) {
      const target = path.join(this.directory, name);
      const stat = statSync(target);
      let segment = this.segments.get(name);
      if (!segment || stat.size < segment.offset) {
        segment = { degraded: false, lines: [], mtimeMs: 0, offset: 0, remainder: Buffer.alloc(0) };
        this.segments.set(name, segment);
      }
      if (stat.size === segment.offset && stat.mtimeMs === segment.mtimeMs) continue;
      const next = Buffer.concat([segment.remainder, readRange(target, segment.offset, stat.size - segment.offset)]);
      const nextOffset = segment.offset - segment.remainder.length;
      let lineStart = 0;
      for (let index = 0; index < next.length; index += 1) {
        if (next[index] !== 0x0a) continue;
        const currentLineStart = lineStart;
        const line = next.subarray(currentLineStart, index).toString("utf8");
        lineStart = index + 1;
        if (!line.trim()) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (isRuntimeEvent(parsed)) {
            segment.lines.push({
              offset: nextOffset + currentLineStart,
              length: index - currentLineStart,
              ...(parsed.correlation?.sessionId ? { sessionId: parsed.correlation.sessionId } : {}),
            });
          } else segment.degraded = true;
        } catch {
          // A malformed diagnostic line is a trace gap, not a game failure.
          segment.degraded = true;
        }
      }
      segment.remainder = next.subarray(lineStart);
      segment.offset = stat.size;
      segment.mtimeMs = stat.mtimeMs;
    }
  }

  events(sessionId?: string): RuntimeEvent[] {
    this.refresh();
    return [...this.segments.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([name, segment]) => {
        const lines = sessionId
          ? segment.lines.filter((line) => line.sessionId === sessionId)
          : segment.lines;
        try {
          return readIndexedEvents(path.join(this.directory, name), lines);
        } catch {
          segment.degraded = true;
          return [];
        }
      })
      .map((event) => structuredClone(event));
  }
}
