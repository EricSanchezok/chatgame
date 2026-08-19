// Session turn API: run one full PDVA turn. Returns the turn result plus
// the fresh world state and presentation surface (the player may have
// moved to a new location with a different by_location theme).
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse, readJson } from "../../../h";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const body = await readJson<{ input: string }>(request);
    if (!body || typeof body.input !== "string" || body.input.trim() === "") {
      return json({ error: "input is required" }, 400);
    }
    // Input ceiling: the LLM context is bounded; oversized free text is
    // rejected up front instead of silently truncating the player's words.
    if (body.input.length > 2000) {
      return json({ error: "input must be 2000 characters or fewer" }, 400);
    }
    const host = EngineHost.get();
    const result = await host.turn(id, body.input);
    return json({
      ...result,
      state: host.state(id),
      presentation: host.sessionPresentation(id),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
