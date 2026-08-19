// Session saves API: list existing save files for this session's script.
import { EngineHost } from "../../../../../server/engine-host";
import { json, errorResponse } from "../../../h";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const saves = EngineHost.get().listSaves(id).map((fileName) => {
      const raw = fileName.replace(/\.json$/, "");
      // runIds are ISO timestamps with - separators.
      return { runId: fileName, label: raw.replace(/-/g, (m, i) => (i === 13 || i === 16 ? ":" : m)) };
    });
    return json({ saves });
  } catch (err) {
    return errorResponse(err);
  }
}
