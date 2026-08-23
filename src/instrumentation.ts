export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getRuntimeObserver } = await import("./server/runtime-observer");
  getRuntimeObserver();
}
