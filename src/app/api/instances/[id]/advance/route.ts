import type { AdvanceWorldInput } from "../../../../../shared/world-api";
import { WorldHost } from "../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, readJson } from "../../../h";

export async function POST(request: Request, { params }: RouteContext<"/api/instances/[id]/advance">): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await params;
    const body = await readJson<AdvanceWorldInput>(request);
    observeHttpJsonBody(scope, body);
    if (!body || !Number.isSafeInteger(body.expectedRevision) ||
      !["manual", "batch", "realtime"].includes(body.trigger) ||
      (body.steps !== undefined && (!Number.isSafeInteger(body.steps) || body.steps < 1 || body.steps > 100)) ||
      (body.simulatedSeconds !== undefined &&
        (!Number.isSafeInteger(body.simulatedSeconds) || body.simulatedSeconds <= 0))) {
      return json({ error: "invalid world advance request" }, 400);
    }
    return json(await WorldHost.get().advance(id, body));
  });
}
