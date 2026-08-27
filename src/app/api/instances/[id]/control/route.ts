import type { ControlTransferInput } from "../../../../../shared/world-api";
import { WorldHost } from "../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, principalId, readJson } from "../../../h";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/control">,
): Promise<Response> {
  return observedRoute(request, async () => {
    const { id } = await params;
    return json(WorldHost.get().controlOptions(id));
  });
}

export async function PUT(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/control">,
): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id } = await params;
    const body = await readJson<ControlTransferInput>(request);
    observeHttpJsonBody(scope, body);
    if (!body || !Number.isSafeInteger(body.expectedRevision) || !body.target ||
      !["observer", "agent"].includes(body.target.kind) ||
      (body.target.kind === "agent" &&
        (typeof body.target.agentId !== "string" || !body.target.agentId.trim()))) {
      return json({ error: "invalid control transfer" }, 400);
    }
    return json(await WorldHost.get().transferControl(id, body, principalId(request)));
  });
}
