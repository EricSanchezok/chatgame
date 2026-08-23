import { WorldHost } from "../../../server/world-host";
import { errorResponse, json, readJson } from "../h";

export async function GET(): Promise<Response> {
  try {
    return json({ sessions: WorldHost.get().listSessions() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson<{ scriptId?: unknown; seed?: unknown }>(request);
    if (!body || typeof body.scriptId !== "string" || !body.scriptId.trim()) {
      return json({ error: "scriptId is required" }, 400);
    }
    if (body.seed !== undefined && (!Number.isSafeInteger(body.seed) || Number(body.seed) < 0)) {
      return json({ error: "seed must be a non-negative safe integer" }, 400);
    }
    const session = await WorldHost.get().createSession({
      scriptId: body.scriptId,
      seed: body.seed as number | undefined,
    });
    return json(session, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
