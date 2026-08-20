import { EngineHost } from "../../../../../server/engine-host";
import { commitScriptImport } from "../../../../../server/script-import";
import { errorResponse, json, readJson } from "../../../h";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson<{ token?: unknown; replace?: unknown }>(request);
    if (!body || typeof body.token !== "string" || typeof body.replace !== "boolean") {
      return json({ error: "token 与 replace 为必填字段" }, 400);
    }
    const result = commitScriptImport(body.token, {
      replace: body.replace,
      scriptsRoot: EngineHost.get().scriptLibraryRoot,
    });
    return json(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
