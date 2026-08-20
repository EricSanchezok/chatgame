// Session teardown API: destroy a session (unsaved changes are discarded).
import { EngineHost } from "../../../../server/engine-host";
import { json, errorResponse } from "../../h";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    await EngineHost.get().destroySession(id);
    return json({ destroyed: true });
  } catch (err) {
    return errorResponse(err);
  }
}
