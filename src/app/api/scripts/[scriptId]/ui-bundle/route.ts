// Script UI bundle API: serves the compiled browser ESM bundle for a script's
// ui extension, compiling on demand when no fresh build exists.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EngineHost } from "../../../../../server/engine-host";
import { buildScriptUi, uiBundlePath } from "../../../../../server/script-ui-build";
import { json } from "../../../h";

const SCRIPT_ID_RE = /^[a-z][a-z0-9-]*$/;

export async function GET(
  request: Request,
  ctx: { params: Promise<{ scriptId: string }> },
): Promise<Response> {
  const { scriptId } = await ctx.params;
  if (!SCRIPT_ID_RE.test(scriptId)) {
    return json({ error: `invalid script id "${scriptId}"` }, 400);
  }
  const host = EngineHost.get();
  host.scriptPresentation(scriptId); // installed-script gate; stale builds are never served after removal.
  const scriptDir = path.join(host.scriptLibraryRoot, scriptId);
  const requestedVersion = new URL(request.url).searchParams.get("v");
  if (requestedVersion && !/^[0-9a-f]{20}$/.test(requestedVersion)) {
    return json({ error: "invalid bundle version" }, 400);
  }
  if (requestedVersion) {
    const immutablePath = uiBundlePath(scriptId, requestedVersion);
    if (existsSync(immutablePath)) return bundleResponse(request, immutablePath, requestedVersion, true);
  }
  const buildResult = await buildScriptUi(scriptDir);
  if (!buildResult.ok || !buildResult.bundlePath || !buildResult.dependencyHash) {
    return json({ error: buildResult.error }, 404);
  }
  if (requestedVersion && requestedVersion !== buildResult.dependencyHash) {
    return json({ error: "bundle version is no longer available" }, 404);
  }
  return bundleResponse(
    request,
    buildResult.bundlePath,
    buildResult.dependencyHash,
    requestedVersion !== null,
  );
}

function bundleResponse(request: Request, bundlePath: string, hash: string, immutable: boolean): Response {
  const etag = `"${hash}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return new Response(readFileSync(bundlePath, "utf8"), {
    headers: {
      "Content-Type": "text/javascript",
      "Cache-Control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      ETag: etag,
    },
  });
}
