import { WorldHost } from "../../../../../server/world-host";
import { errorResponse } from "../../../h";

const encoder = new TextEncoder();

function frame(name: string, value: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/events">,
): Promise<Response> {
  const { id } = await params;
  const host = WorldHost.get();
  try {
    host.instance(id);
  } catch (error) {
    return errorResponse(error);
  }
  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        if (pending) clearTimeout(pending);
        try { controller.close(); } catch { /* already closed */ }
      };
      unsubscribe = host.subscribeInstanceChanges(id, () => {
        if (pending) return;
        pending = setTimeout(() => {
          pending = undefined;
          controller.enqueue(frame("changed", { at: new Date().toISOString() }));
        }, 100);
      });
      heartbeat = setInterval(() => {
        controller.enqueue(frame("heartbeat", { at: new Date().toISOString() }));
      }, 15_000);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      if (pending) clearTimeout(pending);
    },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
    },
  });
}
