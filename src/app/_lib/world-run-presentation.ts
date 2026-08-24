import type { WorldRunEvent, WorldRunRecordView } from "../../shared/world-api";

type PublicCheckEvent = Extract<WorldRunEvent, { type: "check.resolved" }>;

export const worldRunStatusText: Record<WorldRunRecordView["status"], string> = {
  queued: "行动已进入世界",
  running: "世界正在推演",
  awaiting_player: "等待你的决定",
  completed: "目标已经完成",
  goal_failed: "目标未能完成",
  step_limit: "已到达本次推演上限",
  cancelled: "目标已经结束",
  failed: "这一步未能完成",
};

const emptyNarrativeText: Record<WorldRunRecordView["status"], string> = {
  queued: "世界正在推演…",
  running: "世界正在推演…",
  awaiting_player: "世界在等待你的决定。",
  completed: "目标已经完成。",
  goal_failed: "目标未能完成。",
  step_limit: "本次推演已到上限。你可以继续推演或放弃当前目标。",
  cancelled: "行动已取消，未提交的变化没有写入世界。",
  failed: "这一步没有提交，世界仍停留在上一个已保存状态。",
};

export function worldRunNarrative(run: WorldRunRecordView): string[] {
  const observations = run.events
    .filter((event) => event.type === "player.observation")
    .map((event) => event.payload.summary);
  if (observations.length > 0) return observations;
  const outcomes = run.events
    .filter((event) => event.type === "player.outcome")
    .map((event) => event.payload.summary);
  return outcomes.length > 0 ? outcomes : [emptyNarrativeText[run.status]];
}

export function worldRunCheckText(event: PublicCheckEvent): string {
  return event.payload.visibility === "full" &&
    typeof event.payload.total === "number" &&
    typeof event.payload.dc === "number"
    ? `${event.payload.total} / DC ${event.payload.dc}`
    : "结果已揭示";
}

export function worldRunCopyText(run: WorldRunRecordView): string {
  const checks = run.events
    .filter((event) => event.type === "check.resolved")
    .map((event) => {
      return `${worldRunCheckText(event)} · ${event.payload.succeeded ? "成功" : "失败"}`;
    });
  return [
    ...worldRunNarrative(run),
    ...checks,
    worldRunStatusText[run.status],
    run.error,
  ].filter((line): line is string => Boolean(line)).join("\n\n");
}
