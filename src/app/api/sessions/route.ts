import { WorldHost } from "../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, readJson } from "../h";

export async function GET(request = new Request("http://local/api/sessions")): Promise<Response> {
  return observedRoute(request, (scope) =>
    json({ sessions: WorldHost.get().listSessions(scope.correlation) }));
}

export async function POST(request: Request): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const body = await readJson<{ worldId?: unknown; seed?: unknown }>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.worldId !== "string" || !body.worldId.trim()) {
      return json({ error: "worldId is required" }, 400);
    }
    if (body.seed !== undefined &&
      (!Number.isSafeInteger(body.seed) || Number(body.seed) < 0 || Number(body.seed) > 0xffffffff)) {
      return json({ error: "seed must be a uint32" }, 400);
    }
    const session = await WorldHost.get().createSession({
      worldId: body.worldId,
      seed: body.seed as number | undefined,
    }, scope.correlation);
    return json(session, 201);
  });
}
