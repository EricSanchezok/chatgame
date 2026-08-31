import { describe, expect, it } from "vitest";
import type { InteractionDependency } from "../../runtime/execution";
import type { AgentActionProposal, CausalAssertion, SimulationState, WorldEntity } from "../../contracts/model";
import {
  applySharedResourceAdmissions,
  planSharedResourceAdmissions,
  promoteSharedResourceQueues,
  sharedResourceQueuePositions,
  validateSharedResourceCapacity,
} from "../shared-resource-allocation";
import type {
  SharedActivityResourceClaim,
  SharedActivityResourceDefinition,
  SharedActivityResourcePool,
} from "../shared-activity-resources";
import {
  blockScheduledActivity,
  createActivity,
  evaluateActivityContinuation,
  materializeTemporalPlan,
  pauseActivity,
  queueScheduledActivity,
  reserveQueuedActivity,
  resumeActivity,
  startReadyActivity,
  type ActivityState,
  type ScheduledActivityState,
  type TemporalProfileDefinition,
} from "../temporal";

const profile: TemporalProfileDefinition = {
  id: "work",
  name: "工作",
  kind: "fixed",
  durationSeconds: 60,
  checkpointSeconds: 30,
  selection: { semanticTags: ["short"], evidenceRequirement: "none" },
  interruptible: true,
  reactionFallback: "continue_if_valid",
  resourceClaims: [{ resourceId: "foreground", amount: 1 }],
};

const activeEntity = (id: string): WorldEntity => ({
  id,
  kind: "resource",
  name: id,
  description: id,
  lifecycle: "active",
  createdAtStep: 0,
});

function resource(
  id: string,
  contention: SharedActivityResourceDefinition["contention"],
  pausedRetention: SharedActivityResourceDefinition["pausedRetention"] = "retain",
  capacity = 1,
) {
  const definition: SharedActivityResourceDefinition = {
    id,
    name: id,
    unit: "份",
    defaultClaimAmount: 1,
    allowExplicitAmount: false,
    contention,
    pausedRetention,
  };
  const pool: SharedActivityResourcePool = {
    id: `pool-${id}`,
    definitionId: id,
    entityId: `entity-${id}`,
    capacity,
  };
  return { definition, pool, entity: activeEntity(pool.entityId) };
}

function activity(
  id: string,
  claims: SharedActivityResourceClaim[],
  atSeconds = 0,
  continuationAssertions: CausalAssertion[] = [],
): ScheduledActivityState {
  const action: AgentActionProposal = {
    id: `action-${id}`,
    actorId: `agent-${id}`,
    baseRevision: 0,
    rawText: `执行${id}`,
    goal: `执行${id}`,
    means: null,
    targetIds: [],
  };
  const plan = materializeTemporalPlan({
    id: `plan-${id}`,
    actionId: action.id,
    actorId: action.actorId,
    rawText: action.rawText,
    startsAtSeconds: atSeconds,
    draft: {
      profileId: profile.id,
      basis: { kind: "profile" },
      description: action.rawText,
      continuationAssertions,
      causes: [{ kind: "action", id: action.id }],
    },
    profiles: { [profile.id]: profile },
  });
  const footprint: InteractionDependency = {
    kind: "activity",
    id: `activity-${id}`,
    actorId: action.actorId,
    reads: claims.map((claim) => ({ kind: "shared_resource_pool" as const, id: claim.poolId })),
    writes: claims.map((claim) => ({ kind: "shared_resource_pool" as const, id: claim.poolId })),
    audienceAgentIds: [action.actorId],
    sharedResourceClaims: structuredClone(claims),
    globalFallback: false,
  };
  return createActivity({ id: footprint.id, plan, sourceAction: action, interactionFootprint: footprint });
}

function claim(resourceValue: ReturnType<typeof resource>, amount = 1): SharedActivityResourceClaim {
  return {
    poolId: resourceValue.pool.id,
    definitionId: resourceValue.definition.id,
    entityId: resourceValue.entity.id,
    amount,
    basis: amount === resourceValue.definition.defaultClaimAmount
      ? { kind: "default" }
      : { kind: "mechanic", invocationId: `mechanic-${amount}` },
  };
}

