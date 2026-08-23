import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ModelGateway } from "../model-gateway";
import { parseModelCatalog } from "../model-catalog";
import {
  ModelOutputError,
  ModelTransportError,
  summarizeModelExecutionAudit,
} from "../model-provider";
import { RecordingRuntimeObserver } from "../observability";
import { FairModelScheduler, ModelOverloadedError } from "../model-scheduler";

const outputSchema = z.strictObject({ answer: z.string() });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function catalog() {
  return parseModelCatalog({
    schema_version: 1,
    scheduler: { global_concurrency: 16, max_queued_requests: 1024, queue_timeout_ms: 300_000 },
    providers: {
      deepseek: {
        kind: "deepseek",
        base_url: "https://deepseek.test",
        api_key_env: "DEEPSEEK_API_KEY",
        max_concurrency: 16,
      },
      openai: {
        kind: "openai",
        base_url: "https://openai.test/v1",
        api_key_env: "OPENAI_API_KEY",
        max_concurrency: 16,
      },
      xai: {
        kind: "xai",
        base_url: "https://xai.test/v1",
        api_key_env: "XAI_API_KEY",
        max_concurrency: 16,
      },
    },
    profiles: {
      deep: {
        provider_id: "deepseek",
        model: "deepseek-v4-pro",
        description: "DeepSeek adapter contract test",
        allowed_roles: ["agent-mind"],
        request_timeout_ms: 10_000,
        max_output_tokens: 1_000,
        inference: { kind: "deepseek-thinking", effort: "max" },
      },
      gpt: {
        provider_id: "openai",
        model: "gpt-5.6",
        description: "OpenAI adapter contract test",
        allowed_roles: ["agent-mind"],
        request_timeout_ms: 10_000,
        max_output_tokens: 1_000,
        inference: {
          kind: "openai-reasoning",
          effort: "medium",
          summary: "concise",
          text_verbosity: "low",
        },
      },
      grok: {
        provider_id: "xai",
        model: "grok-4.6",
        description: "xAI adapter contract test",
        allowed_roles: ["agent-mind"],
        request_timeout_ms: 10_000,
        max_output_tokens: 1_000,
        inference: { kind: "xai-reasoning", effort: "xhigh", summary: "detailed" },
      },
    },
  });
}

const credentials = {
  DEEPSEEK_API_KEY: "deepseek-key",
  OPENAI_API_KEY: "openai-key",
  XAI_API_KEY: "xai-key",
};

function deepSeekResponse(
  content = JSON.stringify({ answer: "deepseek" }),
  status = 200,
  finishReason = "stop",
): Response {
  return Response.json({
    id: "deepseek-response",
    object: "chat.completion",
    created: 1,
    model: "deepseek-v4-pro",
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: finishReason,
    }],
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  }, { status });
}

function responsesApiResponse(answer: string, model: string, id: string): Response {
  return Response.json({
    id,
    object: "response",
    created_at: 1,
    status: "completed",
    model,
    output: [{
      id: `${id}-message`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify({ answer }), annotations: [] }],
    }],
    usage: {
      input_tokens: 13,
      input_tokens_details: { cached_tokens: 2 },
      output_tokens: 8,
      output_tokens_details: { reasoning_tokens: 3 },
      total_tokens: 21,
    },
  });
}

function request(profileId: string) {
  return {
    profileId,
    workloadId: "session-a",
    batchId: "run-a",
    role: "agent-mind" as const,
    subjectId: "agent-a",
    promptVersion: "test-v1",
    schemaName: "answer_output",
    system: "Return structured output.",
    context: { question: "test" },
    schema: outputSchema,
  };
}

