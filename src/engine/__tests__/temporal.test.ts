import { describe, expect, it } from "vitest";
import type { CausalRef } from "../model";
import {
  advanceTemporalState,
  createActivity,
  explicitDurationSeconds,
  materializeTemporalPlan,
  pauseActivity,
  resumeActivity,
  selectTemporalBoundary,
  validateActivityResources,
  validateTemporalProfile,
  type ActivityResourceDefinition,
  type TemporalPlanDraft,
  type TemporalProfileDefinition,
  type WorldTimer,
} from "../temporal";

const actionCause: CausalRef[] = [{ kind: "action", id: "action-a" }];
const resources: Record<string, ActivityResourceDefinition> = {
  foreground: { id: "foreground", name: "前台行动", capacity: 1 },
};

function fixedProfile(overrides: Partial<Extract<TemporalProfileDefinition, { kind: "fixed" }>> = {}): TemporalProfileDefinition {
  return {
    id: "brief",
    name: "短动作",
    kind: "fixed",
    durationSeconds: 1,
    checkpointSeconds: 1,
    allowExplicitDuration: false,
    interruptible: true,
    resourceClaims: [{ resourceId: "foreground", amount: 1 }],
    ...overrides,
  };
}

function draft(profileId: string, basis: TemporalPlanDraft["basis"] = { kind: "profile" }): TemporalPlanDraft {
  return {
    profileId,
    basis,
    description: "执行行动",
    conditionAssertions: [],
    causes: actionCause,
  };
}

