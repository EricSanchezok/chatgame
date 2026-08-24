import { WorldHost } from "../../../../../../../server/world-host";
import { json, observedRoute } from "../../../../../h";

type Context = { params: Promise<{ id: string; attemptId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id, attemptId } = await context.params;
    return json(WorldHost.get().inspectorAttempt(id, attemptId, {
      ...scope.correlation,
      sessionId: id,
      stepAttemptId: attemptId,
    }));
  });
}
