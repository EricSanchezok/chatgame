import type { SubmitExternalReactionInput } from "../../../../../../../shared/world-api";
import { WorldHost } from "../../../../../../../server/world-host";
import { json, observeHttpJsonBody, observedRoute, principalId, readJson } from "../../../../../h";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/participants/[participantId]/reactions">,
): Promise<Response> {
  return observedRoute(request, async (scope) => {
    const { id, participantId } = await params;
    const body = await readJson<SubmitExternalReactionInput>(request);
    observeHttpJsonBody(scope, body);
    if (!body || typeof body.submissionId !== "string" || !body.submissionId.trim() ||
      typeof body.windowId !== "string" || !body.windowId.trim() ||
      typeof body.preparedStepId !== "string" || !body.preparedStepId.trim() ||
      !Number.isSafeInteger(body.generation) || body.generation < 1 ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      (body.kind !== "keep" && body.kind !== "replace") ||
      (body.kind === "replace" && (typeof body.text !== "string" || !body.text.trim()))) {
      return json({ error: "invalid external reaction" }, 400);
    }
    return json(await WorldHost.get().submitReaction(id, participantId, body, principalId(request)));
  });
}
