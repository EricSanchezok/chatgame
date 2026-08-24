import type { ThreadMessageLike } from "@assistant-ui/react";
import type { WorldRunRecordView } from "../../shared/world-api";
import { worldRunCopyText } from "./world-run-presentation";

function statusFromEvents(
  run: WorldRunRecordView,
  events: WorldRunRecordView["events"],
  lastSegment: boolean,
): WorldRunRecordView["status"] {
  if (lastSegment) return run.status;
  const terminal = [...events].reverse().find((event) =>
    event.type === "run.awaiting_player" || event.type === "run.completed" ||
    event.type === "run.goal_failed" || event.type === "run.step_limit" ||
    event.type === "run.cancelled" || event.type === "run.failed");
  if (!terminal) return "running";
  return terminal.type.slice("run.".length) as WorldRunRecordView["status"];
}

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
  return runs.flatMap((run) => run.inputs.flatMap((input, inputIndex) => {
    const start = run.events.findIndex((event) =>
      event.type === "player.input" && event.payload.id === input.id);
    const nextInput = run.events.findIndex((event, eventIndex) =>
      eventIndex > start && event.type === "player.input");
    const events = run.events.slice(start, nextInput < 0 ? undefined : nextInput);
    const segment: WorldRunRecordView = {
      ...run,
      inputs: [input],
      events,
      status: statusFromEvents(run, events, inputIndex === run.inputs.length - 1),
      createdAt: input.at,
      updatedAt: events.at(-1)?.at ?? input.at,
      error: inputIndex === run.inputs.length - 1 ? run.error : undefined,
    };
    const key = `run:${run.id}:input:${input.id}`;
    return [
      {
        id: `${key}:user`,
        role: "user" as const,
        content: [{ type: "text" as const, text: input.text }],
        createdAt: new Date(input.at),
      },
      {
        id: `${key}:assistant`,
        role: "assistant" as const,
        content: [
          { type: "data" as const, name: "world-run", data: segment },
          { type: "text" as const, text: worldRunCopyText(segment) },
        ],
        createdAt: new Date(segment.updatedAt),
        status: assistantStatus(segment),
      },
    ];
  }));
}
