import { WorldHost } from "../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, readJson } from "../../../h";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await context.params;
    const body = await readJson<{ text?: unknown }>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.text !== "string" || !body.text.trim()) {
      return json({ error: "text is required" }, 400);
    }
    if (body.text.length > 4_000) return json({ error: "text must be 4000 characters or fewer" }, 400);
    return json(WorldHost.get().startRun(id, body.text, {
      ...scope.correlation,
      sessionId: id,
    }), 202);
  });
}
