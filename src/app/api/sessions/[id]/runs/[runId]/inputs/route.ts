import { WorldHost } from "../../../../../../../server/world-host";
import { errorResponse, json, readJson } from "../../../../../h";

type Context = { params: Promise<{ id: string; runId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id, runId } = await context.params;
    const body = await readJson<{ id?: unknown; text?: unknown }>(request);
    if (!body || typeof body.id !== "string" || typeof body.text !== "string") {
      return json({ error: "id and text are required" }, 400);
    }
    return json(WorldHost.get().continueRun(id, runId, { id: body.id, text: body.text }), 202);
  } catch (error) {
    return errorResponse(error);
  }
}
