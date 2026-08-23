import { WorldHost } from "../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, readJson } from "../../h";

type Context = { params: Promise<{ id: string }> };

export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await context.params;
    return json(WorldHost.get().session(id, { ...scope.correlation, sessionId: id }));
  });
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await context.params;
    const body = await readJson<{ title?: unknown }>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.title !== "string") return json({ error: "title is required" }, 400);
    return json(WorldHost.get().renameSession(id, body.title, {
      ...scope.correlation,
      sessionId: id,
    }));
  });
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await context.params;
    WorldHost.get().deleteSession(id, { ...scope.correlation, sessionId: id });
    return new Response(null, { status: 204 });
  });
}
