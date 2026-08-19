// Script UI bundle API: serves the compiled browser ESM bundle for a script's
// ui extension, compiling on demand when no fresh build exists.
import { readFileSync } from "node:fs";
import path from "node:path";
import { EngineHost } from "../../../../../server/engine-host";
import { buildScriptUi, uiBundlePath } from "../../../../../server/script-ui-build";
import { json } from "../../../h";

const SCRIPT_ID_RE = /^[a-z][a-z0-9-]*$/;

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ scriptId: string }> },
): Promise<Response> {
  const { scriptId } = await ctx.params;
  if (!SCRIPT_ID_RE.test(scriptId)) {
    return json({ error: `invalid script id "${scriptId}"` }, 400);
  }
  const scriptDir = path.join(EngineHost.get().scriptLibraryRoot, scriptId);
  const buildResult = await buildScriptUi(scriptDir);
  if (!buildResult.ok) {
    return json({ error: buildResult.error }, 404);
  }
  return new Response(readFileSync(uiBundlePath(scriptId), "utf8"), {
    headers: {
      "Content-Type": "text/javascript",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
