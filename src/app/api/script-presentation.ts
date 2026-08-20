import path from "node:path";
import type { EngineHost } from "../../server/engine-host";
import type { ScriptUiBundleDescriptor, SessionPresentation } from "../../shared/client-dto";
import { buildScriptUi } from "../../server/script-ui-build";

export async function scriptUiBundle(
  host: EngineHost,
  scriptId: string,
): Promise<ScriptUiBundleDescriptor | undefined> {
  const result = await buildScriptUi(path.join(host.scriptLibraryRoot, scriptId));
  if (!result.ok || !result.apiVersion || !result.dependencyHash || !result.url) return undefined;
  return {
    apiVersion: result.apiVersion,
    dependencyHash: result.dependencyHash,
    url: result.url,
  };
}

export async function completeSessionPresentation(
  host: EngineHost,
  sessionId: string,
): Promise<SessionPresentation> {
  const presentation = host.sessionPresentation(sessionId);
  const scriptId = host.state(sessionId).scriptId;
  return {
    ...presentation,
    uiBundle: await scriptUiBundle(host, scriptId),
  };
}
