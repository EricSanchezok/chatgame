import { WorldHost } from "../../../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, readJson } from "../../../../../h";

type Context = { params: Promise<{ id: string; runId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id, runId } = await context.params;
    const body = await readJson<{ id?: unknown; text?: unknown }>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.id !== "string" || typeof body.text !== "string") {
      return json({ error: "id and text are required" }, 400);
    }
    return json(WorldHost.get().continueRun(
      id,
      runId,
      { id: body.id, text: body.text },
      { ...scope.correlation, sessionId: id, runId },
    ), 202);
  });
}
