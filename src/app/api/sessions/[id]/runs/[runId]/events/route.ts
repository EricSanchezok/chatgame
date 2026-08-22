import { WorldHost } from "../../../../../../../server/world-host";
import { errorResponse } from "../../../../../h";

type Context = { params: Promise<{ id: string; runId: string }> };

export const dynamic = "force-dynamic";

function parseCursor(request: Request): number {
  const url = new URL(request.url);
  const value = request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? "0";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { id, runId } = await context.params;
    const host = WorldHost.get();
    host.run(id, runId);
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });
    const encoder = new TextEncoder();
    const iterator = host.subscribeRunEvents(id, runId, parseCursor(request), abort.signal);
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await iterator.next();
          if (result.done) {
            controller.close();
            return;
          }
          const event = result.value;
          controller.enqueue(encoder.encode(
            `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          ));
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        abort.abort();
        await iterator.return(undefined);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
