import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import {
  NOOP_RUNTIME_OBSERVER,
  materializeRuntimeEvent,
  type RuntimeEvent,
  type RuntimeEventInput,
  type RuntimeObservabilityMode,
  type RuntimeObserver,
} from "../engine/observability";

const DEFAULT_SEGMENT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const LOG_FILE_PATTERN = /^livingworld-\d{8}T\d{6}\.\d{3}Z-\d+-\d{4,}\.ndjson$/;

export interface RuntimeObservabilityConfig {
  mode: RuntimeObservabilityMode;
  directory: string;
  segmentBytes: number;
  maxBytes: number;
}

export interface NdjsonRuntimeObserverOptions extends RuntimeObservabilityConfig {
  now?: () => Date;
  pid?: number;
  stdout?: { write(chunk: string): unknown };
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

export function readRuntimeObservabilityConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): RuntimeObservabilityConfig {
  const rawMode = env.LIVINGWORLD_OBSERVABILITY ?? "off";
  if (rawMode !== "off" && rawMode !== "metrics" && rawMode !== "full") {
    throw new Error("LIVINGWORLD_OBSERVABILITY must be off, metrics, or full");
  }
  const dataRoot = env.LIVINGWORLD_DATA_ROOT
    ? path.resolve(cwd, env.LIVINGWORLD_DATA_ROOT)
    : path.resolve(cwd, ".livingworld");
  const directory = env.LIVINGWORLD_OBSERVABILITY_DIR
    ? path.resolve(cwd, env.LIVINGWORLD_OBSERVABILITY_DIR)
    : path.join(dataRoot, "logs");
  if (rawMode === "off") {
    return {
      mode: rawMode,
      directory,
      segmentBytes: DEFAULT_SEGMENT_BYTES,
      maxBytes: DEFAULT_MAX_BYTES,
    };
  }
  const segmentBytes = positiveInteger(
    env.LIVINGWORLD_OBSERVABILITY_SEGMENT_BYTES,
    DEFAULT_SEGMENT_BYTES,
    "LIVINGWORLD_OBSERVABILITY_SEGMENT_BYTES",
  );
  const maxBytes = positiveInteger(
    env.LIVINGWORLD_OBSERVABILITY_MAX_BYTES,
    DEFAULT_MAX_BYTES,
    "LIVINGWORLD_OBSERVABILITY_MAX_BYTES",
  );
  if (maxBytes < segmentBytes) {
    throw new Error("LIVINGWORLD_OBSERVABILITY_MAX_BYTES must be at least the segment size");
  }
  return { mode: rawMode, directory, segmentBytes, maxBytes };
}

export class NdjsonRuntimeObserver implements RuntimeObserver {
  readonly mode: Exclude<RuntimeObservabilityMode, "off">;
  private readonly directory: string;
  private readonly segmentBytes: number;
  private readonly maxBytes: number;
  private readonly now: () => Date;
  private readonly pid: number;
  private readonly stdout: { write(chunk: string): unknown };
  private readonly startedAt: string;
  private sequence = 0;
  private segment = 0;
  private fd: number | undefined;
  private activePath: string | undefined;
  private activeBytes = 0;
  private eventCount = 0;
  private logBytes = 0;
  private serializationMs = 0;
  private sinkErrors = 0;
  private closed = false;
  private isWritingHealth = false;
  degraded = false;

  constructor(options: NdjsonRuntimeObserverOptions) {
    if (options.mode === "off") throw new Error("NDJSON observer requires an enabled mode");
    this.mode = options.mode;
    this.directory = options.directory;
    this.segmentBytes = options.segmentBytes;
    this.maxBytes = options.maxBytes;
    this.now = options.now ?? (() => new Date());
    this.pid = options.pid ?? process.pid;
    this.stdout = options.stdout ?? process.stdout;
    this.startedAt = this.now().toISOString().replace(/[:-]/g, "");
    mkdirSync(this.directory, { recursive: true });
    this.openNextSegment();
  }

  emit(input: RuntimeEventInput): RuntimeEvent | undefined {
    if (this.closed) return undefined;
    const event = materializeRuntimeEvent(input, ++this.sequence, this.now(), this.mode);
    const serializeStartedAt = performance.now();
    let line: string;
    try {
      line = `${JSON.stringify(event)}\n`;
    } catch (error) {
      this.sinkErrors += 1;
      const fallback: RuntimeEvent = {
        schemaVersion: 1,
        sequence: event.sequence,
        timestamp: event.timestamp,
        level: "error",
        event: "observability.serialization_failed",
        attributes: { sourceEvent: input.event },
        error: {
          name: error instanceof Error ? error.name : "NonError",
          message: error instanceof Error ? error.message : String(error),
        },
      };
      line = `${JSON.stringify(fallback)}\n`;
    }
    this.serializationMs += performance.now() - serializeStartedAt;
    const bytes = Buffer.byteLength(line, "utf8");
    const shouldRotate = !this.degraded && this.activeBytes > 0 &&
      (this.activeBytes >= this.segmentBytes || this.activeBytes + bytes > this.segmentBytes);
    let rotated = false;
    if (shouldRotate) {
      this.rotate();
      rotated = true;
    }
    this.writeLine(line, bytes);
    this.eventCount += 1;
    this.logBytes += bytes;
    if (!this.degraded && bytes > this.segmentBytes) {
      this.rotate();
      rotated = true;
    }
    if (rotated && !this.isWritingHealth) this.emitHealth("rotation");
    return event;
  }

