// Entity asset API: resolves an asset for an entity id — declared file
// first, then prompt generation via the media provider (cached on disk).
// 404 when the entity has no asset and no usable prompt (UI degrades).
import { EngineHost } from "../../../../../../../server/engine-host";
import { errorResponse } from "../../../../../../../app/api/h";

const KINDS = new Set([
  "portraits",
  "backgrounds",
  "icons",
  "sprites",
  "voices",
  "ambient",
  "effects",
]);

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ scriptId: string; kind: string; entityId: string }> },
): Promise<Response> {
  try {
    const { scriptId, kind, entityId } = await ctx.params;
    if (!KINDS.has(kind)) {
      return new Response(JSON.stringify({ error: `unknown asset kind "${kind}"` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const resolved = await EngineHost.get().resolveAsset(
      scriptId,
      kind as Parameters<EngineHost["resolveAsset"]>[1],
      entityId,
    );
    if (!resolved) {
      return new Response(JSON.stringify({ error: "asset not available" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(new Uint8Array(resolved.data), {
      status: 200,
      headers: {
        "Content-Type": resolved.mimeType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
