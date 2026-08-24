import { appendFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeTraceIndex } from "../runtime-trace-index";
import { NdjsonRuntimeObserver } from "../runtime-observer";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("RuntimeTraceIndex", () => {
  it("rebuilds retained attempts after restart and waits for complete NDJSON lines", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "livingworld-trace-index-"));
    temporaryDirectories.push(directory);
    const observer = new NdjsonRuntimeObserver({
      mode: "full",
      directory,
      segmentBytes: 1024 * 1024,
      maxBytes: 2 * 1024 * 1024,
      now: () => new Date("2026-08-24T12:00:00.000Z"),
      pid: 42,
      stdout: { write: () => true },
    });
    observer.emit({
      event: "step.started",
      correlation: { sessionId: "session-a", runId: "run-a", stepAttemptId: "attempt-a", step: 1 },
      payload: { phase: "start" },
    });
    observer.close();

    const rebuilt = new RuntimeTraceIndex(directory);
    expect(rebuilt.events("session-a").some((event) =>
      event.event === "step.started" && event.payload && event.correlation?.stepAttemptId === "attempt-a"))
      .toBe(true);
    expect(rebuilt.events("another-session")).toEqual([]);

    const file = path.join(directory, readdirSync(directory).find((name) => name.endsWith(".ndjson"))!);
    const rolledBack = JSON.stringify({
      schemaVersion: 1,
      sequence: 999,
      timestamp: "2026-08-24T12:00:01.000Z",
      level: "error",
      event: "step.rolled_back",
      correlation: { sessionId: "session-a", runId: "run-a", stepAttemptId: "attempt-a", step: 1 },
      error: { name: "Error", message: "simulated rollback" },
    });
    appendFileSync(file, rolledBack);
    expect(rebuilt.events("session-a").some((event) => event.sequence === 999)).toBe(false);
    appendFileSync(file, "\n");
    expect(rebuilt.events("session-a").find((event) => event.sequence === 999)).toMatchObject({
      event: "step.rolled_back",
      error: { message: "simulated rollback" },
    });
    expect(rebuilt.degraded).toBe(false);

    appendFileSync(file, "{not valid runtime JSON}\n");
    expect(() => rebuilt.events("session-a")).not.toThrow();
    expect(rebuilt.degraded).toBe(true);
  });
});
