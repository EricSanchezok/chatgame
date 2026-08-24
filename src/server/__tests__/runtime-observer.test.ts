import {
  closeSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecordingRuntimeObserver,
  redactRuntimePayload,
  serializeRuntimeError,
} from "../../engine/observability";
import {
  NdjsonRuntimeObserver,
  readRuntimeObservabilityConfig,
} from "../runtime-observer";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "livingworld-observer-"));
  roots.push(root);
  return root;
}

describe("runtime observability", () => {
  it("keeps payload only in full mode and assigns stable envelope fields", () => {
    const now = () => new Date("2026-08-23T12:00:00.000Z");
    const metrics = new RecordingRuntimeObserver({ mode: "metrics", now });
    const full = new RecordingRuntimeObserver({ mode: "full", now });

    metrics.emit({ event: "test.event", payload: { text: "秘密" } });
    full.emit({ event: "test.event", payload: { text: "可复盘" } });

    expect(metrics.events[0]).toMatchObject({
      schemaVersion: 1,
      sequence: 1,
      timestamp: "2026-08-23T12:00:00.000Z",
      level: "info",
      event: "test.event",
    });
    expect(metrics.events[0]).not.toHaveProperty("payload");
    expect(full.events[0].payload).toEqual({ text: "可复盘" });
  });

  it("serializes only whitelisted error fields and bounded causes", () => {
    const cause = Object.assign(new Error("provider rejected"), {
      status: 429,
      apiKey: "must-not-appear",
      responseHeaders: { authorization: "must-not-appear" },
    });
    const error = new Error("model failed", { cause });
    const serialized = serializeRuntimeError(error);

    expect(serialized).toMatchObject({
      name: "Error",
      message: "model failed",
      cause: { name: "Error", message: "provider rejected", status: 429 },
    });
    expect(JSON.stringify(serialized)).not.toContain("must-not-appear");
  });

  it("redacts credential-shaped fields without removing ordinary player text", () => {
    expect(redactRuntimePayload({
      text: "角色说出了 token 这个单词",
      apiKey: "secret-value",
      nested: { authorization: "Bearer secret", goal: "继续游戏" },
    })).toEqual({
      text: "角色说出了 token 这个单词",
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]", goal: "继续游戏" },
    });
    const full = new RecordingRuntimeObserver({ mode: "full" });
    full.emit({
      event: "credential.guard",
      payload: { accessToken: "payload-secret" },
      error: serializeRuntimeError(new Error("Authorization: Bearer error-secret")),
    });
    const logged = JSON.stringify(full.events[0]);
    expect(logged).not.toContain("payload-secret");
    expect(logged).not.toContain("error-secret");
  });

  it("defaults local development to full and every other environment to off", () => {
    expect(readRuntimeObservabilityConfig({ NODE_ENV: "development" }, "/workspace")).toMatchObject({
      mode: "full",
      directory: "/workspace/.livingworld/logs",
    });
    expect(readRuntimeObservabilityConfig({ NODE_ENV: "production" }, "/workspace").mode).toBe("off");
    expect(readRuntimeObservabilityConfig({ NODE_ENV: "test" }, "/workspace").mode).toBe("off");
    expect(readRuntimeObservabilityConfig({}, "/workspace").mode).toBe("off");
  });

  it("lets an explicit mode override the development default and ignores byte knobs while off", () => {
    const off = readRuntimeObservabilityConfig({
      NODE_ENV: "development",
      LIVINGWORLD_OBSERVABILITY: "off",
      LIVINGWORLD_OBSERVABILITY_SEGMENT_BYTES: "invalid",
    }, "/workspace");
    expect(off.mode).toBe("off");
    expect(off.directory).toBe("/workspace/.livingworld/logs");

    expect(() => readRuntimeObservabilityConfig({
      LIVINGWORLD_OBSERVABILITY: "metrics",
      LIVINGWORLD_OBSERVABILITY_SEGMENT_BYTES: "0",
    })).toThrow("positive safe integer");
    expect(() => readRuntimeObservabilityConfig({
      LIVINGWORLD_OBSERVABILITY: "full",
      LIVINGWORLD_OBSERVABILITY_SEGMENT_BYTES: "100",
      LIVINGWORLD_OBSERVABILITY_MAX_BYTES: "99",
    })).toThrow("at least the segment size");
  });

  it("reuses the process observer across development module reloads", async () => {
    vi.resetModules();
    const firstModule = await import("../runtime-observer");
    const first = firstModule.getRuntimeObserver();
    vi.resetModules();
    const secondModule = await import("../runtime-observer");

    expect(secondModule.getRuntimeObserver()).toBe(first);
  });

  it("writes complete NDJSON lines, rotates, retains oversized events, and protects unrelated files", () => {
    const root = temporaryRoot();
    const unrelated = path.join(root, "keep-me.txt");
    writeFileSync(unrelated, "unrelated", "utf8");
    let stdout = "";
    const observer = new NdjsonRuntimeObserver({
      mode: "full",
      directory: root,
      segmentBytes: 420,
      maxBytes: 900,
      now: () => new Date("2026-08-23T12:00:00.000Z"),
      pid: 42,
      stdout: { write: (chunk) => { stdout += chunk; } },
    });
    observer.emit({ event: "small.one", attributes: { value: "x".repeat(220) } });
    observer.emit({ event: "oversized", payload: { value: "汉".repeat(500) } });
    observer.emit({ event: "small.two", attributes: { value: "y".repeat(220) } });
    observer.close();

    expect(readFileSync(unrelated, "utf8")).toBe("unrelated");
    const files = readdirSync(root).filter((name) => name.endsWith(".ndjson"));
    expect(files.length).toBeGreaterThan(1);
    const fileEvents = files.flatMap((name) => readFileSync(path.join(root, name), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string }));
    expect(fileEvents.some((event) => event.event === "oversized")).toBe(true);
    const stdoutEvents = stdout.trim().split("\n").map((line) => JSON.parse(line) as { event: string });
    expect(stdoutEvents.some((event) => event.event === "observability.health")).toBe(true);
  });

  it("fails construction when an enabled initial sink cannot be opened", () => {
    const root = temporaryRoot();
    const file = path.join(root, "not-a-directory");
    writeFileSync(file, "occupied", "utf8");
    expect(() => new NdjsonRuntimeObserver({
      mode: "metrics",
      directory: file,
      segmentBytes: 1024,
      maxBytes: 2048,
      stdout: { write: () => {} },
    })).toThrow();
  });

  it("keeps normal rotated segments within the configured directory budget", () => {
    const root = temporaryRoot();
    const observer = new NdjsonRuntimeObserver({
      mode: "metrics",
      directory: root,
      segmentBytes: 500,
      maxBytes: 1_100,
      stdout: { write: () => {} },
    });
    for (let index = 0; index < 12; index += 1) {
      observer.emit({ event: "budgeted.event", attributes: { index, value: "x".repeat(160) } });
    }
    observer.close();

    const total = readdirSync(root)
      .filter((name) => name.endsWith(".ndjson"))
      .reduce((sum, name) => sum + statSync(path.join(root, name)).size, 0);
    expect(total).toBeLessThanOrEqual(1_100);
  });

  it("degrades after a runtime file sink failure and continues stdout", () => {
    const root = temporaryRoot();
    let stdout = "";
    const observer = new NdjsonRuntimeObserver({
      mode: "metrics",
      directory: root,
      segmentBytes: 10_000,
      maxBytes: 20_000,
      stdout: { write: (chunk) => { stdout += chunk; } },
    });
    const fd = (observer as unknown as { fd: number }).fd;
    closeSync(fd);

    expect(() => observer.emit({ event: "after.file.failure" })).not.toThrow();
    expect(observer.degraded).toBe(true);
    observer.emit({ event: "stdout.still.alive" });
    observer.close();
    expect(stdout).toContain("after.file.failure");
    expect(stdout).toContain("stdout.still.alive");
    expect(stdout).toContain("observability.health");
  });
});