describe("model catalog and provider adapters", () => {
  it("rejects missing credentials, unknown profiles and mismatched native inference settings", async () => {
    expect(() => new ModelGateway(catalog(), { ...credentials, XAI_API_KEY: "" })).toThrow("requires XAI_API_KEY");
    expect(() => parseModelCatalog({
      schema_version: 1,
      scheduler: { global_concurrency: 1, max_queued_requests: 1, queue_timeout_ms: 1 },
      providers: {
        openai: {
          kind: "openai",
          base_url: "https://openai.test/v1",
          api_key_env: "OPENAI_API_KEY",
          max_concurrency: 1,
        },
      },
      profiles: {
        invalid: {
          provider_id: "openai",
          model: "gpt-5.6",
          description: "Invalid inference/provider pair",
          allowed_roles: ["agent-mind"],
          request_timeout_ms: 1_000,
          max_output_tokens: 1,
          inference: { kind: "deepseek-thinking", effort: "high" },
        },
      },
    })).toThrow("uses deepseek-thinking with openai provider");

    const gateway = new ModelGateway(catalog(), credentials, {
      fetch: async () => deepSeekResponse(),
    });
    await expect(gateway.generateStructured(request("missing"))).rejects.toThrow("unknown model profile missing");
  });

  it("sends native structured-output and reasoning contracts to DeepSeek, OpenAI and xAI", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const gateway = new ModelGateway(catalog(), credentials, {
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        if (url.includes("deepseek")) return deepSeekResponse();
        if (url.includes("openai")) return responsesApiResponse("openai", "gpt-5.6", "openai-response");
        return responsesApiResponse("xai", "grok-4.6", "xai-response");
      },
    });

    const [deepseek, openai, xai] = await Promise.all([
      gateway.generateStructured(request("deep")),
      gateway.generateStructured(request("gpt")),
      gateway.generateStructured(request("grok")),
    ]);

    expect(deepseek.value).toEqual({ answer: "deepseek" });
    expect(openai.value).toEqual({ answer: "openai" });
    expect(xai.value).toEqual({ answer: "xai" });

    const deepBody = calls.find((call) => call.url.includes("deepseek"))!.body;
    expect(deepBody).toMatchObject({
      model: "deepseek-v4-pro",
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    });
    expect(JSON.stringify(deepBody)).toContain("Example JSON output shape");

    const openaiBody = calls.find((call) => call.url.includes("openai"))!.body;
    expect(openaiBody).toMatchObject({
      model: "gpt-5.6",
      reasoning: { effort: "medium", summary: "concise" },
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });

    const xaiBody = calls.find((call) => call.url.includes("xai"))!.body;
    expect(xaiBody).toMatchObject({
      model: "grok-4.6",
      reasoning: { effort: "xhigh", summary: "detailed" },
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(summarizeModelExecutionAudit(openai.audit).tokenUsage)
      .toMatchObject({ input: 13, output: 8, reasoning: 3, cacheRead: 2 });
  });

  it("records exact invocation metrics, full Context once per call, and deduplicated contracts", async () => {
    const observer = new RecordingRuntimeObserver({ mode: "full" });
    const gateway = new ModelGateway(catalog(), credentials, {
      observer,
      fetch: async () => responsesApiResponse("openai", "gpt-5.6", "observed"),
    });
    const first = await gateway.generateStructured({
      ...request("gpt"),
      context: { greeting: "你好", history: [{ id: "one" }] },
      modelInvocationId: "invocation-1",
      modelInvocation: 1,
    });
    await gateway.generateStructured({
      ...request("gpt"),
      context: { greeting: "再见", history: [{ id: "two" }] },
      modelInvocationId: "invocation-2",
      modelInvocation: 2,
    });

    const invocation = first.audit.invocations[0];
    expect(invocation).toMatchObject({
      id: "invocation-1",
      ordinal: 1,
      semanticOutcome: "accepted",
      tokenUsage: { input: 13, output: 8, reasoning: 3, cacheRead: 2 },
    });
    expect(invocation.context.utf8Bytes).toBe(Buffer.byteLength(
      JSON.stringify({ greeting: "你好", history: [{ id: "one" }] }, null, 2),
      "utf8",
    ));
    expect(observer.events.filter((event) => event.event === "model.contract.registered")).toHaveLength(1);
    expect(observer.events.filter((event) => event.event === "model.context.serialized"))
      .toHaveLength(2);
    expect(observer.events.find((event) => event.event === "model.context.serialized")?.payload)
      .toHaveProperty("context.greeting", "你好");
  });

  it("retries 429 transport failures but never repairs auth errors or malformed structured output", async () => {
    let rateLimitedCalls = 0;
    const delays: number[] = [];
    const observer = new RecordingRuntimeObserver({ mode: "metrics" });
    const retrying = new ModelGateway(catalog(), credentials, {
      observer,
      fetch: async () => {
        rateLimitedCalls += 1;
        if (rateLimitedCalls === 1) {
          return Response.json({ error: { message: "slow down" } }, {
            status: 429,
            headers: { "retry-after": "2" },
          });
        }
        return deepSeekResponse();
      },
      sleep: async (milliseconds) => { delays.push(milliseconds); },
    });
    const retried = await retrying.generateStructured(request("deep"));
    expect(summarizeModelExecutionAudit(retried.audit).transportAttempts).toBe(2);
    expect(retried.audit.invocations[0].transports).toMatchObject([
      { attempt: 1, status: "retryable_error", retryDelayMs: 2_000, statusCode: 429 },
      { attempt: 2, status: "succeeded", retryDelayMs: 0 },
    ]);
    expect(observer.events.some((event) => event.event === "model.transport.retry_wait")).toBe(true);
    expect(delays).toEqual([2_000]);

    let authCalls = 0;
    const unauthorized = new ModelGateway(catalog(), credentials, {
      fetch: async () => {
        authCalls += 1;
        return Response.json({ error: { message: "bad key" } }, { status: 401 });
      },
      sleep: async () => {},
    });
    await expect(unauthorized.generateStructured(request("deep"))).rejects.toBeInstanceOf(ModelTransportError);
    expect(authCalls).toBe(1);

    const malformed = new ModelGateway(catalog(), credentials, {
      fetch: async () => deepSeekResponse("not-json"),
      sleep: async () => {},
    });
    await expect(malformed.generateStructured(request("deep"))).rejects.toBeInstanceOf(ModelOutputError);
  });

  it("retries 5xx responses, never retries 400, and rejects every non-conforming DeepSeek payload", async () => {
    let serverCalls = 0;
    const retrying = new ModelGateway(catalog(), credentials, {
      fetch: async () => {
        serverCalls += 1;
        if (serverCalls < 3) {
          return Response.json({ error: { message: "temporary outage" } }, { status: 503 });
        }
        return deepSeekResponse();
      },
      random: () => 0,
      sleep: async () => {},
    });
    const recovered = await retrying.generateStructured(request("deep"));
    expect(serverCalls).toBe(3);
    expect(summarizeModelExecutionAudit(recovered.audit))
      .toMatchObject({ transportAttempts: 3, repairAttempts: 0 });

    let badRequestCalls = 0;
    const badRequest = new ModelGateway(catalog(), credentials, {
      fetch: async () => {
        badRequestCalls += 1;
        return Response.json({ error: { message: "invalid parameter" } }, { status: 400 });
      },
      sleep: async () => {},
    });
    await expect(badRequest.generateStructured(request("deep"))).rejects.toBeInstanceOf(ModelTransportError);
    expect(badRequestCalls).toBe(1);

    for (const response of [
      deepSeekResponse(""),
      deepSeekResponse(JSON.stringify({ answer: "cut off" }), 200, "length"),
      deepSeekResponse(JSON.stringify({ answer: "value", unexpected: true })),
    ]) {
      const invalid = new ModelGateway(catalog(), credentials, {
        fetch: async () => response.clone(),
        sleep: async () => {},
      });
      await expect(invalid.generateStructured(request("deep"))).rejects.toBeInstanceOf(ModelOutputError);
    }
  });

  it("queues a 48-Agent gateway burst behind the global limit of 16", async () => {
    const release = deferred<void>();
    const capacityReached = deferred<void>();
    let active = 0;
    let peak = 0;
    const gateway = new ModelGateway(catalog(), credentials, {
      fetch: async () => {
        active += 1;
        peak = Math.max(peak, active);
        if (active === 16) capacityReached.resolve();
        await release.promise;
        active -= 1;
        return deepSeekResponse(JSON.stringify({ answer: "ready" }));
      },
    });
    const batch = Array.from({ length: 48 }, (_, index) => gateway.generateStructured({
      ...request("deep"),
      workloadId: `session-${index % 6}`,
      subjectId: `agent-${index}`,
    }));

    await capacityReached.promise;
    expect(peak).toBe(16);
    release.resolve();
    const results = await Promise.all(batch);
    expect(results).toHaveLength(48);
    expect(peak).toBe(16);
  });

  it("logs overload and cancellation as terminal invocation outcomes", async () => {
    const observer = new RecordingRuntimeObserver({ mode: "metrics" });
    const entered = deferred<void>();
    const release = deferred<void>();
    const scheduler = new FairModelScheduler({
      globalConcurrency: 1,
      maxQueuedRequests: 1,
      queueTimeoutMs: 10_000,
      providerConcurrency: { deepseek: 1, openai: 1, xai: 1 },
    });
    const gateway = new ModelGateway(catalog(), credentials, {
      observer,
      scheduler,
      fetch: async () => {
        entered.resolve();
        await release.promise;
        return deepSeekResponse();
      },
    });
    const first = gateway.generateStructured({ ...request("deep"), modelInvocationId: "active" });
    await entered.promise;
    const queued = gateway.generateStructured({ ...request("deep"), modelInvocationId: "queued" });
    await expect(gateway.generateStructured({
      ...request("deep"),
      modelInvocationId: "overloaded",
    })).rejects.toBeInstanceOf(ModelOverloadedError);
    release.resolve();
    await Promise.all([first, queued]);

    const controller = new AbortController();
    controller.abort();
    await expect(gateway.generateStructured({
      ...request("deep"),
      modelInvocationId: "cancelled",
      abortSignal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(observer.events.find((event) =>
      event.event === "model.invocation.failed" &&
      event.correlation?.modelInvocationId === "overloaded")?.attributes?.result).toBe("overloaded");
    expect(observer.events.find((event) =>
      event.event === "model.invocation.failed" &&
      event.correlation?.modelInvocationId === "cancelled")?.attributes?.result).toBe("cancelled");
  });
});
