// Single-script API: presentation surface (themes/assets) + origins +
// static catalog (panel labels) + save summaries (launcher continue list).
import { EngineHost } from "../../../../server/engine-host";
import { json, errorResponse } from "../../h";
import { scriptUiBundle } from "../../script-presentation";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ scriptId: string }> },
): Promise<Response> {
  try {
    const { scriptId } = await ctx.params;
    const host = EngineHost.get();
    const presentation = host.scriptPresentation(scriptId);
    return json({
      scriptId,
      presentation: {
        ...presentation,
        defaultThemeId: presentation.defaultThemeId,
        uiBundle: await scriptUiBundle(host, scriptId),
      },
      safety: host.scriptSafety(scriptId),
      origins: host.scriptOrigins(scriptId),
      catalog: host.scriptCatalog(scriptId),
      assets: host.scriptAssets(scriptId),
      saves: host.saveSummaries(scriptId),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ scriptId: string }> },
): Promise<Response> {
  try {
    const { scriptId } = await ctx.params;
    const host = EngineHost.get();
    host.removeScript(scriptId);
    return json({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
}
