import { WorldHost } from "../../../../../../server/world-host";
import { errorResponse, json } from "../../../../h";

type Context = { params: Promise<{ id: string; runId: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { id, runId } = await context.params;
    return json(WorldHost.get().run(id, runId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(_request: Request, context: Context): Promise<Response> {
  try {
    const { id, runId } = await context.params;
    return json(WorldHost.get().retryRun(id, runId), 202);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  try {
    const { id, runId } = await context.params;
    return json(WorldHost.get().cancelRun(id, runId), 202);
  } catch (error) {
    return errorResponse(error);
  }
}
