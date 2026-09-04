import { describe, expect, it } from "vitest";
import { RecordingRuntimeObserver } from "../runtime/observability";
import { contentHash } from "../models/model-audit";
import {
  assertSafeBenchmarkSource,
  emitActionCompilationFullContextCapture,
  readActionCompilationCapturedSources,
} from "./source-capture";

describe("benchmark source capture", () => {
  it("captures full context and rejects secrets", () => {
    const observer = new RecordingRuntimeObserver({ mode: "full" });
    const source = emitActionCompilationFullContextCapture(observer, {
      sourceExecutionId: "execution-1",
      sourceInvocationId: "invocation-1",
      role: "action-compilation",
      slotIndices: [1, 0],
      fullContext: { referenceCatalog: { candidates: [] }, task: { slots: [] } },
      actionIds: ["action-1"],
    });
    expect(source.fullContextHash).toBe(contentHash(source.fullContext));
    expect(() => assertSafeBenchmarkSource({ authorization: "secret" })).toThrow(/credential/u);
  });

  it("fails closed for credential-like fields", () => {
    const observer = new RecordingRuntimeObserver({ mode: "full" });
    expect(() => emitActionCompilationFullContextCapture(observer, {
      sourceExecutionId: "execution-1",
      sourceInvocationId: "invocation-1",
      role: "action-compilation",
      slotIndices: [0],
      fullContext: { api_key: "secret" },
      actionIds: [],
    })).toThrow(/credential/u);
    expect(readActionCompilationCapturedSources(observer.snapshot())).toEqual([]);
  });

  it("does not reject ordinary world prose containing security terminology", () => {
    expect(() => assertSafeBenchmarkSource({
      belief: "claim-credit-if-success-and-deny-authorization-if-exposed",
    })).not.toThrow();
    expect(() => assertSafeBenchmarkSource({
      headers: { authorization: "Bearer abc.def" },
    })).toThrow(/credential/u);
  });
});
