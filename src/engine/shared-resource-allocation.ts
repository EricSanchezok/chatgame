import type { ActionOutcome, AgentActionProposal, WorldEntity } from "./model";
import { runtimeId } from "./runtime-id";
import {
  type SharedActivityResourceClaim,
  type SharedActivityResourceContention,
  type SharedActivityResourceDefinition,
  type SharedActivityResourcePool,
  validateSharedActivityResourceClaim,
} from "./shared-activity-resources";
import {
  type ActivityState,
  type ActivityTransition,
  blockScheduledActivity,
  type DecisionPoint,
  type QueuedActivityState,
  queueScheduledActivity,
  reserveQueuedActivity,
} from "./temporal";

export interface SharedResourceUsage {
  poolId: string;
  capacity: number;
  claimed: number;
  holderActivityIds: string[];
}

export type SharedResourceAdmission =
  | { kind: "granted"; activityId: string }
  | { kind: "reject"; activityId: string; shortagePoolIds: string[] }
  | { kind: "queue"; activityId: string; shortagePoolIds: string[] }
  | {
      kind: "adjudicate";
      activityId: string;
      shortagePoolIds: string[];
      competingActivityIds: string[];
    };

export interface SharedResourceAdmissionResult {
  admissions: SharedResourceAdmission[];
  usageBefore: SharedResourceUsage[];
}

export interface SharedResourceQueuePromotionResult {
  activities: Record<string, ActivityState>;
  transitions: ActivityTransition[];
  reservedActivityIds: string[];
  stoppedComponentHeads: string[];
}

export interface AppliedSharedResourceAdmissions {
  activities: Record<string, ActivityState>;
  transitions: ActivityTransition[];
  decisionPoints: DecisionPoint[];
  deferredActionIds: string[];
}

function contentionRank(contention: SharedActivityResourceContention): number {
  return contention === "adjudicate" ? 3 : contention === "queue" ? 2 : 1;
}

export function sharedResourceContentionForClaims(
  claims: readonly SharedActivityResourceClaim[],
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>,
): SharedActivityResourceContention {
  let selected: SharedActivityResourceContention = "reject";
  for (const claim of claims) {
    const definition = definitions[claim.definitionId];
    if (!definition) throw new Error(`unknown shared activity resource definition ${claim.definitionId}`);
    if (contentionRank(definition.contention) > contentionRank(selected)) selected = definition.contention;
  }
  return selected;
}

function effectiveCapacity(
  pool: Readonly<SharedActivityResourcePool>,
  entities: Readonly<Record<string, WorldEntity>>,
): number {
  return entities[pool.entityId]?.lifecycle === "active" ? pool.capacity : 0;
}

function claimsHeldByActivity(
  activity: Readonly<ActivityState>,
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>,
): SharedActivityResourceClaim[] {
  if (activity.status === "ready" || activity.status === "active") {
    return structuredClone(activity.sharedResourceClaims);
  }
  if (activity.status !== "paused") return [];
  return activity.sharedResourceClaims.filter((claim) => {
    const definition = definitions[claim.definitionId];
    if (!definition) throw new Error(`unknown shared activity resource definition ${claim.definitionId}`);
    return definition.pausedRetention === "retain";
  }).map((claim) => structuredClone(claim));
}

function validateActivityClaims(
  activity: Readonly<ActivityState>,
  pools: Readonly<Record<string, SharedActivityResourcePool>>,
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>,
): void {
  const seen = new Set<string>();
  for (const claim of activity.sharedResourceClaims) {
    if (seen.has(claim.poolId)) {
      throw new Error(`Activity ${activity.id} has duplicate shared resource claim ${claim.poolId}`);
    }
    seen.add(claim.poolId);
    validateSharedActivityResourceClaim(claim, pools, definitions);
  }
}

