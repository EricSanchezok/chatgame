import { NextResponse } from "next/server";
import { WorldHostError } from "../../server/world-host";
import { WorldImportError } from "../../server/world-import";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof WorldHostError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof WorldImportError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T | undefined> {
  try {
    return await request.json() as T;
  } catch {
    return undefined;
  }
}