describe("event-boundary temporal kernel", () => {
  it("recognizes grounded Chinese and English explicit durations", () => {
    expect(explicitDurationSeconds("我要睡一天觉")).toBe(86_400);
    expect(explicitDurationSeconds("wait 1.5 hours")).toBe(5_400);
    expect(explicitDurationSeconds("休息半小时")).toBe(1_800);
    expect(explicitDurationSeconds("走到城镇")).toBeNull();
  });

  it("materializes fixed and explicit-duration plans without model-owned clock writes", () => {
    const explicit = fixedProfile({
      id: "explicit-rest",
      name: "明确休息",
      durationSeconds: 60,
      checkpointSeconds: 3_600,
      allowExplicitDuration: true,
    });
    validateTemporalProfile(explicit, resources);
    const plan = materializeTemporalPlan({
      id: "plan-a",
      actionId: "action-a",
      actorId: "agent-a",
      rawText: "我要睡一天觉",
      startsAtSeconds: 100,
      draft: draft("explicit-rest", {
        kind: "explicit_duration",
        seconds: 86_400,
        sourceText: "一天",
      }),
      profiles: { "explicit-rest": explicit },
    });
    expect(plan.completionAtSeconds).toBe(86_500);
    expect(plan.checkpointSeconds).toBe(3_600);
    expect(() => materializeTemporalPlan({
      id: "plan-b",
      actionId: "action-a",
      actorId: "agent-a",
      rawText: "我要睡一天觉",
      startsAtSeconds: 100,
      draft: draft("explicit-rest", {
        kind: "explicit_duration",
        seconds: 3_600,
        sourceText: "一天",
      }),
      profiles: { "explicit-rest": explicit },
    })).toThrow("not grounded");
  });

  it("derives rate duration and progress from an explicit action quantity", () => {
    const travel: TemporalProfileDefinition = {
      id: "road-travel",
      name: "道路步行",
      kind: "rate",
      unit: "km",
      unitAliases: ["公里", "kilometers", "kilometres"],
      unitsPerPeriod: 5,
      periodSeconds: 3_600,
      checkpointUnits: 10,
      interruptible: true,
      resourceClaims: [{ resourceId: "foreground", amount: 1 }],
    };
    validateTemporalProfile(travel, resources);
    const plan = materializeTemporalPlan({
      id: "plan-travel",
      actionId: "action-a",
      actorId: "agent-a",
      rawText: "沿道路走到100公里外的城镇",
      startsAtSeconds: 0,
      draft: draft("road-travel", {
        kind: "explicit_quantity",
        amount: 100,
        unit: "公里",
        sourceText: "100公里",
      }),
      profiles: { "road-travel": travel },
    });
    const activity = createActivity({ id: "activity-travel", plan });
    expect(plan.completionAtSeconds).toBe(72_000);
    expect(activity.nextBoundaryAtSeconds).toBe(7_200);
    const boundary = selectTemporalBoundary({
      elapsedSeconds: 0,
      maxAutonomousSpanSeconds: 30_000,
      activities: { [activity.id]: activity },
      timers: {},
      conditionExpiries: {},
    });
    const advanced = advanceTemporalState({ boundary, activities: { [activity.id]: activity }, timers: {} });
    expect(boundary.deltaSeconds).toBe(7_200);
    expect(advanced.activities[activity.id]!.progress).toEqual({ current: 10, target: 100, unit: "km" });
    expect(advanced.activities[activity.id]!.status).toBe("active");
    expect(advanced.decisionPoints).toEqual([]);
  });

  it("chooses an earlier timer over a long activity checkpoint and fires all same-time timers", () => {
    const plan = materializeTemporalPlan({
      id: "plan-rest",
      actionId: "action-a",
      actorId: "agent-a",
      rawText: "休息",
      startsAtSeconds: 0,
      draft: draft("rest"),
      profiles: { rest: fixedProfile({ id: "rest", durationSeconds: 86_400, checkpointSeconds: 3_600 }) },
    });
    const activity = createActivity({ id: "activity-rest", plan });
    const timers: Record<string, WorldTimer> = Object.fromEntries(["fire", "deadline"].map((id) => [id, {
      id,
      description: id,
      createdAtSeconds: 0,
      dueAtSeconds: 600,
      status: "scheduled" as const,
      wakeAgentIds: id === "fire" ? ["agent-a"] : [],
      causes: actionCause,
      assertions: [{ kind: "elapsed_seconds_compare" as const, operator: "eq" as const, value: 600 }],
    }]));
    const boundary = selectTemporalBoundary({
      elapsedSeconds: 0,
      maxAutonomousSpanSeconds: 10_000,
      activities: { [activity.id]: activity },
      timers,
      conditionExpiries: {},
    });
    expect(boundary.toElapsedSeconds).toBe(600);
    expect(boundary.dueTimerIds).toEqual(["deadline", "fire"]);
    const advanced = advanceTemporalState({ boundary, activities: { [activity.id]: activity }, timers });
    expect(advanced.timers.fire!.status).toBe("fired");
    expect(advanced.timers.deadline!.status).toBe("fired");
    expect(advanced.activities[activity.id]!.status).toBe("active");
    expect(advanced.decisionPoints).toContainEqual({
      agentId: "agent-a",
      reason: "timer",
      activityId: null,
      timerId: "fire",
    });
  });

  it("advances staged work and creates a decision point only at completion", () => {
    const treatment: TemporalProfileDefinition = {
      id: "treatment",
      name: "分阶段治疗",
      kind: "staged",
      stages: [
        { id: "assessment", name: "检查", durationSeconds: 60, checkpointSeconds: 60 },
        { id: "treatment", name: "处理", durationSeconds: 300, checkpointSeconds: 120 },
      ],
      interruptible: true,
      resourceClaims: [{ resourceId: "foreground", amount: 1 }],
    };
    const plan = materializeTemporalPlan({
      id: "plan-treatment",
      actionId: "action-a",
      actorId: "agent-a",
      rawText: "处理伤口",
      startsAtSeconds: 0,
      draft: draft("treatment"),
      profiles: { treatment },
    });
    let activity = createActivity({ id: "activity-treatment", plan });
    let boundary = selectTemporalBoundary({
      elapsedSeconds: 0,
      maxAutonomousSpanSeconds: 1_000,
      activities: { [activity.id]: activity },
      timers: {},
      conditionExpiries: {},
    });
    let advanced = advanceTemporalState({ boundary, activities: { [activity.id]: activity }, timers: {} });
    activity = advanced.activities[activity.id]!;
    expect(activity.stageIndex).toBe(1);
    expect(advanced.transitions[0]!.kind).toBe("stage_changed");
    expect(advanced.decisionPoints).toEqual([]);
    while (activity.status === "active") {
      boundary = selectTemporalBoundary({
        elapsedSeconds: activity.updatedAtSeconds,
        maxAutonomousSpanSeconds: 1_000,
        activities: { [activity.id]: activity },
        timers: {},
        conditionExpiries: {},
      });
      advanced = advanceTemporalState({ boundary, activities: { [activity.id]: activity }, timers: {} });
      activity = advanced.activities[activity.id]!;
    }
    expect(activity.updatedAtSeconds).toBe(360);
    expect(activity.status).toBe("completed");
    expect(advanced.decisionPoints).toEqual([{
      agentId: "agent-a",
      reason: "activity_completed",
      activityId: "activity-treatment",
      timerId: null,
    }]);
  });

  it("enforces per-Agent resource capacity and supports control-plane pause/resume", () => {
    const profile = fixedProfile({ durationSeconds: 10, checkpointSeconds: 5 });
    const make = (id: string) => createActivity({
      id,
      plan: materializeTemporalPlan({
        id: `plan-${id}`,
        actionId: `action-${id}`,
        actorId: "agent-a",
        rawText: "行动",
        startsAtSeconds: 0,
        draft: { ...draft("brief"), causes: [{ kind: "action", id: `action-${id}` }] },
        profiles: { brief: profile },
      }),
    });
    const first = make("first");
    const second = make("second");
    expect(() => validateActivityResources({ first, second }, resources)).toThrow("exceeds activity resource");
    const paused = pauseActivity(first, 0);
    expect(paused.activity.status).toBe("paused");
    expect(paused.activity.nextBoundaryAtSeconds).toBeNull();
    const resumed = resumeActivity(paused.activity, 0);
    expect(resumed.activity.status).toBe("active");
    expect(resumed.activity.nextBoundaryAtSeconds).toBe(5);
  });
});
