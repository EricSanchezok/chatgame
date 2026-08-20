import { EngineHost } from "../../../../../server/engine-host";
import { previewScriptImportFromZip } from "../../../../../server/script-import";
import { errorResponse, json } from "../../../h";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "请选择 zip 剧本文件" }, 400);
    if (file.size > MAX_IMPORT_BYTES) {
      return json({ error: `zip 文件不能超过 ${MAX_IMPORT_BYTES / 1024 / 1024} MB` }, 413);
    }
    const preview = previewScriptImportFromZip(Buffer.from(await file.arrayBuffer()), {
      sourceName: file.name,
      scriptsRoot: EngineHost.get().scriptLibraryRoot,
    });
    return json(preview, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