function catalog(resources: ReturnType<typeof resource>[]) {
  return {
    definitions: Object.fromEntries(resources.map((entry) => [entry.definition.id, entry.definition])),
    pools: Object.fromEntries(resources.map((entry) => [entry.pool.id, entry.pool])),
    entities: Object.fromEntries(resources.map((entry) => [entry.entity.id, entry.entity])),
  };
}

describe("shared physical resource allocator", () => {
  it("deterministically rejects a later claim without asking Truth to exceed a unique resource", () => {
    const horse = resource("horse", "reject");
    const first = activity("first", [claim(horse)]);
    const second = activity("second", [claim(horse)]);
    const state = { [first.id]: first, [second.id]: second };
    expect(planSharedResourceAdmissions({
      activities: state,
      proposalActivityIds: [second.id],
      ...catalog([horse]),
    }).admissions).toEqual([{
      kind: "reject",
      activityId: second.id,
      shortagePoolIds: [horse.pool.id],
    }]);
  });

  it("queues by simulation time and stable id, reserves atomically, and never bypasses the component head", () => {
    const bench = resource("bench", "queue");
    const tool = resource("tool", "queue");
    const holder = activity("holder", [claim(bench)]);
    const first = queueScheduledActivity(activity("a-first", [claim(bench), claim(tool)]), 0).activity;
    const second = queueScheduledActivity(activity("b-second", [claim(bench)]), 0).activity;
    const unrelated = resource("kiln", "queue");
    const other = queueScheduledActivity(activity("other", [claim(unrelated)]), 0).activity;
    const input = {
      activities: { [holder.id]: holder, [first.id]: first, [second.id]: second, [other.id]: other },
      ...catalog([bench, tool, unrelated]),
      atSeconds: 30,
    };
    const promoted = promoteSharedResourceQueues(input);
    expect(promoted.activities[first.id]?.status).toBe("queued");
    expect(promoted.activities[second.id]?.status).toBe("queued");
    expect(promoted.activities[other.id]?.status).toBe("ready");
    expect(promoted.stoppedComponentHeads).toEqual([first.id]);
    expect(sharedResourceQueuePositions(promoted.activities).get(first.id)).toBe(1);
    expect(sharedResourceQueuePositions(promoted.activities).get(second.id)).toBe(2);

    const released = structuredClone(promoted.activities);
    released[holder.id] = { ...released[holder.id]!, status: "completed", nextBoundaryAtSeconds: null } as ActivityState;
    const afterRelease = promoteSharedResourceQueues({ ...input, activities: released, atSeconds: 60 });
    expect(afterRelease.activities[first.id]?.status).toBe("ready");
    expect(afterRelease.activities[second.id]?.status).toBe("queued");
    const afterHeadCancellation = structuredClone(afterRelease.activities);
    delete afterHeadCancellation[first.id];
    const advanced = promoteSharedResourceQueues({ ...input, activities: afterHeadCancellation, atSeconds: 90 });
    expect(advanced.activities[second.id]?.status).toBe("ready");
  });

  it("routes mixed claims by adjudicate > queue > reject while retaining hard capacity", () => {
    const boat = resource("boat", "adjudicate");
    const pass = resource("pass", "reject");
    const holder = activity("holder", [claim(boat)]);
    const contender = activity("contender", [claim(boat), claim(pass)]);
    const values = catalog([boat, pass]);
    expect(planSharedResourceAdmissions({
      activities: { [holder.id]: holder, [contender.id]: contender },
      proposalActivityIds: [contender.id],
      ...values,
    }).admissions).toEqual([{
      kind: "adjudicate",
      activityId: contender.id,
      shortagePoolIds: [boat.pool.id],
      competingActivityIds: [holder.id],
    }]);
    expect(() => validateSharedResourceCapacity({
      activities: { [holder.id]: holder, [contender.id]: contender },
      ...values,
    })).toThrow("exceeds capacity");
  });

  it("allows exactly four claims and routes the fifth by the authored policy", () => {
    const wagon = resource("wagon", "queue", "retain", 4);
    const holders = Object.fromEntries(["a", "b", "c", "d"].map((id) => {
      const value = activity(id, [claim(wagon)]);
      return [value.id, value];
    }));
    expect(() => validateSharedResourceCapacity({ activities: holders, ...catalog([wagon]) })).not.toThrow();
    const fifth = activity("e", [claim(wagon)]);
    expect(planSharedResourceAdmissions({
      activities: { ...holders, [fifth.id]: fifth },
      proposalActivityIds: [fifth.id],
      ...catalog([wagon]),
    }).admissions[0]?.kind).toBe("queue");
  });

  it("retains or releases paused claims by definition and treats retirement as zero capacity", () => {
    const retained = resource("retained", "reject", "retain");
    const released = resource("released", "reject", "release");
    const active = activity("paused", [claim(retained), claim(released)]);
    if (active.status !== "active") throw new Error("test setup must create an active Activity");
    const paused = pauseActivity(active, 0).activity;
    const usage = validateSharedResourceCapacity({
      activities: { [paused.id]: paused },
      ...catalog([retained, released]),
    });
    expect(usage.find((entry) => entry.poolId === retained.pool.id)?.claimed).toBe(1);
    expect(usage.find((entry) => entry.poolId === released.pool.id)?.claimed).toBe(0);

    const values = catalog([retained, released]);
    values.entities[retained.entity.id] = { ...retained.entity, lifecycle: "retired" };
    expect(() => validateSharedResourceCapacity({
      activities: { [paused.id]: paused },
      ...values,
    })).toThrow("exceeds capacity");

    values.entities[retained.entity.id] = retained.entity;
    values.pools[retained.pool.id] = { ...retained.pool, capacity: 0 };
    expect(() => validateSharedResourceCapacity({
      activities: { [paused.id]: paused },
      ...values,
    })).toThrow("exceeds capacity");
  });

  it("re-enters authored contention when a released paused claim resumes", () => {
    const bench = resource("released-bench", "queue", "release");
    const pausedSource = activity("paused-source", [claim(bench)]);
    const paused = pauseActivity(pausedSource, 0).activity;
    const holder = activity("holder", [claim(bench)]);
    expect(validateSharedResourceCapacity({
      activities: { [paused.id]: paused, [holder.id]: holder },
      ...catalog([bench]),
    })[0]?.claimed).toBe(1);

    const resumed = resumeActivity(paused, 0).activity;
    const activities = { [resumed.id]: resumed, [holder.id]: holder };
    const admissions = planSharedResourceAdmissions({
      activities,
      proposalActivityIds: [resumed.id],
      ...catalog([bench]),
    }).admissions;
    expect(admissions).toEqual([{
      kind: "queue",
      activityId: resumed.id,
      shortagePoolIds: [bench.pool.id],
    }]);
    expect(applySharedResourceAdmissions({ activities, admissions, atSeconds: 0 }).activities[resumed.id]?.status)
      .toBe("queued");
  });

  it("blocks an invalid ready reservation and promotes the next queue head", () => {
    const bench = resource("asserted-bench", "queue", "release");
    const assertion: CausalAssertion = {
      kind: "entity_lifecycle",
      entityId: "continuation-marker",
      expected: "active",
    };
    const firstQueued = queueScheduledActivity(activity("asserted-first", [claim(bench)], 0, [assertion]), 0).activity;
    const firstReady = reserveQueuedActivity(firstQueued, 30).activity;
    const secondQueued = queueScheduledActivity(activity("asserted-second", [claim(bench)]), 0).activity;
    const started = startReadyActivity({ activity: firstReady, atSeconds: 30, profiles: { [profile.id]: profile } });
    const invalidState = {
      truth: {
        entities: {
          "continuation-marker": {
            ...activeEntity("continuation-marker"),
            lifecycle: "retired",
          },
        },
      },
    } as unknown as SimulationState;
    expect(evaluateActivityContinuation(invalidState, started.activity)).toContainEqual(expect.objectContaining({
      passed: false,
    }));
    const blocked = blockScheduledActivity(started.activity, 30).activity;
    const promoted = promoteSharedResourceQueues({
      activities: { [blocked.id]: blocked, [secondQueued.id]: secondQueued },
      ...catalog([bench]),
      atSeconds: 60,
    });
    expect(promoted.activities[blocked.id]?.status).toBe("blocked");
    expect(promoted.activities[secondQueued.id]?.status).toBe("ready");
  });
});
