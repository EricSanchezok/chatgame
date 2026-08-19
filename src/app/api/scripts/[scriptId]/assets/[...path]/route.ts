// Asset file API: serves script assets/* bytes with a whitelisted MIME map.
// Path traversal and non-whitelisted extensions are rejected in the host.
import { EngineHost } from "../../../../../../server/engine-host";
import { errorResponse } from "../../../../../../app/api/h";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ scriptId: string; path: string[] }> },
): Promise<Response> {
  try {
    const { scriptId, path: pathSegments } = await ctx.params;
    const relPath = pathSegments.join("/");
    const { data, mimeType } = EngineHost.get().readAsset(scriptId, relPath);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
