import type { WorldRunControlInput } from "../../../../../../shared/world-api";
import { WorldHost } from "../../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, principalId, readJson } from "../../../../h";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/run/pause">,
): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await params;
    const body = await readJson<WorldRunControlInput>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.runId !== "string" || !body.runId.trim() ||
      !Number.isSafeInteger(body.generation) || body.generation < 1) {
      return json({ error: "invalid world run control request" }, 400);
    }
    return json(await WorldHost.get().pauseRun(id, body, principalId(request)));
  });
}
