import { WorldHost } from "../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, principalId, readJson } from "../../h";

export async function GET(request: Request, { params }: RouteContext<"/api/instances/[id]">): Promise<Response> {
  return observedRoute(request, async () => {
    const { id } = await params;
    return json(WorldHost.get().instance(id, principalId(request)));
  });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/instances/[id]">): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await params;
    const body = await readJson<{ title?: string }>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.title !== "string") return json({ error: "title is required" }, 400);
    return json(WorldHost.get().renameInstance(id, body.title));
  });
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/instances/[id]">): Promise<Response> {
  return observedRoute(request, async () => {
    const { id } = await params;
    WorldHost.get().deleteInstance(id);
    return new Response(null, { status: 204 });
  });
}
