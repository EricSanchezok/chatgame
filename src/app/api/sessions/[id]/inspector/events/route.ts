import { WorldHost } from "../../../../../../server/world-host";
import type { WorldInspectorStreamEvent } from "../../../../../../shared/world-inspector-api";
import {
  beginHttpRequest,
  completeHttpRequest,
  errorResponse,
  failHttpRequest,
} from "../../../../h";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

function parseCursor(request: Request): { epoch?: string; sequence?: number } {
  const url = new URL(request.url);
  const raw = request.headers.get("last-event-id") ?? url.searchParams.get("after");
  if (!raw) return {};
  const match = /^([^:]+):(0|[1-9]\d*)$/.exec(raw);
  if (!match) return { epoch: "invalid", sequence: 0 };
  const sequence = Number(match[2]);
  if (!Number.isSafeInteger(sequence)) return { epoch: "invalid", sequence: 0 };
  return { epoch: match[1], sequence };
}

function encode(id: string, event: WorldInspectorStreamEvent): Uint8Array {
  return new TextEncoder().encode(`id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const http = beginHttpRequest(request);
  try {
    const { id } = await context.params;
    const host = WorldHost.get();
    host.session(id, { ...http.correlation, sessionId: id });
    const state = host.inspectorStreamState();
    const cursor = parseCursor(request);
    const staleEpoch = cursor.epoch !== undefined && cursor.epoch !== state.epoch;
    const expired = cursor.sequence !== undefined && state.earliest > 0 && cursor.sequence < state.earliest - 1;
    const ahead = cursor.sequence !== undefined && cursor.sequence > state.latest;
    const shouldResync = staleEpoch || expired || ahead;
    const startSequence = shouldResync || cursor.sequence === undefined ? state.latest : cursor.sequence;
    let cursorSequence = startSequence;
    const abort = new AbortController();
    const iterator = host.subscribeInspectorEvents(id, startSequence, abort.signal);
    let pending = iterator.next();
    let first = shouldResync;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      request.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      abort.abort();
      finish();
    };
    if (request.signal.aborted) onAbort();
    else request.signal.addEventListener("abort", onAbort, { once: true });
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (first) {
          first = false;
          const event: WorldInspectorStreamEvent = {
            type: "resync",
            epoch: state.epoch,
            reason: staleEpoch ? "epoch_changed" : "cursor_expired",
          };
          controller.enqueue(encode(`${state.epoch}:${state.latest}`, event));
          return;
        }
        let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          pending.then((value) => ({ kind: "event" as const, value })),
          new Promise<{ kind: "heartbeat" }>((resolve) => {
            heartbeatTimer = setTimeout(() => resolve({ kind: "heartbeat" }), 15_000);
          }),
        ]);
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        if (result.kind === "heartbeat") {
          const event: WorldInspectorStreamEvent = {
            type: "heartbeat",
            epoch: state.epoch,
            at: new Date().toISOString(),
          };
          controller.enqueue(encode(`${state.epoch}:${cursorSequence}`, event));
          return;
        }
        pending = iterator.next();
        if (result.value.done) {
          controller.close();
          finish();
          return;
        }
        const runtime = result.value.value;
        cursorSequence = runtime.sequence;
        const event: WorldInspectorStreamEvent = { type: "runtime", epoch: state.epoch, event: runtime };
        controller.enqueue(encode(`${state.epoch}:${runtime.sequence}`, event));
      },
      async cancel() {
        abort.abort();
        await iterator.return(undefined);
        finish();
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
