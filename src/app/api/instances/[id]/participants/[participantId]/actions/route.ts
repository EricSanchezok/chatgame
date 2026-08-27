import type { SubmitExternalActionInput } from "../../../../../../../shared/world-api";
import { WorldHost } from "../../../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, principalId, readJson } from "../../../../../h";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/participants/[participantId]/actions">,
): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id, participantId } = await params;
    const body = await readJson<SubmitExternalActionInput>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.submissionId !== "string" || !body.submissionId.trim() ||
      body.submissionId.length > 128 || typeof body.text !== "string" ||
      !Number.isSafeInteger(body.expectedRevision)) {
      return json({ error: "invalid external action" }, 400);
    }
    return json(await WorldHost.get().submitAction(id, participantId, body, principalId(request)));
  });
}
