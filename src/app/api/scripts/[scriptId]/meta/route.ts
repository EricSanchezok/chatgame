// Script meta-progression API: unlocked origins for the launcher's new-game
// picker. The meta file is the union of every run's unlocks; a missing or
// corrupt file reads as an empty set (never blocks the launcher).
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse } from "../../../h";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ scriptId: string }> },
): Promise<Response> {
  try {
    const { scriptId } = await ctx.params;
    return json({ scriptId, ...EngineHost.get().readMeta(scriptId) });
  } catch (err) {
    return errorResponse(err);
  }
}
