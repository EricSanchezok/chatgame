import { WorldHost } from "../../../../../../../server/world-host";
import {
  beginHttpRequest,
  completeHttpRequest,
  errorResponse,
  failHttpRequest,
} from "../../../../../h";
import { serializeRuntimeError } from "../../../../../../../engine/observability";

type Context = { params: Promise<{ id: string; runId: string }> };

export const dynamic = "force-dynamic";

function parseCursor(request: Request): number {
  const url = new URL(request.url);
  const value = request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? "0";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const http = beginHttpRequest(request);
  try {
    const { id, runId } = await context.params;
    const correlation = { ...http.correlation, sessionId: id, runId };
    const host = WorldHost.get();
    host.run(id, runId, correlation);
    const abort = new AbortController();
    const encoder = new TextEncoder();
    const cursor = parseCursor(request);
    const iterator = host.subscribeRunEvents(id, runId, cursor, abort.signal);
    let streamClosed = false;
    http.observe?.({
      event: "sse.connection.opened",
      correlation,
      measurements: { cursor },
    });
    function finishStream(event: "sse.connection.closed" | "sse.connection.cancelled"): void {
      if (streamClosed) return;
      streamClosed = true;
      request.signal.removeEventListener("abort", onRequestAbort);
      http.observe?.({ event, correlation });
    }
    function failStream(error: unknown): void {
      if (streamClosed) return;
      streamClosed = true;
      request.signal.removeEventListener("abort", onRequestAbort);
      http.observe?.({
        event: "sse.connection.failed",
        level: "error",
        correlation,
        error: serializeRuntimeError(error),
      });
    }
    function onRequestAbort(): void {
      abort.abort();
      finishStream("sse.connection.cancelled");
    }
    if (request.signal.aborted) onRequestAbort();
    else request.signal.addEventListener("abort", onRequestAbort, { once: true });
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await iterator.next();
          if (result.done) {
            controller.close();
            finishStream("sse.connection.closed");
            return;
          }
          const event = result.value;
          const encoded = encoder.encode(
            `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
          controller.enqueue(encoded);
          http.observe?.({
            event: "sse.event.sent",
            correlation,
            attributes: { publicEventType: event.type },
            measurements: { publicEventSequence: event.sequence, bytes: encoded.byteLength },
          });
        } catch (error) {
          failStream(error);
          controller.error(error);
        }
      },
      async cancel() {
        abort.abort();
        await iterator.return(undefined);
        finishStream("sse.connection.cancelled");
      },
    });
    const response = new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
    await completeHttpRequest(http, response, false);
    return response;
  } catch (error) {
    failHttpRequest(http, error);
    const response = errorResponse(error);
    await completeHttpRequest(http, response);
    return response;
  }
}
