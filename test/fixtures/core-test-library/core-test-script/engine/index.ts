import type { EngineExtensionContext } from "../../../../../src/engine/extensions";

export default function registerCoreTestEngine(context: EngineExtensionContext): void {
  context.onSessionStart((state) => ({
    state: {
      ...state,
      runtimeState: {
        ...state.runtimeState,
        coreTestEngine: "v2-ready",
      },
    },
    summaries: ["core test Engine API v2 session_start completed"],
  }));
}
