import type { PublicWorldRun } from "../../shared/world-api";

export type RunStatusPresentation = {
  title: string;
  description: string;
  activity: string;
};

function activityDescription(run: PublicWorldRun): string {
  const activity = run.activity;
  if (!activity) {
    return run.status === "queued"
      ? "处理链：等待可用资源 → 生成行动 → 校验规则 → 提交世界边界"
      : "处理链：生成行动 → 校验规则 → 提交世界边界";
  }
  if (activity.status === "queued") {
    return `等待${activity.resourceNames.join("、") || "共享资源"} · 队列第 ${activity.queuePosition ?? 1} 位`;
  }
  if (activity.status === "ready") return "资源已预留 · 等待下一次时间推进";
  const stage = activity.stage ? `阶段：${activity.stage}` : "活动正在推进";
  if (!activity.progress) return stage;
  return `${stage} · ${activity.progress.current.toFixed(2)} / ${activity.progress.target} ${activity.progress.unit}`;
}

export function runStatusPresentation(run: PublicWorldRun, actionText?: string): RunStatusPresentation {
  let title: string;
  let description: string;
  switch (run.status) {
    case "queued":
      title = "正在排队准备世界变化";
      description = "世界已收到请求，正在等待下一次安全推进。";
      break;
    case "pausing":
      title = "正在完成当前世界边界";
      description = "完成后会暂停，不会丢失已经提交的进度。";
      break;
    case "paused":
      title = "世界推进已暂停";
      description = "可以恢复推进，也可以提交新行动替换当前活动。";
      break;
    case "budget-paused":
      title = "本轮推进已达到安全上限";
      description = "恢复后会开启新的推进租约，避免一次运行持续占用资源。";
      break;
    case "preparation-invalidated":
      title = "上次准备已失效，需要重新计算";
      description = "世界状态发生变化，原来的推进方案不会被直接提交。";
      break;
    case "running":
      title = actionText ? "正在处理你的行动" : "世界正在自主推进";
      description = actionText
        ? "正在生成世界回应、检查规则并准备下一次变化。"
        : "正在计算下一次 Agent 行动和世界变化。";
      break;
    default:
      title = "世界正在推进";
      description = "正在准备下一次世界变化。";
  }
  return { title, description, activity: activityDescription(run) };
}

export function runBoundaryLabel(run: PublicWorldRun): string {
  const lease = run.lease;
  if (!lease) return "本轮推进准备中";
  return `本轮推进 ${lease.commitCount} / ${lease.maxCommits} 个世界边界`;
}

export function formatRunElapsed(startedAt?: string, now = Date.now()): string | undefined {
  if (!startedAt) return undefined;
  const timestamp = Date.parse(startedAt);
  if (!Number.isFinite(timestamp)) return undefined;
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes} 分 ${String(remainder).padStart(2, "0")} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${String(minutes % 60).padStart(2, "0")} 分`;
}
