import type { CreateInstanceInput } from "../../../shared/world-api";
import { WorldHost } from "../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, principalId, readJson } from "../h";

export async function GET(request: Request): Promise<Response> {
  return observedRoute(request, () => json({ instances: WorldHost.get().listInstances() }));
}

export async function POST(request: Request): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const body = await readJson<CreateInstanceInput & { seed?: number }>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.worldId !== "string" || !body.worldId.trim() ||
      !body.start || !["origin", "observer"].includes(body.start.kind)) {
      return json({ error: "worldId is required" }, 400);
    }
    if (body.seed !== undefined && (!Number.isSafeInteger(body.seed) || body.seed < 0 || body.seed > 0xffffffff)) {
      return json({ error: "seed must be a uint32" }, 400);
    }
    if (body.start.kind === "origin" &&
      (typeof body.start.originId !== "string" || typeof body.start.displayName !== "string" ||
        typeof body.start.appearance !== "string" || typeof body.start.motivation !== "string")) {
      return json({ error: "invalid Origin start" }, 400);
    }
    return json(await WorldHost.get().createInstance(body, principalId(request)), 201);
  });
}
