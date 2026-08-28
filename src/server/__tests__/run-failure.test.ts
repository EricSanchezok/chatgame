import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ModelConfigurationError,
  ModelOutputError,
  ModelSemanticRepairError,
  ModelTransportError,
} from "../../engine/models/model-provider";
import { ModelOverloadedError } from "../../engine/models/model-scheduler";
import { TransitionValidationError } from "../../engine/runtime/transaction";
import { classifyRunFailure } from "../run-failure";
import { WorldInstanceConflictError } from "../world-instance-store";

describe("classifyRunFailure", () => {
  it.each([
    new ModelOverloadedError("queue is full"),
    new ModelOutputError("output repair exhausted"),
    new WorldInstanceConflictError("instance-1"),
    Object.assign(new Error("provider overloaded"), { status: 429 }),
    Object.assign(new Error("provider unavailable"), { statusCode: 503 }),
    new ModelTransportError("temporary transport failure", { retriable: true }),
    Object.assign(new Error("database busy"), { code: "SQLITE_BUSY" }),
    Object.assign(new Error("network timeout"), { code: "ETIMEDOUT" }),
  ])("classifies an explicitly temporary failure as retriable", (error) => {
    expect(classifyRunFailure(error)).toMatchObject({ kind: "retriable", retriable: true });
  });

  it.each([
    new ModelConfigurationError("missing API key"),
    new TransitionValidationError(["persisted invariant failed"]),
    new z.ZodError([]),
    Object.assign(new Error("unauthorized"), { status: 401 }),
    Object.assign(new Error("invalid request"), { statusCode: 422 }),
    new ModelTransportError("unclassified transport failure"),
    new TypeError("ordinary program type error"),
    new Error("unknown programming error"),
  ])("classifies a permanent or unknown failure as non-retriable", (error) => {
    expect(classifyRunFailure(error)).toMatchObject({ kind: "permanent", retriable: false });
  });

  it("lets a permanent nested cause dominate a transport wrapper and AggregateError", () => {
    const unauthorized = Object.assign(new Error("unauthorized"), { status: 401 });
    const transport = new ModelTransportError("transport failed", { cause: unauthorized });
    expect(classifyRunFailure(transport).kind).toBe("permanent");
    expect(classifyRunFailure(new AggregateError([
      new ModelOverloadedError("busy"),
      transport,
    ])).kind).toBe("permanent");
  });

  it("honors an explicit transport classification over an opaque nested network error", () => {
    const transport = new ModelTransportError("temporary transport failure", {
      retriable: true,
      cause: new Error("provider connection ended"),
    });
    expect(classifyRunFailure(transport)).toMatchObject({ kind: "retriable", retriable: true });
  });

  it("treats semantic repair exhaustion as retriable without misclassifying its validation cause", () => {
    const repaired = new ModelSemanticRepairError("truth-transition", "invalid delta after repairs", {
      cause: new TransitionValidationError(["invalid delta"]),
    });
    expect(classifyRunFailure(repaired)).toMatchObject({ kind: "retriable", retriable: true });
  });

  it("classifies aborts separately from failures", () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    expect(classifyRunFailure(aborted)).toMatchObject({ kind: "cancelled", retriable: false });
  });

  it("lets a recursive abort override permanent wrapper and AggregateError branches", () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    const unauthorized = Object.assign(new Error("unauthorized"), { status: 401 });
    const wrapper = Object.assign(new Error("request failed"), {
      status: 400,
      cause: aborted,
    });

    expect(classifyRunFailure(wrapper)).toMatchObject({ kind: "cancelled", retriable: false });
    expect(classifyRunFailure(new AggregateError([unauthorized, aborted])))
      .toMatchObject({ kind: "cancelled", retriable: false });
    expect(classifyRunFailure(new ModelSemanticRepairError("truth-transition", "repair aborted", {
      cause: aborted,
    }))).toMatchObject({ kind: "cancelled", retriable: false });
  });
});
