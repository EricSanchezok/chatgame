// Session save API: persist the current world state to disk.
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse, readJson } from "../../../h";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const body = await readJson<{ runId?: string }>(request);
    const filePath = await EngineHost.get().save(id, body?.runId);
    return json({ saved: true, path: filePath }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
