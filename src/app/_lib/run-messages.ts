import type { ThreadMessageLike } from "@assistant-ui/react";
import type { WorldRunRecordView } from "../../shared/world-api";

function assistantStatus(run: WorldRunRecordView): ThreadMessageLike["status"] {
  switch (run.status) {
    case "queued":
    case "running":
      return { type: "running" };
    case "failed":
      return { type: "incomplete", reason: "error" };
    case "cancelled":
      return { type: "incomplete", reason: "cancelled" };
    default:
      return { type: "complete", reason: "stop" };
  }
}

export function runsToMessages(runs: WorldRunRecordView[]): ThreadMessageLike[] {
  return runs.flatMap((run) => [
    {
      id: `run:${run.id}:user`,
      role: "user" as const,
      content: [{ type: "text" as const, text: run.text }],
      createdAt: new Date(run.createdAt),
    },
    {
      id: `run:${run.id}:assistant`,
      role: "assistant" as const,
      content: [{ type: "data" as const, name: "world-run", data: run }],
      createdAt: new Date(run.updatedAt),
      status: assistantStatus(run),
    },
  ]);
}
