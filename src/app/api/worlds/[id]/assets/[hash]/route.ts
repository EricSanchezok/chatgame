import { WorldHost } from "../../../../../../server/world-host";
import { observedRoute } from "../../../../h";

export async function GET(request: Request, { params }: RouteContext<"/api/worlds/[id]/assets/[hash]">): Promise<Response> {
  return observedRoute(request, async () => {
    const { id, hash } = await params;
    const asset = WorldHost.get().worldAsset(id, decodeURIComponent(hash));
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "content-type": asset.mime,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
