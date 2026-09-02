import { AsyncLocalStorage } from "node:async_hooks";
import type { RuntimeCorrelation } from "../engine/runtime/observability";

const runtimeCorrelation = new AsyncLocalStorage<RuntimeCorrelation>();

export function runWithRuntimeCorrelation<T>(
  correlation: RuntimeCorrelation,
  callback: () => T,
): T {
  return runtimeCorrelation.run(correlation, callback);
}

export function currentRuntimeCorrelation(): RuntimeCorrelation | undefined {
  const correlation = runtimeCorrelation.getStore();
  return correlation ? { ...correlation } : undefined;
}
