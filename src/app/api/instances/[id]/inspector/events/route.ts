import { randomUUID } from "node:crypto";
import type { WorldInspectorStreamEvent } from "../../../../../../shared/world-inspector-api";
import { WorldHost } from "../../../../../../server/world-host";

const encoder = new TextEncoder();

function frame(name: string, value: WorldInspectorStreamEvent): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/instances/[id]/inspector/events">,
): Promise<Response> {
  const { id } = await params;
  const host = WorldHost.get();
  host.instance(id);
  const epoch = randomUUID();
  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      };
      unsubscribe = host.subscribeInspectorEvents(id, (event) => {
        controller.enqueue(frame("runtime", { type: "runtime", epoch, event }));
      });
      heartbeat = setInterval(() => {
        controller.enqueue(frame("heartbeat", { type: "heartbeat", epoch, at: new Date().toISOString() }));
      }, 15_000);
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
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
