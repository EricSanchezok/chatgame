import { WorldHost } from "../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, readJson } from "../h";

export async function GET(
  request = new Request("http://local/api/sessions"),
): Promise<Response> {
  return observedRoute(request, (scope) =>
    json({ sessions: WorldHost.get().listSessions(scope.correlation) }));
}

export async function POST(request: Request): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const body = await readJson<{ scriptId?: unknown; seed?: unknown }>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.scriptId !== "string" || !body.scriptId.trim()) {
      return json({ error: "scriptId is required" }, 400);
    }
    if (body.seed !== undefined && (!Number.isSafeInteger(body.seed) || Number(body.seed) < 0)) {
      return json({ error: "seed must be a non-negative safe integer" }, 400);
    }
    const session = await WorldHost.get().createSession({
      scriptId: body.scriptId,
      seed: body.seed as number | undefined,
    }, scope.correlation);
    return json(session, 201);
  });
}