  close(): void {
    if (this.closed) return;
    const priorSinkErrors = this.sinkErrors;
    this.emitHealth("shutdown");
    this.flushAndClose();
    if (this.sinkErrors > priorSinkErrors) this.emitHealth("shutdown");
    this.closed = true;
  }

  private fileName(segment: number): string {
    return `livingworld-${this.startedAt}-${this.pid}-${String(segment).padStart(4, "0")}.ndjson`;
  }

  private openNextSegment(): void {
    this.segment += 1;
    const target = path.join(this.directory, this.fileName(this.segment));
    const fd = openSync(target, "wx", 0o600);
    this.fd = fd;
    try {
      this.activePath = target;
      this.activeBytes = fstatSync(fd).size;
      this.pruneOldSegments();
    } catch (error) {
      this.fd = undefined;
      this.activePath = undefined;
      this.activeBytes = 0;
      try {
        closeSync(fd);
      } catch {
        this.sinkErrors += 1;
      }
      throw error;
    }
  }

  private rotate(): void {
    this.flushAndClose();
    if (this.degraded) {
      this.activePath = undefined;
      this.activeBytes = 0;
      return;
    }
    try {
      this.openNextSegment();
    } catch {
      this.sinkErrors += 1;
      this.degraded = true;
      this.fd = undefined;
      this.activePath = undefined;
      this.activeBytes = 0;
    }
  }

  private writeLine(line: string, bytes: number): void {
    try {
      this.stdout.write(line);
    } catch {
      this.sinkErrors += 1;
    }
    if (this.degraded || this.fd === undefined) return;
    try {
      const buffer = Buffer.from(line, "utf8");
      let offset = 0;
      while (offset < buffer.length) {
        const written = writeSync(this.fd, buffer, offset, buffer.length - offset);
        if (written <= 0) throw new Error("runtime log file write made no progress");
        offset += written;
      }
      this.activeBytes += bytes;
    } catch {
      this.sinkErrors += 1;
      this.degraded = true;
      this.flushAndClose();
    }
  }

  private emitHealth(reason: "rotation" | "shutdown"): void {
    if (this.isWritingHealth) return;
    this.isWritingHealth = true;
    try {
      this.emit({
        event: "observability.health",
        level: this.degraded ? "warn" : "info",
        attributes: { reason, mode: this.mode, degraded: this.degraded },
        counts: { events: this.eventCount, sinkErrors: this.sinkErrors },
        measurements: {
          logBytes: this.logBytes,
          serializationMs: Number(this.serializationMs.toFixed(3)),
          activeSegmentBytes: this.activeBytes,
        },
      });
    } finally {
      this.isWritingHealth = false;
    }
  }

  private flushAndClose(): void {
    if (this.fd === undefined) return;
    const fd = this.fd;
    this.fd = undefined;
    let failed = false;
    try {
      fsyncSync(fd);
    } catch {
      this.sinkErrors += 1;
      failed = true;
    }
    try {
      closeSync(fd);
    } catch {
      this.sinkErrors += 1;
      failed = true;
    }
    if (failed) this.degraded = true;
  }

  private pruneOldSegments(): void {
    const entries = readdirSync(this.directory)
      .filter((name) => LOG_FILE_PATTERN.test(name))
      .map((name) => {
        const target = path.join(this.directory, name);
        return { target, name, stat: statSync(target) };
      })
      .sort((left, right) => left.stat.mtimeMs - right.stat.mtimeMs ||
        left.name.localeCompare(right.name));
    let total = entries.reduce((sum, entry) => sum + entry.stat.size, 0);
    const targetBytes = Math.max(0, this.maxBytes - this.segmentBytes);
    const newestOversize = [...entries].reverse().find((entry) =>
      entry.target !== this.activePath && entry.stat.size > this.segmentBytes)?.target;
    for (const entry of entries) {
      if (total <= targetBytes) break;
      if (entry.target === this.activePath || entry.target === newestOversize ||
        !existsSync(entry.target)) continue;
      unlinkSync(entry.target);
      total -= entry.stat.size;
    }
  }
}

let defaultObserver: RuntimeObserver | undefined;

export function createRuntimeObserver(
  config = readRuntimeObservabilityConfig(),
): RuntimeObserver {
  if (config.mode === "off") return NOOP_RUNTIME_OBSERVER;
  return new NdjsonRuntimeObserver({ ...config, mode: config.mode });
}

export function getRuntimeObserver(): RuntimeObserver {
  if (!defaultObserver) {
    defaultObserver = createRuntimeObserver();
    if (defaultObserver.close) {
      process.once("exit", () => defaultObserver?.close?.());
    }
  }
  return defaultObserver;
}
