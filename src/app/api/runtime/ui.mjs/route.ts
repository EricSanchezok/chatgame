import { buildUiRuntime } from "@/server/ui-runtime-build";

export async function GET(): Promise<Response> {
  try {
    return new Response(await buildUiRuntime(), {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/javascript",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 500 });
  }
}
