// Session load API: load a save file into the session by run id.
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse, readJson } from "../../../h";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const body = await readJson<{ runId: string }>(request);
    if (!body || typeof body.runId !== "string") {
      return json({ error: "runId is required" }, 400);
    }
    const state = EngineHost.get().load(id, body.runId);
    return json({ state });
  } catch (err) {
    return errorResponse(err);
  }
}