function usageFromActivities(input: {
  activities: Readonly<Record<string, ActivityState>>;
  pools: Readonly<Record<string, SharedActivityResourcePool>>;
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>;
  entities: Readonly<Record<string, WorldEntity>>;
  excludedActivityIds?: ReadonlySet<string>;
}): Map<string, SharedResourceUsage> {
  const usage = new Map<string, SharedResourceUsage>(Object.values(input.pools).map((pool) => [pool.id, {
    poolId: pool.id,
    capacity: effectiveCapacity(pool, input.entities),
    claimed: 0,
    holderActivityIds: [],
  } satisfies SharedResourceUsage]));
  for (const activity of Object.values(input.activities).sort((left, right) => left.id.localeCompare(right.id))) {
    validateActivityClaims(activity, input.pools, input.definitions);
    if (input.excludedActivityIds?.has(activity.id)) continue;
    for (const claim of claimsHeldByActivity(activity, input.definitions)) {
      const entry = usage.get(claim.poolId);
      if (!entry) throw new Error(`Activity ${activity.id} claims unknown shared resource pool ${claim.poolId}`);
      entry.claimed += claim.amount;
      entry.holderActivityIds.push(activity.id);
    }
  }
  return usage;
}

function shortagePoolIds(
  claims: readonly SharedActivityResourceClaim[],
  usage: ReadonlyMap<string, SharedResourceUsage>,
): string[] {
  return claims.flatMap((claim) => {
    const entry = usage.get(claim.poolId);
    if (!entry) throw new Error(`unknown shared activity resource pool ${claim.poolId}`);
    return entry.claimed + claim.amount > entry.capacity ? [claim.poolId] : [];
  }).sort();
}

function addClaims(
  activityId: string,
  claims: readonly SharedActivityResourceClaim[],
  usage: Map<string, SharedResourceUsage>,
): void {
  for (const claim of claims) {
    const entry = usage.get(claim.poolId);
    if (!entry) throw new Error(`unknown shared activity resource pool ${claim.poolId}`);
    entry.claimed += claim.amount;
    if (!entry.holderActivityIds.includes(activityId)) entry.holderActivityIds.push(activityId);
    entry.holderActivityIds.sort();
  }
}

function poolIds(activity: Readonly<ActivityState>): Set<string> {
  return new Set(activity.sharedResourceClaims.map((claim) => claim.poolId));
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function queuedComponents(queued: readonly QueuedActivityState[]): QueuedActivityState[][] {
  const remaining = new Map(queued.map((activity) => [activity.id, activity]));
  const components: QueuedActivityState[][] = [];
  while (remaining.size > 0) {
    const seedId = [...remaining.keys()].sort()[0]!;
    const seed = remaining.get(seedId)!;
    remaining.delete(seedId);
    const component = [seed];
    const componentPools = poolIds(seed);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [activityId, activity] of [...remaining.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        const activityPools = poolIds(activity);
        if (!intersects(componentPools, activityPools)) continue;
        component.push(activity);
        remaining.delete(activityId);
        for (const poolId of activityPools) componentPools.add(poolId);
        changed = true;
      }
    }
    component.sort((left, right) => left.enqueuedAtSeconds - right.enqueuedAtSeconds || left.id.localeCompare(right.id));
    components.push(component);
  }
  return components.sort((left, right) => left[0]!.id.localeCompare(right[0]!.id));
}

function hasOlderConnectedQueue(
  activity: Readonly<ActivityState>,
  activities: Readonly<Record<string, ActivityState>>,
): boolean {
  const targetPools = poolIds(activity);
  if (targetPools.size === 0) return false;
  const queued = Object.values(activities).filter((candidate): candidate is QueuedActivityState =>
    candidate.status === "queued");
  return queuedComponents(queued).some((component) => {
    const componentPools = new Set(component.flatMap((candidate) => [...poolIds(candidate)]));
    return intersects(targetPools, componentPools);
  });
}

