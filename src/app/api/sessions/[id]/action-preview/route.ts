import { EngineHost } from "../../../../../server/engine-host";
import type { IntentHint } from "../../../../../shared/client-dto";
import { errorResponse, json, readJson } from "../../../h";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const hint = await readJson<IntentHint>(request);
    if (!hint || typeof hint.actionId !== "string" || hint.actionId.length === 0) {
      return json({ error: "actionId is required" }, 400);
    }
    return json(EngineHost.get().previewAction(id, hint));
  } catch (error) {
    return errorResponse(error);
  }
}
