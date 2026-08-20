// Script library API: read-only installed-script index. Import is an explicit
// preview/commit flow under /api/scripts/import/*.
import { EngineHost } from "../../../server/engine-host";
import { json, errorResponse } from "../h";

export async function GET(): Promise<Response> {
  try {
    const host = EngineHost.get();
    const scripts = host.listScripts().map((script) => {
      const presentation = host.scriptPresentation(script.id);
      const assets = host.scriptAssets(script.id);
      const defaultTheme = presentation.themes.find((theme) => theme.id === presentation.defaultThemeId);
      return {
        ...script,
        defaultThemeId: presentation.defaultThemeId,
        theme: defaultTheme
          ? { id: defaultTheme.id, name: defaultTheme.name, palette: defaultTheme.palette }
          : script.theme,
        cover: assets.cover,
      };
    });
    return json({ scripts });
  } catch (err) {
    return errorResponse(err);
  }
}
