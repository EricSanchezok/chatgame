import { WorldHost } from "../../../../../../../../../server/world-host";
import { json, observedRoute } from "../../../../../../../h";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; executionId: string; invocationId: string }> },
): Promise<Response> {
  return observedRoute(request, async () => {
    const { id, executionId, invocationId } = await params;
    return json(WorldHost.get().inspectorModelInvocation(id, executionId, invocationId));
  });
}