export function planSharedResourceAdmissions(input: {
  activities: Readonly<Record<string, ActivityState>>;
  proposalActivityIds: readonly string[];
  pools: Readonly<Record<string, SharedActivityResourcePool>>;
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>;
  entities: Readonly<Record<string, WorldEntity>>;
}): SharedResourceAdmissionResult {
  const proposalIds = new Set(input.proposalActivityIds);
  if (proposalIds.size !== input.proposalActivityIds.length) throw new Error("duplicate shared resource proposal Activity");
  const usage = usageFromActivities({ ...input, excludedActivityIds: proposalIds });
  const usageBefore = [...usage.values()].map((entry) => structuredClone(entry)).sort((left, right) =>
    left.poolId.localeCompare(right.poolId));
  const admissions: SharedResourceAdmission[] = [];
  for (const activityId of [...proposalIds].sort()) {
    const activity = input.activities[activityId];
    if (!activity || activity.status !== "active") {
      throw new Error(`shared resource proposal ${activityId} is not an active Activity`);
    }
    validateActivityClaims(activity, input.pools, input.definitions);
    const shortage = shortagePoolIds(activity.sharedResourceClaims, usage);
    const contention = sharedResourceContentionForClaims(activity.sharedResourceClaims, input.definitions);
    const mustRespectQueue = contention === "queue" && hasOlderConnectedQueue(activity, input.activities);
    if (shortage.length === 0 && !mustRespectQueue) {
      admissions.push({ kind: "granted", activityId });
      addClaims(activityId, activity.sharedResourceClaims, usage);
      continue;
    }
    const shortagePoolIdsForDecision = shortage.length > 0
      ? shortage
      : activity.sharedResourceClaims.map((claim) => claim.poolId).sort();
    if (contention === "adjudicate") {
      const competingActivityIds = [...new Set(shortagePoolIdsForDecision.flatMap((poolId) =>
        usage.get(poolId)?.holderActivityIds ?? []))].sort();
      admissions.push({ kind: "adjudicate", activityId, shortagePoolIds: shortagePoolIdsForDecision, competingActivityIds });
    } else if (contention === "queue") {
      admissions.push({ kind: "queue", activityId, shortagePoolIds: shortagePoolIdsForDecision });
    } else {
      admissions.push({ kind: "reject", activityId, shortagePoolIds: shortagePoolIdsForDecision });
    }
  }
  return { admissions, usageBefore };
}

export function applySharedResourceAdmissions(input: {
  activities: Readonly<Record<string, ActivityState>>;
  admissions: readonly SharedResourceAdmission[];
  atSeconds: number;
}): AppliedSharedResourceAdmissions {
  const activities = structuredClone(input.activities) as Record<string, ActivityState>;
  const transitions: ActivityTransition[] = [];
  const decisionPoints: DecisionPoint[] = [];
  const deferredActionIds: string[] = [];
  for (const admission of [...input.admissions].sort((left, right) => left.activityId.localeCompare(right.activityId))) {
    const activity = activities[admission.activityId];
    if (!activity || activity.status !== "active") {
      throw new Error(`shared resource admission ${admission.activityId} has no active proposal Activity`);
    }
    if (admission.kind === "granted" || admission.kind === "adjudicate") continue;
    deferredActionIds.push(activity.sourceActionId);
    if (admission.kind === "queue") {
      const queued = queueScheduledActivity(activity, input.atSeconds);
      activities[activity.id] = queued.activity;
      transitions.push(queued.transition);
    } else {
      const blocked = blockScheduledActivity(activity, input.atSeconds);
      activities[activity.id] = blocked.activity;
      transitions.push(blocked.transition);
      decisionPoints.push(blocked.decisionPoint);
    }
  }
  return {
    activities,
    transitions,
    decisionPoints,
    deferredActionIds: deferredActionIds.sort(),
  };
}

