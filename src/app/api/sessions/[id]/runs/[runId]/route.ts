import { WorldHost } from "../../../../../../server/world-host";
import { json, observedRoute } from "../../../../h";

type Context = { params: Promise<{ id: string; runId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id, runId } = await context.params;
    return json(WorldHost.get().run(id, runId, { ...scope.correlation, sessionId: id, runId }));
  });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id, runId } = await context.params;
    return json(WorldHost.get().retryRun(id, runId, {
      ...scope.correlation,
      sessionId: id,
      runId,
    }), 202);
  });
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id, runId } = await context.params;
    return json(WorldHost.get().cancelRun(id, runId, {
      ...scope.correlation,
      sessionId: id,
      runId,
    }), 202);
  });
}
