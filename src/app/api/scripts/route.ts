// Script library API: list installed scripts and import new ones (zip).
import type { NextRequest } from "next/server";
import { EngineHost } from "../../../server/engine-host";
import { json, errorResponse } from "../h";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MB zip cap

export async function GET(): Promise<Response> {
  try {
    const scripts = EngineHost.get().listScripts();
    return json({ scripts });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const replace = form.get("replace") === "true";
    if (!(file instanceof File)) {
      return json({ error: "missing zip file (multipart field 'file')" }, 400);
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return json({ error: `zip too large (max ${MAX_IMPORT_BYTES / 1024 / 1024} MB)` }, 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = EngineHost.get().importZip(buffer, replace);
    return json(result, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
