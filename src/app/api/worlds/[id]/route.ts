import { WorldHost } from "../../../../server/world-host";
import { observedRoute } from "../../h";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return observedRoute(request, async () => {
    const { id } = await context.params;
    WorldHost.get().deleteWorld(id);
    return new Response(null, { status: 204 });
  });
}
