// Shared API helpers: JSON response bodies + HostError mapping. Every
// route handler stays thin — parse input, call EngineHost, serialize.
import { NextResponse } from "next/server";
import { HostError } from "../../server/engine-host";
import { ScriptImportError } from "../../server/script-import";

/** Serializes a successful JSON response. */
export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Maps a host/import error to its HTTP status; unknown errors -> 500. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HostError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ScriptImportError) {
    return NextResponse.json(
      {
        error: err.message,
        issues: err.issues.map((i) => ({ file: i.file, path: i.path, message: i.message })),
      },
      { status: 400 },
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Reads a JSON body (returns undefined on parse failure). */
export async function readJson<T>(request: Request): Promise<T | undefined> {
  try {
    return (await request.json()) as T;
  } catch {
    return undefined;
  }
}
