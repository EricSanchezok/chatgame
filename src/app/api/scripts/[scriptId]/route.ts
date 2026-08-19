// Single-script API: presentation surface (themes/assets) + origins +
// static catalog (panel labels) + save summaries (launcher continue list).
import { EngineHost } from "../../../../server/engine-host";
import { json, errorResponse } from "../../h";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ scriptId: string }> },
): Promise<Response> {
  try {
    const { scriptId } = await ctx.params;
    const host = EngineHost.get();
    return json({
      scriptId,
      presentation: host.scriptPresentation(scriptId),
      origins: host.scriptOrigins(scriptId),
      catalog: host.scriptCatalog(scriptId),
      assets: host.scriptAssets(scriptId),
      saves: host.saveSummaries(scriptId),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
