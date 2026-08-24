import { createServer } from "node:http";

const port = Number(process.env.LIVINGWORLD_E2E_MODEL_PORT ?? 32128);

async function readBody(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function contextFrom(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages as Array<{ role: string; content: string }>;
  const prompt = messages.findLast((message) => message.role === "user")?.content;
  if (!prompt) throw new Error("DeepSeek-compatible request has no user prompt");
  const [json] = prompt.split("\n\nReturn exactly one json object.", 1);
  return JSON.parse(json) as Record<string, unknown>;
}

function agentOutput() {
  return {
    beliefPatch: { operations: [] },
    characterPatch: { operations: [] },
    nextAction: {
      rawText: "根据当前认知继续观察世界",
      goal: "继续自主行动",
      means: null,
      targetIds: [],
    },
  };
}

function truthOutput(context: Record<string, unknown>) {
  if (context.promptVersion === "causal-verifier-v3") return { verdict: "accept", findings: [] };
  if (context.stage === "perception" || context.stage === "resolution") return { kind: "done" };
  if (context.stage === "reaction-routing") return { requests: [] };
  if (context.stage !== "transition") throw new Error(`unexpected Truth stage ${String(context.stage)}`);
  const baseRevision = context.baseRevision as number;
  const step = context.step as number;
  const actions = context.jointActions as Array<{ id: string }>;
  const agentEpistemics = context.agentEpistemics as Record<string, unknown>;
  const world = context.world as { laws: Array<{ id: string }> };
  const nextStep = step + 1;
  const eventId = `e2e-event:${nextStep}`;
  const lawId = world.laws[0].id;
  return {
    baseRevision,
    outcomes: actions.map((action) => ({
      proposalId: action.id,
      status: "succeeded",
      summary: "模拟 Truth Engine 已联合裁决行动。",
      causeRefs: [{ kind: "action", id: action.id }],
      assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
      knownAlternatives: [],
    })),
    mechanicInvocations: [],
    operations: [{
      kind: "advance_time",
      seconds: 1,
      causes: [{ kind: "law", id: lawId }],
      assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 0 }],
    }],
    events: [{
      id: eventId,
      step: nextStep,
      description: "世界在联合裁决后推进了一秒。",
      impact: "ordinary",
      causes: [{ kind: "law", id: lawId }],
      assertions: [{ kind: "elapsed_seconds_compare", operator: "gte", value: 1 }],
    }],
    observations: ["player", ...Object.keys(agentEpistemics)].map((observerId) => ({
      id: `e2e-observation:${observerId}:${nextStep}`,
      observerId,
      step: nextStep,
      kind: "outcome",
      summary: observerId === "player" ? "世界回应了你的自由行动。" : "周围的世界继续变化。",
      introductions: [],
      apparentClaims: [],
      sourceEventIds: [eventId],
    })),
    intentStatus: "completed",
    requiresPlayerDecision: false,
  };
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const body = await readBody(request);
    const context = contextFrom(body);
    const playerIntent = context.playerIntent as { goal?: string } | null;
    if (playerIntent?.goal === "触发 E2E 流式失败" || playerIntent?.goal === "触发 E2E 快速失败") {
      if (playerIntent.goal === "触发 E2E 流式失败") {
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
      }
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "forced e2e authentication failure" } }));
      return;
    }
    const model = String(body.model);
    const output = model === "e2e-truth" ? truthOutput(context) : agentOutput();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: `e2e-response:${model}:${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: JSON.stringify(output) },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }));
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
  }
});

server.listen(port, "127.0.0.1");

function close(): void {
  server.close(() => process.exit(0));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