export function materializeSharedResourceAdmissionOutcomes(input: {
  worldHash: string;
  revision: number;
  actions: readonly AgentActionProposal[];
  admissions: readonly SharedResourceAdmission[];
  activities: Readonly<Record<string, ActivityState>>;
  pools: Readonly<Record<string, SharedActivityResourcePool>>;
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>;
}): ActionOutcome[] {
  const actionById = new Map(input.actions.map((action) => [action.id, action]));
  return input.admissions.filter((admission) => admission.kind === "queue" || admission.kind === "reject")
    .sort((left, right) => left.activityId.localeCompare(right.activityId))
    .map((admission, ordinal) => {
      const activity = input.activities[admission.activityId];
      const action = activity ? actionById.get(activity.sourceActionId) : undefined;
      if (!activity || !action) throw new Error(`deferred resource Activity ${admission.activityId} has no action`);
      const names = admission.shortagePoolIds.map((poolId) => {
        const pool = input.pools[poolId];
        return pool ? input.definitions[pool.definitionId]?.name : null;
      }).filter((name): name is string => Boolean(name));
      return {
        id: runtimeId({
          worldHash: input.worldHash,
          revision: input.revision,
          kind: "outcome",
          stage: "shared-resource-admission",
          owner: action.id,
          round: 0,
          ordinal,
        }),
        proposalId: action.id,
        status: admission.kind === "queue" ? "continuing" : "blocked",
        summary: admission.kind === "queue"
          ? `等待共享资源：${names.join("、") || "资源池"}`
          : `共享资源容量不足：${names.join("、") || "资源池"}`,
        causeRefs: [{ kind: "action", id: action.id }],
        assertions: admission.shortagePoolIds.map((poolId) => ({
          kind: "shared_resource_capacity_compare" as const,
          poolId,
          operator: "eq" as const,
          value: input.pools[poolId]?.capacity ?? -1,
        })),
        knownAlternatives: [],
      } satisfies ActionOutcome;
    });
}

export function promoteSharedResourceQueues(input: {
  activities: Readonly<Record<string, ActivityState>>;
  pools: Readonly<Record<string, SharedActivityResourcePool>>;
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>;
  entities: Readonly<Record<string, WorldEntity>>;
  atSeconds: number;
}): SharedResourceQueuePromotionResult {
  const activities = structuredClone(input.activities) as Record<string, ActivityState>;
  const usage = usageFromActivities({ ...input, activities });
  const queued = Object.values(activities).filter((activity): activity is QueuedActivityState => activity.status === "queued");
  const transitions: ActivityTransition[] = [];
  const reservedActivityIds: string[] = [];
  const stoppedComponentHeads: string[] = [];
  for (const component of queuedComponents(queued)) {
    for (const activity of component) {
      const shortage = shortagePoolIds(activity.sharedResourceClaims, usage);
      if (shortage.length > 0) {
        stoppedComponentHeads.push(activity.id);
        break;
      }
      const reserved = reserveQueuedActivity(activity, input.atSeconds);
      activities[activity.id] = reserved.activity;
      transitions.push(reserved.transition);
      reservedActivityIds.push(activity.id);
      addClaims(activity.id, activity.sharedResourceClaims, usage);
    }
  }
  validateSharedResourceCapacity({ ...input, activities });
  return {
    activities,
    transitions: transitions.sort((left, right) => left.activityId.localeCompare(right.activityId)),
    reservedActivityIds: reservedActivityIds.sort(),
    stoppedComponentHeads: stoppedComponentHeads.sort(),
  };
}

export function sharedResourceQueuePositions(
  activities: Readonly<Record<string, ActivityState>>,
): ReadonlyMap<string, number> {
  const queued = Object.values(activities).filter((activity): activity is QueuedActivityState => activity.status === "queued");
  return new Map(queuedComponents(queued).flatMap((component) => component.map((activity, index) =>
    [activity.id, index + 1] as const)));
}

export function validateSharedResourceCapacity(input: {
  activities: Readonly<Record<string, ActivityState>>;
  pools: Readonly<Record<string, SharedActivityResourcePool>>;
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>;
  entities: Readonly<Record<string, WorldEntity>>;
}): SharedResourceUsage[] {
  const usage = usageFromActivities(input);
  for (const entry of usage.values()) {
    if (entry.claimed > entry.capacity) {
      throw new Error(`shared activity resource pool ${entry.poolId} exceeds capacity (${entry.claimed}/${entry.capacity})`);
    }
  }
  return [...usage.values()].map((entry) => structuredClone(entry)).sort((left, right) =>
    left.poolId.localeCompare(right.poolId));
}
