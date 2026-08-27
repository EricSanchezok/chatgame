import type { CreateInstanceInput } from "../../../shared/world-api";
import { WorldHost } from "../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, readJson } from "../h";

export async function GET(request: Request): Promise<Response> {
  return observedRoute(request, () => json({ instances: WorldHost.get().listInstances() }));
}

export async function POST(request: Request): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const body = await readJson<CreateInstanceInput & { seed?: number }>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.worldId !== "string" || !body.worldId.trim()) {
      return json({ error: "worldId is required" }, 400);
    }
    if (body.seed !== undefined && (!Number.isSafeInteger(body.seed) || body.seed < 0 || body.seed > 0xffffffff)) {
      return json({ error: "seed must be a uint32" }, 400);
    }
    return json(await WorldHost.get().createInstance(body), 201);
  });
}
