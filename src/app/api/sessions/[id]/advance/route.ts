// Session advance API: deterministic offline world progression.
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse, readJson } from "../../../h";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const body = await readJson<{ hours: number }>(request);
    if (!body || typeof body.hours !== "number" || body.hours <= 0) {
      return json({ error: "hours must be a positive number" }, 400);
    }
    return json({ state: EngineHost.get().advance(id, body.hours) });
  } catch (err) {
    return errorResponse(err);
  }
}
