// Sessions API: create new sessions (or resume from a save) and list active ones.
import { EngineHost } from "../../../server/engine-host";
import { json, errorResponse, readJson } from "../h";

interface CreateBody {
  scriptId: string;
  originId?: string;
  seed?: number;
  playerName?: string;
  /** Save filename (basename, .json) to resume instead of a new game. */
  loadRunId?: string;
}

export async function GET(): Promise<Response> {
  try {
    return json({ sessions: EngineHost.get().listSessions() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson<CreateBody>(request);
    if (!body || typeof body.scriptId !== "string") {
      return json({ error: "scriptId is required" }, 400);
    }
    if (!body.loadRunId && typeof body.originId !== "string") {
      return json({ error: "originId is required for a new game (or pass loadRunId to resume)" }, 400);
    }
    const session = EngineHost.get().createSession({
      scriptId: body.scriptId,
      originId: body.originId,
      seed: body.seed,
      playerName: body.playerName,
      loadRunId: body.loadRunId,
    });
    return json(session, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
