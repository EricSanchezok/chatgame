import { WorldHost } from "../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, readJson } from "../../../h";

export async function PUT(request: Request, { params }: RouteContext<"/api/instances/[id]/realtime">): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await params;
    const body = await readJson<{ enabled?: boolean }>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.enabled !== "boolean") return json({ error: "enabled is required" }, 400);
    return json(await WorldHost.get().setRealtime(id, body.enabled));
  });
}
