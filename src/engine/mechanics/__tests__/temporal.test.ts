import { describe, expect, it } from "vitest";
import type { ActionOutcome, CausalRef } from "../../contracts/model";
import {
  advanceTemporalState,
  createActivity,
  cancelActivity,
  explicitDurationSeconds,
  materializeTemporalPlan,
  materializeTrustedTemporalPlan,
  pauseActivity,
  resumeActivity,
  reconcileTemporalOutcomes,
  selectTemporalBoundary,
  validateActivityState,
  validateActivityResources,
  validateTemporalPlan,
  validateTemporalProfile,
  type ActivityResourceDefinition,
  type TemporalPlanDraft,
  type TemporalPlan,
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
    reactionFallback: "continue_if_valid",
    resourceClaims: [{ resourceId: "foreground", amount: 1 }],
    ...overrides,
  };
}

function draft(profileId: string, basis: TemporalPlanDraft["basis"] = { kind: "profile" }): TemporalPlanDraft {
  return {
    profileId,
    basis,
    description: "执行行动",
    continuationAssertions: [],
    causes: actionCause,
  };
}

function sourceAction(plan: TemporalPlan) {
  return {
    id: plan.actionId,
    actorId: plan.actorId,
    baseRevision: 0,
    rawText: plan.description,
    goal: plan.description,
    means: null,
    targetIds: [],
  };
}

