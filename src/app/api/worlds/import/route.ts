import { WorldHost } from "../../../../server/world-host";
import { MAX_ARCHIVE_BYTES } from "../../../../server/world-import";
import { errorResponse, json } from "../../h";

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "zip file is required" }, 400);
    if (file.size > MAX_ARCHIVE_BYTES) return json({ error: "archive exceeds 50 MiB" }, 413);
    const replace = form.get("replace") === "true";
    const result = WorldHost.get().importWorld(Buffer.from(await file.arrayBuffer()), replace);
    return json(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
