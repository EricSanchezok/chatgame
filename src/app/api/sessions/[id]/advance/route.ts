// Session advance API: deterministic offline world progression.
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse, readJson } from "../../../h";
import { completePresentation } from "../../../script-presentation";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const body = await readJson<{ hours: number }>(request);
    if (!body || typeof body.hours !== "number" || !Number.isInteger(body.hours) || body.hours <= 0) {
      return json({ error: "hours must be a positive integer" }, 400);
    }
    // Offline advance ceiling (documented; enforced here too): one request
    // may not fast-forward beyond 1000 hours.
    if (body.hours > 1000) {
      return json({ error: "hours must be 1000 or fewer" }, 400);
    }
    const host = EngineHost.get();
    const result = await host.advance(id, body.hours);
    return json({
      ...result,
      presentation: await completePresentation(host, result.state.scriptId, result.presentation),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