describe("event-boundary temporal kernel", () => {
  it("permits authored reaction fallbacks only on interruptible profiles", () => {
    expect(() => validateTemporalProfile(fixedProfile({ reactionFallback: "pause" }), resources)).not.toThrow();
    expect(() => validateTemporalProfile(fixedProfile({
      interruptible: false,
      reactionFallback: "cancel",
    }), resources)).toThrow("non-interruptible");
  });

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

  it("re-derives persisted schedules and source grounding at the canonical boundary", () => {
    const explicit = fixedProfile({
      id: "explicit-rest",
      name: "明确休息",
      durationSeconds: 60,
      checkpointSeconds: 3_600,
      allowExplicitDuration: true,
    });
    const plan = materializeTemporalPlan({
      id: "plan-rest",
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
    const action = { ...sourceAction(plan), rawText: "我要睡一天觉" };
    const activity = createActivity({ id: "activity-rest", plan, sourceAction: action });
    expect(() => validateActivityState(
      activity,
      100,
      { "explicit-rest": explicit },
      resources,
    )).not.toThrow();

    const forgedSchedule = structuredClone(plan);
    forgedSchedule.completionAtSeconds = 101;
    expect(() => validateTemporalPlan(
      forgedSchedule,
      { "explicit-rest": explicit },
      resources,
    )).toThrow("trusted profile schedule");

    const forgedSource = structuredClone(activity);
    forgedSource.sourceAction.rawText = "我要休息";
    expect(() => validateActivityState(
      forgedSource,
      100,
      { "explicit-rest": explicit },
      resources,
    )).toThrow("not grounded");
  });

  it("accepts only self-consistent Rule Package temporal results with mechanic provenance", () => {
    const profile = fixedProfile({ durationSeconds: 10, checkpointSeconds: 5 });
    const plan = materializeTrustedTemporalPlan({
      id: "plan-mechanic",
      actionId: "action-a",
      actorId: "agent-a",
      startsAtSeconds: 20,
      profile,
      invocationId: "invoke-a",
      durationSeconds: 7,
      checkpointSeconds: 2,
      progress: null,
      description: "规则结算",
      causes: [{ kind: "mechanic", id: "invoke-a" }],
    });
    expect(() => validateTemporalPlan(plan, { brief: profile }, resources)).not.toThrow();
    const forged = structuredClone(plan);
    forged.completionAtSeconds = 99;
    expect(() => validateTemporalPlan(forged, { brief: profile }, resources))
      .toThrow("mechanic result");
    const unproven = structuredClone(plan);
    unproven.causes = actionCause;
    expect(() => validateTemporalPlan(unproven, { brief: profile }, resources))
      .toThrow("untrusted mechanic basis");
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
      reactionFallback: "continue_if_valid",
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
    const activity = createActivity({ id: "activity-travel", plan, sourceAction: sourceAction(plan) });
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
    const advancedActivity = advanced.activities[activity.id]!;
    expect(advancedActivity.status).toBe("active");
    if (advancedActivity.status !== "active") throw new Error("travel Activity did not stay scheduled");
    expect(advancedActivity.progress).toEqual({ current: 10, target: 100, unit: "km" });
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
    const activity = createActivity({ id: "activity-rest", plan, sourceAction: sourceAction(plan) });
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
    const advancedActivity = advanced.activities[activity.id]!;
    expect(advancedActivity.status).toBe("active");
    if (advancedActivity.status !== "active") throw new Error("timer interrupted the Activity schedule");
    expect(advancedActivity.updatedAtSeconds).toBe(600);
    expect(advancedActivity.nextBoundaryAtSeconds).toBe(3_600);
    expect(advanced.decisionPoints).toContainEqual({
      agentId: "agent-a",
      reason: "timer",
      activityId: null,
      timerId: "fire",
    });
  });

  it("lets a short independent action finish while a long Activity remains occupied", () => {
    const longPlan = materializeTemporalPlan({
      id: "plan-sleep",
      actionId: "action-sleep",
      actorId: "agent-a",
      rawText: "睡到早上六点",
      startsAtSeconds: 0,
      draft: { ...draft("sleep"), causes: [{ kind: "action", id: "action-sleep" }] },
      profiles: { sleep: fixedProfile({ id: "sleep", durationSeconds: 28_800, checkpointSeconds: 28_800 }) },
    });
    const shortPlan = materializeTemporalPlan({
      id: "plan-step",
      actionId: "action-step",
      actorId: "agent-b",
      rawText: "向前走一步",
      startsAtSeconds: 0,
      draft: { ...draft("step"), causes: [{ kind: "action", id: "action-step" }] },
      profiles: { step: fixedProfile({ id: "step", durationSeconds: 2, checkpointSeconds: 2 }) },
    });
    const sleeping = createActivity({ id: "activity-sleep", plan: longPlan, sourceAction: sourceAction(longPlan) });
    const walking = createActivity({ id: "activity-step", plan: shortPlan, sourceAction: sourceAction(shortPlan) });
    const boundary = selectTemporalBoundary({
      elapsedSeconds: 0,
      maxAutonomousSpanSeconds: 30_000,
      activities: { [sleeping.id]: sleeping, [walking.id]: walking },
      timers: {},
      conditionExpiries: {},
    });
    const advanced = advanceTemporalState({
      boundary,
      activities: { [sleeping.id]: sleeping, [walking.id]: walking },
      timers: {},
    });

    expect(boundary).toMatchObject({ toElapsedSeconds: 2, deltaSeconds: 2, dueActivityIds: ["activity-step"] });
    expect(advanced.activities["activity-sleep"]).toMatchObject({
      status: "active",
      updatedAtSeconds: 2,
      nextBoundaryAtSeconds: 28_800,
    });
    expect(advanced.decisionPoints).toEqual([{
      agentId: "agent-b",
      reason: "activity_completed",
      activityId: "activity-step",
      timerId: null,
    }]);
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
      reactionFallback: "continue_if_valid",
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
    let activity = createActivity({ id: "activity-treatment", plan, sourceAction: sourceAction(plan) });
    let boundary = selectTemporalBoundary({
      elapsedSeconds: 0,
      maxAutonomousSpanSeconds: 1_000,
      activities: { [activity.id]: activity },
      timers: {},
      conditionExpiries: {},
    });
    let advanced = advanceTemporalState({ boundary, activities: { [activity.id]: activity }, timers: {} });
    const firstAdvanced = advanced.activities[activity.id]!;
    if (firstAdvanced.status === "queued" || firstAdvanced.status === "ready") {
      throw new Error("staged Activity lost its schedule");
    }
    activity = firstAdvanced;
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
      const next = advanced.activities[activity.id]!;
      if (next.status === "queued" || next.status === "ready") throw new Error("staged Activity lost its schedule");
      activity = next;
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
    const make = (id: string) => {
      const plan = materializeTemporalPlan({
        id: `plan-${id}`,
        actionId: `action-${id}`,
        actorId: "agent-a",
        rawText: "行动",
        startsAtSeconds: 0,
        draft: { ...draft("brief"), causes: [{ kind: "action", id: `action-${id}` }] },
        profiles: { brief: profile },
      });
      return createActivity({ id, plan, sourceAction: sourceAction(plan) });
    };
    const first = make("first");
    const second = make("second");
    expect(() => validateActivityResources({ first, second }, resources)).toThrow("exceeds activity resource");
    const paused = pauseActivity(first, 0);
    expect(paused.activity.status).toBe("paused");
    expect(paused.activity.nextBoundaryAtSeconds).toBeNull();
    const resumed = resumeActivity(paused.activity, 0);
    expect(resumed.activity.status).toBe("active");
    expect(resumed.activity.nextBoundaryAtSeconds).toBe(5);
    const cancelled = cancelActivity(resumed.activity, 0);
    expect(cancelled.activity).toMatchObject({ status: "cancelled", nextBoundaryAtSeconds: null });
  });

  it("ends conditional work only when the boundary outcome satisfies it", () => {
    const conditional: TemporalProfileDefinition = {
      id: "daybreak",
      name: "等待天亮",
      kind: "conditional",
      checkEverySeconds: 60,
      interruptible: true,
      reactionFallback: "continue_if_valid",
      resourceClaims: [{ resourceId: "foreground", amount: 1 }],
    };
    const plan = materializeTemporalPlan({
      id: "plan-daybreak",
      actionId: "action-a",
      actorId: "agent-a",
      rawText: "等待天亮",
      startsAtSeconds: 0,
      draft: draft("daybreak"),
      profiles: { daybreak: conditional },
    });
    const activity = createActivity({ id: "activity-daybreak", plan, sourceAction: sourceAction(plan) });
    const boundary = selectTemporalBoundary({
      elapsedSeconds: 0,
      maxAutonomousSpanSeconds: 300,
      activities: { [activity.id]: activity },
      timers: {},
      conditionExpiries: {},
    });
    const advanced = advanceTemporalState({ boundary, activities: { [activity.id]: activity }, timers: {} });
    const completed = reconcileTemporalOutcomes(advanced, [{
      proposalId: "action-a",
      status: "succeeded",
    } as ActionOutcome]);
    expect(completed.activities[activity.id]).toMatchObject({
      status: "completed",
      completionAtSeconds: 60,
      updatedAtSeconds: 60,
    });
    expect(completed.transitions[0]!.kind).toBe("completed");
    expect(completed.decisionPoints[0]).toMatchObject({ reason: "activity_completed" });
  });
});
