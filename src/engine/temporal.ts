import { evaluateCausalAssertion } from "./causality";
import { unresolvedActivityInteractionFootprint } from "./action-dependency";
import type { InteractionDependency } from "./execution";
import type {
  ActionOutcome,
  AgentActionProposal,
  AgentId,
  CausalAssertion,
  CausalAssertionResult,
  CausalRef,
  SimulationState,
} from "./model";

export interface ActivityResourceDefinition {
  id: string;
  name: string;
  capacity: number;
}

export interface ActivityResourceClaim {
  resourceId: string;
  amount: number;
}

interface TemporalProfileBase {
  id: string;
  name: string;
  interruptible: boolean;
  reactionFallback: "continue_if_valid" | "pause" | "cancel";
  resourceClaims: ActivityResourceClaim[];
}

export type TemporalProfileDefinition = TemporalProfileBase & (
  | {
      kind: "fixed";
      durationSeconds: number;
      checkpointSeconds: number;
      allowExplicitDuration: boolean;
    }
  | {
      kind: "rate";
      unit: string;
      unitAliases: string[];
      unitsPerPeriod: number;
      periodSeconds: number;
      checkpointUnits: number;
    }
  | {
      kind: "staged";
      stages: Array<{
        id: string;
        name: string;
        durationSeconds: number;
        checkpointSeconds: number;
      }>;
    }
  | { kind: "conditional"; checkEverySeconds: number }
  | { kind: "ongoing"; checkpointSeconds: number }
);

export interface TemporalCalibration {
  id: string;
  situation: string;
  profileId: string;
  explanation: string;
}

export type TemporalPlanBasis =
  | { kind: "profile"; profileId: string }
  | { kind: "explicit_duration"; profileId: string; seconds: number; sourceText: string }
  | {
      kind: "explicit_quantity";
      profileId: string;
      amount: number;
      unit: string;
      sourceText: string;
    }
  | {
      kind: "mechanic";
      profileId: string;
      invocationId: string;
      durationSeconds: number | null;
      checkpointSeconds: number;
      progress: { unit: string; target: number } | null;
    };

export interface TemporalPlanDraft {
  profileId: string;
  basis:
    | { kind: "profile" }
    | { kind: "explicit_duration"; seconds: number; sourceText: string }
    | { kind: "explicit_quantity"; amount: number; unit: string; sourceText: string };
  description: string;
  continuationAssertions: CausalAssertion[];
  causes: CausalRef[];
}

export interface TemporalStagePlan {
  id: string;
  name: string;
  startsAtSeconds: number;
  endsAtSeconds: number;
  checkpointSeconds: number;
}

export interface TemporalPlan {
  id: string;
  actionId: string;
  actorId: AgentId;
  profileId: string;
  mode: TemporalProfileDefinition["kind"];
  description: string;
  basis: TemporalPlanBasis;
  startsAtSeconds: number;
  completionAtSeconds: number | null;
  checkpointSeconds: number;
  progress: { unit: string; target: number } | null;
  stages: TemporalStagePlan[];
  continuationAssertions: CausalAssertion[];
  interruptible: boolean;
  resourceClaims: ActivityResourceClaim[];
  causes: CausalRef[];
}

export type ActivityStatus = "active" | "paused" | "completed" | "blocked" | "failed" | "cancelled";

export interface ActivityState {
  id: string;
  sourceActionId: string;
  sourceAction: AgentActionProposal;
  actorId: AgentId;
  participantAgentIds: AgentId[];
  plan: TemporalPlan;
  status: ActivityStatus;
  stageIndex: number;
  startedAtSeconds: number;
  updatedAtSeconds: number;
  nextBoundaryAtSeconds: number | null;
  completionAtSeconds: number | null;
  progress: { current: number; target: number; unit: string } | null;
  resourceClaims: ActivityResourceClaim[];
  interactionFootprint: InteractionDependency;
}

export type ActivityDispositionKind = "continue" | "pause" | "complete" | "block" | "fail" | "cancel";

export interface ActivityDisposition {
  activityId: string;
  actorId: AgentId;
  kind: ActivityDispositionKind;
  reason: string;
  effectiveAtSeconds: number;
  assertionResults: CausalAssertionResult[];
}

export interface WorldTimer {
  id: string;
  description: string;
  createdAtSeconds: number;
  dueAtSeconds: number;
  status: "scheduled" | "fired" | "cancelled";
  wakeAgentIds: AgentId[];
  causes: CausalRef[];
  assertions: CausalAssertion[];
}

export type TemporalBoundaryReason =
  | { kind: "activity_checkpoint"; activityId: string }
  | { kind: "activity_completion"; activityId: string }
  | { kind: "timer"; timerId: string }
  | { kind: "condition_expiry"; conditionId: string }
  | { kind: "activity_assertion"; activityId: string }
  | { kind: "safety_horizon" };

export interface TemporalBoundary {
  fromElapsedSeconds: number;
  toElapsedSeconds: number;
  deltaSeconds: number;
  reasons: TemporalBoundaryReason[];
  dueActivityIds: string[];
  dueTimerIds: string[];
  dueConditionIds: string[];
}

export interface ActivityTransition {
  activityId: string;
  actorId: AgentId;
  kind: "progressed" | "stage_changed" | "completed" | "paused" | "resumed" | "blocked" | "failed" | "cancelled";
  fromStatus: ActivityStatus;
  toStatus: ActivityStatus;
  fromElapsedSeconds: number;
  toElapsedSeconds: number;
  progress: ActivityState["progress"];
}

export interface DecisionPoint {
  agentId: AgentId;
  reason: "activity_completed" | "activity_blocked" | "activity_failed" | "activity_interrupted" | "timer" | "external_override";
  activityId: string | null;
  timerId: string | null;
}

export interface TemporalAdvanceResult {
  boundary: TemporalBoundary;
  activities: Record<string, ActivityState>;
  timers: Record<string, WorldTimer>;
  transitions: ActivityTransition[];
  decisionPoints: DecisionPoint[];
}

export interface TemporalStateSnapshot {
  activities: Record<string, ActivityState>;
  timers: Record<string, WorldTimer>;
}

const durationUnits: Array<{ pattern: RegExp; seconds: number }> = [
  { pattern: /(?:秒|seconds?|secs?)/iu, seconds: 1 },
  { pattern: /(?:分钟|分(?:钟)?|minutes?|mins?)/iu, seconds: 60 },
  { pattern: /(?:小时|时|hours?|hrs?)/iu, seconds: 3_600 },
  { pattern: /(?:天|日|days?)/iu, seconds: 86_400 },
  { pattern: /(?:周|星期|weeks?)/iu, seconds: 604_800 },
];

function chineseNumber(value: string): number | null {
  const direct: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5,
  };
  if (value in direct) return direct[value]!;
  if (/^十[一二三四五六七八九]$/u.test(value)) return 10 + direct[value[1]!]!;
  if (/^[二三四五六七八九]十$/u.test(value)) return direct[value[0]!]! * 10;
  if (/^[二三四五六七八九]十[一二三四五六七八九]$/u.test(value)) {
    return direct[value[0]!]! * 10 + direct[value[2]!]!;
  }
  return null;
}

function numericToken(value: string): number | null {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return chineseNumber(value);
}

export function explicitDurationSeconds(text: string): number | null {
  const normalized = text.normalize("NFC");
  const numberPattern = "([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十半]{1,3})";
  for (const unit of durationUnits) {
    const match = normalized.match(new RegExp(`${numberPattern}\\s*${unit.pattern.source}`, "iu"));
    if (!match) continue;
    const amount = numericToken(match[1]!);
    if (amount === null || amount <= 0) return null;
    const seconds = amount * unit.seconds;
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
  }
  return null;
}

function explicitQuantity(text: string, aliases: readonly string[]): { amount: number; matchedAlias: string } | null {
  const normalized = text.normalize("NFC");
  const numberPattern = "([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十半]{1,3})";
  for (const alias of [...aliases].sort((left, right) => right.length - left.length)) {
    const match = normalized.match(new RegExp(`${numberPattern}\\s*${escapeRegExp(alias)}`, "iu"));
    if (!match) continue;
    const amount = numericToken(match[1]!);
    if (amount !== null && amount > 0 && Number.isFinite(amount)) return { amount, matchedAlias: alias };
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
}

export function validateTemporalProfile(
  profile: TemporalProfileDefinition,
  resources: Readonly<Record<string, ActivityResourceDefinition>>,
): void {
  if (!profile.id.trim() || !profile.name.trim()) throw new Error("temporal profile identity is required");
  if (!profile.interruptible && profile.reactionFallback !== "continue_if_valid") {
    throw new Error(`non-interruptible temporal profile ${profile.id} cannot declare a reaction fallback`);
  }
  const seen = new Set<string>();
  for (const claim of profile.resourceClaims) {
    assertPositiveFinite(claim.amount, `temporal profile ${profile.id} resource amount`);
    const resource = resources[claim.resourceId];
    if (!resource || claim.amount > resource.capacity || seen.has(claim.resourceId)) {
      throw new Error(`temporal profile ${profile.id} has invalid resource claim ${claim.resourceId}`);
    }
    seen.add(claim.resourceId);
  }
  if (profile.kind === "fixed") {
    assertPositiveInteger(profile.durationSeconds, `temporal profile ${profile.id} duration`);
    assertPositiveInteger(profile.checkpointSeconds, `temporal profile ${profile.id} checkpoint`);
  } else if (profile.kind === "rate") {
    if (!profile.unit.trim() || profile.unitAliases.length === 0 || profile.unitAliases.some((alias) => !alias.trim())) {
      throw new Error(`temporal profile ${profile.id} requires unit aliases`);
    }
    assertPositiveFinite(profile.unitsPerPeriod, `temporal profile ${profile.id} rate`);
    assertPositiveInteger(profile.periodSeconds, `temporal profile ${profile.id} period`);
    assertPositiveFinite(profile.checkpointUnits, `temporal profile ${profile.id} checkpoint units`);
  } else if (profile.kind === "staged") {
    if (profile.stages.length === 0) throw new Error(`temporal profile ${profile.id} requires stages`);
    const stageIds = new Set<string>();
    for (const stage of profile.stages) {
      if (!stage.id.trim() || !stage.name.trim() || stageIds.has(stage.id)) {
        throw new Error(`temporal profile ${profile.id} has invalid stage ${stage.id}`);
      }
      stageIds.add(stage.id);
      assertPositiveInteger(stage.durationSeconds, `temporal profile ${profile.id} stage duration`);
      assertPositiveInteger(stage.checkpointSeconds, `temporal profile ${profile.id} stage checkpoint`);
    }
  } else if (profile.kind === "conditional") {
    assertPositiveInteger(profile.checkEverySeconds, `temporal profile ${profile.id} condition interval`);
  } else {
    assertPositiveInteger(profile.checkpointSeconds, `temporal profile ${profile.id} checkpoint`);
  }
}

function derivedSchedule(profile: TemporalProfileDefinition, startsAtSeconds: number, basis: TemporalPlanBasis) {
  if (profile.kind === "fixed") {
    const durationSeconds = basis.kind === "explicit_duration" ? basis.seconds : profile.durationSeconds;
    return {
      completionAtSeconds: startsAtSeconds + durationSeconds,
      checkpointSeconds: Math.min(profile.checkpointSeconds, durationSeconds),
      progress: null,
      stages: [] as TemporalStagePlan[],
    };
  }
  if (profile.kind === "rate") {
    if (basis.kind !== "explicit_quantity") throw new Error(`rate profile ${profile.id} requires explicit quantity`);
    const durationSeconds = Math.ceil(basis.amount * profile.periodSeconds / profile.unitsPerPeriod);
    const checkpointSeconds = Math.max(1, Math.ceil(profile.checkpointUnits * profile.periodSeconds / profile.unitsPerPeriod));
    return {
      completionAtSeconds: startsAtSeconds + durationSeconds,
      checkpointSeconds: Math.min(checkpointSeconds, durationSeconds),
      progress: { unit: profile.unit, target: basis.amount },
      stages: [] as TemporalStagePlan[],
    };
  }
  if (profile.kind === "staged") {
    let cursor = startsAtSeconds;
    const stages = profile.stages.map((stage): TemporalStagePlan => {
      const starts = cursor;
      cursor += stage.durationSeconds;
      return {
        id: stage.id,
        name: stage.name,
        startsAtSeconds: starts,
        endsAtSeconds: cursor,
        checkpointSeconds: stage.checkpointSeconds,
      };
    });
    return {
      completionAtSeconds: cursor,
      checkpointSeconds: stages[0]!.checkpointSeconds,
      progress: null,
      stages,
    };
  }
  if (profile.kind === "conditional") {
    return {
      completionAtSeconds: null,
      checkpointSeconds: profile.checkEverySeconds,
      progress: null,
      stages: [] as TemporalStagePlan[],
    };
  }
  return {
    completionAtSeconds: null,
    checkpointSeconds: profile.checkpointSeconds,
    progress: null,
    stages: [] as TemporalStagePlan[],
  };
}

export function materializeTemporalPlan(input: {
  id: string;
  actionId: string;
  actorId: AgentId;
  rawText: string;
  startsAtSeconds: number;
  draft: TemporalPlanDraft;
  profiles: Readonly<Record<string, TemporalProfileDefinition>>;
}): TemporalPlan {
  const profile = input.profiles[input.draft.profileId];
  if (!profile) throw new Error(`unknown temporal profile ${input.draft.profileId}`);
  let basis: TemporalPlanBasis;
  if (input.draft.basis.kind === "explicit_duration") {
    const duration = input.draft.basis;
    if (profile.kind !== "fixed" || !profile.allowExplicitDuration) {
      throw new Error(`temporal profile ${profile.id} does not allow explicit duration`);
    }
    const parsed = explicitDurationSeconds(input.rawText);
    if (parsed === null || parsed !== duration.seconds || !input.rawText.includes(duration.sourceText)) {
      throw new Error("explicit duration is not grounded in the action text");
    }
    basis = { profileId: profile.id, ...duration };
  } else if (input.draft.basis.kind === "explicit_quantity") {
    const quantity = input.draft.basis;
    if (profile.kind !== "rate") throw new Error(`temporal profile ${profile.id} is not rate-based`);
    const parsed = explicitQuantity(input.rawText, [profile.unit, ...profile.unitAliases]);
    if (!parsed || parsed.amount !== quantity.amount ||
      ![profile.unit, ...profile.unitAliases].some((unit) => unit.localeCompare(quantity.unit, undefined, { sensitivity: "accent" }) === 0) ||
      !input.rawText.includes(quantity.sourceText)) {
      throw new Error("explicit progress quantity is not grounded in the action text");
    }
    basis = { profileId: profile.id, ...quantity };
  } else {
    if (profile.kind === "rate") throw new Error(`rate profile ${profile.id} requires explicit quantity`);
    basis = { kind: "profile", profileId: profile.id };
  }
  const schedule = derivedSchedule(profile, input.startsAtSeconds, basis);
  return {
    id: input.id,
    actionId: input.actionId,
    actorId: input.actorId,
    profileId: profile.id,
    mode: profile.kind,
    description: input.draft.description,
    basis,
    startsAtSeconds: input.startsAtSeconds,
    ...schedule,
    continuationAssertions: structuredClone(input.draft.continuationAssertions),
    interruptible: profile.interruptible,
    resourceClaims: structuredClone(profile.resourceClaims),
    causes: structuredClone(input.draft.causes),
  };
}

export function materializeTrustedTemporalPlan(input: {
  id: string;
  actionId: string;
  actorId: AgentId;
  startsAtSeconds: number;
  profile: TemporalProfileDefinition;
  invocationId: string;
  durationSeconds: number | null;
  checkpointSeconds: number;
  progress: { unit: string; target: number } | null;
  description: string;
  causes: CausalRef[];
}): TemporalPlan {
  if (input.durationSeconds !== null) assertPositiveInteger(input.durationSeconds, "trusted temporal duration");
  assertPositiveInteger(input.checkpointSeconds, "trusted temporal checkpoint");
  if (input.progress) assertPositiveFinite(input.progress.target, "trusted temporal progress target");
  return {
    id: input.id,
    actionId: input.actionId,
    actorId: input.actorId,
    profileId: input.profile.id,
    mode: input.profile.kind,
    description: input.description,
    basis: {
      kind: "mechanic",
      profileId: input.profile.id,
      invocationId: input.invocationId,
      durationSeconds: input.durationSeconds,
      checkpointSeconds: input.checkpointSeconds,
      progress: structuredClone(input.progress),
    },
    startsAtSeconds: input.startsAtSeconds,
    completionAtSeconds: input.durationSeconds === null ? null : input.startsAtSeconds + input.durationSeconds,
    checkpointSeconds: input.checkpointSeconds,
    progress: structuredClone(input.progress),
    stages: [],
    continuationAssertions: [],
    interruptible: input.profile.interruptible,
    resourceClaims: structuredClone(input.profile.resourceClaims),
    causes: structuredClone(input.causes),
  };
}

export function createActivity(input: {
  id: string;
  plan: TemporalPlan;
  sourceAction: AgentActionProposal;
  participantAgentIds?: AgentId[];
  interactionFootprint?: InteractionDependency;
}): ActivityState {
  if (input.sourceAction.id !== input.plan.actionId || input.sourceAction.actorId !== input.plan.actorId) {
    throw new Error("activity source action does not match temporal plan");
  }
  const participants = [...new Set([input.plan.actorId, ...(input.participantAgentIds ?? [])])].sort();
  const nextBoundaryAtSeconds = input.plan.completionAtSeconds === null
    ? input.plan.startsAtSeconds + input.plan.checkpointSeconds
    : Math.min(input.plan.completionAtSeconds, input.plan.startsAtSeconds + input.plan.checkpointSeconds);
  const interactionFootprint = structuredClone(input.interactionFootprint ??
    unresolvedActivityInteractionFootprint(input.id, input.plan.actorId));
  if (interactionFootprint.kind !== "activity" || interactionFootprint.id !== input.id ||
    interactionFootprint.actorId !== input.plan.actorId) {
    throw new Error(`activity ${input.id} has a mismatched interaction footprint`);
  }
  return {
    id: input.id,
    sourceActionId: input.plan.actionId,
    sourceAction: structuredClone(input.sourceAction),
    actorId: input.plan.actorId,
    participantAgentIds: participants,
    plan: structuredClone(input.plan),
    status: "active",
    stageIndex: 0,
    startedAtSeconds: input.plan.startsAtSeconds,
    updatedAtSeconds: input.plan.startsAtSeconds,
    nextBoundaryAtSeconds,
    completionAtSeconds: input.plan.completionAtSeconds,
    progress: input.plan.progress ? { current: 0, target: input.plan.progress.target, unit: input.plan.progress.unit } : null,
    resourceClaims: structuredClone(input.plan.resourceClaims),
    interactionFootprint,
  };
}

export function evaluateActivityContinuation(
  state: Readonly<SimulationState>,
  activity: Readonly<ActivityState>,
): CausalAssertionResult[] {
  return activity.plan.continuationAssertions.map((assertion) => ({
    target: { kind: "activity", id: activity.id },
    assertion: structuredClone(assertion),
    ...evaluateCausalAssertion(state, assertion),
  }));
}

export function activityContinuationBoundary(
  activity: Readonly<ActivityState>,
  elapsedSeconds: number,
): number | null {
  let earliest: number | null = null;
  for (const assertion of activity.plan.continuationAssertions) {
    if (assertion.kind !== "elapsed_seconds_compare") continue;
    const at = assertion.operator === "lt"
      ? assertion.value
      : assertion.operator === "lte"
        ? assertion.value + 1
        : null;
    if (at !== null && Number.isSafeInteger(at) && at > elapsedSeconds) {
      earliest = earliest === null ? at : Math.min(earliest, at);
    }
  }
  return earliest;
}

export function validateTemporalPlan(
  plan: TemporalPlan,
  profiles: Readonly<Record<string, TemporalProfileDefinition>>,
  resources: Readonly<Record<string, ActivityResourceDefinition>>,
): void {
  const profile = profiles[plan.profileId];
  if (!plan.id.trim() || !plan.actionId.trim() || !plan.actorId.trim() || !plan.description.trim() || !profile ||
    profile.kind !== plan.mode || plan.basis.profileId !== plan.profileId) {
    throw new Error(`invalid temporal plan ${plan.id}`);
  }
  if (!Number.isSafeInteger(plan.startsAtSeconds) || plan.startsAtSeconds < 0 ||
    (plan.completionAtSeconds !== null &&
      (!Number.isSafeInteger(plan.completionAtSeconds) || plan.completionAtSeconds <= plan.startsAtSeconds))) {
    throw new Error(`temporal plan ${plan.id} has invalid clock`);
  }
  assertPositiveInteger(plan.checkpointSeconds, `temporal plan ${plan.id} checkpoint`);
  if (plan.progress) assertPositiveFinite(plan.progress.target, `temporal plan ${plan.id} progress target`);
  if (plan.causes.length === 0) throw new Error(`temporal plan ${plan.id} requires causes`);
  for (const assertion of plan.continuationAssertions) {
    if (assertion.kind === "check_result" || assertion.kind === "random_result") {
      throw new Error(`temporal plan ${plan.id} has a non-durable continuation assertion`);
    }
    if (assertion.kind === "elapsed_seconds_compare" &&
      (assertion.operator === "eq" || assertion.operator === "ne" ||
        !Number.isSafeInteger(assertion.value) || assertion.value < 0)) {
      throw new Error(`temporal plan ${plan.id} has a non-monotone time continuation assertion`);
    }
  }
  for (const claim of plan.resourceClaims) {
    const resource = resources[claim.resourceId];
    if (!resource || !Number.isFinite(claim.amount) || claim.amount <= 0 || claim.amount > resource.capacity) {
      throw new Error(`temporal plan ${plan.id} has invalid resource claim ${claim.resourceId}`);
    }
  }
  let priorEnd = plan.startsAtSeconds;
  for (const stage of plan.stages) {
    if (!stage.id.trim() || !stage.name.trim() || stage.startsAtSeconds !== priorEnd ||
      !Number.isSafeInteger(stage.endsAtSeconds) || stage.endsAtSeconds <= stage.startsAtSeconds) {
      throw new Error(`temporal plan ${plan.id} has invalid stage ${stage.id}`);
    }
    assertPositiveInteger(stage.checkpointSeconds, `temporal plan ${plan.id} stage checkpoint`);
    priorEnd = stage.endsAtSeconds;
  }
  if (plan.stages.length > 0 && plan.completionAtSeconds !== priorEnd) {
    throw new Error(`temporal plan ${plan.id} stages do not reach completion`);
  }
  if (plan.basis.kind === "mechanic") {
    const mechanicBasis = plan.basis;
    if (!mechanicBasis.invocationId.trim() ||
      !plan.causes.some((cause) => cause.kind === "mechanic" && cause.id === mechanicBasis.invocationId)) {
      throw new Error(`temporal plan ${plan.id} has an untrusted mechanic basis`);
    }
    if (mechanicBasis.durationSeconds !== null) {
      assertPositiveInteger(mechanicBasis.durationSeconds, `temporal plan ${plan.id} mechanic duration`);
    }
    assertPositiveInteger(mechanicBasis.checkpointSeconds, `temporal plan ${plan.id} mechanic checkpoint`);
    if (mechanicBasis.progress) {
      if (!mechanicBasis.progress.unit.trim()) throw new Error(`temporal plan ${plan.id} has an invalid mechanic unit`);
      assertPositiveFinite(mechanicBasis.progress.target, `temporal plan ${plan.id} mechanic progress target`);
    }
    const mechanicCompletion = mechanicBasis.durationSeconds === null
      ? null
      : plan.startsAtSeconds + mechanicBasis.durationSeconds;
    if (plan.completionAtSeconds !== mechanicCompletion || plan.checkpointSeconds !== mechanicBasis.checkpointSeconds ||
      !sameCanonicalValue(plan.progress, mechanicBasis.progress) || plan.stages.length > 0 ||
      plan.continuationAssertions.length > 0) {
      throw new Error(`temporal plan ${plan.id} does not match its mechanic result`);
    }
  } else {
    if (plan.basis.kind === "explicit_duration" &&
      (profile.kind !== "fixed" || !profile.allowExplicitDuration)) {
      throw new Error(`temporal plan ${plan.id} uses an unauthorized explicit duration`);
    }
    if (plan.basis.kind === "explicit_quantity" && profile.kind !== "rate") {
      throw new Error(`temporal plan ${plan.id} uses quantity with a non-rate profile`);
    }
    if (plan.basis.kind === "profile" && profile.kind === "rate") {
      throw new Error(`temporal plan ${plan.id} omits the required explicit quantity`);
    }
    const schedule = derivedSchedule(profile, plan.startsAtSeconds, plan.basis);
    if (plan.completionAtSeconds !== schedule.completionAtSeconds ||
      plan.checkpointSeconds !== schedule.checkpointSeconds ||
      !sameCanonicalValue(plan.progress, schedule.progress) ||
      !sameCanonicalValue(plan.stages, schedule.stages)) {
      throw new Error(`temporal plan ${plan.id} does not match its trusted profile schedule`);
    }
  }
  if (plan.interruptible !== profile.interruptible ||
    !sameCanonicalValue(plan.resourceClaims, profile.resourceClaims)) {
    throw new Error(`temporal plan ${plan.id} changes authored profile authority`);
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalValue(entry)]));
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

export function validateActivityState(
  activity: ActivityState,
  elapsedSeconds: number,
  profiles: Readonly<Record<string, TemporalProfileDefinition>>,
  resources: Readonly<Record<string, ActivityResourceDefinition>>,
): void {
  if (!activity.id.trim() || activity.sourceActionId !== activity.plan.actionId || activity.actorId !== activity.plan.actorId ||
    activity.sourceAction.id !== activity.sourceActionId || activity.sourceAction.actorId !== activity.actorId ||
    !activity.participantAgentIds.includes(activity.actorId) ||
    new Set(activity.participantAgentIds).size !== activity.participantAgentIds.length ||
    activity.interactionFootprint.kind !== "activity" || activity.interactionFootprint.id !== activity.id ||
    activity.interactionFootprint.actorId !== activity.actorId ||
    !activity.interactionFootprint.audienceAgentIds.includes(activity.actorId)) {
    throw new Error(`invalid activity ${activity.id}`);
  }
  for (const refs of [activity.interactionFootprint.reads, activity.interactionFootprint.writes]) {
    const keys = refs.map((ref) => `${ref.kind}:${ref.id}`);
    if (new Set(keys).size !== keys.length) throw new Error(`activity ${activity.id} has duplicate footprint refs`);
  }
  const hasGlobal = [
    ...activity.interactionFootprint.reads,
    ...activity.interactionFootprint.writes,
  ].some((ref) => ref.kind === "global");
  if (hasGlobal !== activity.interactionFootprint.globalFallback ||
    new Set(activity.interactionFootprint.audienceAgentIds).size !==
      activity.interactionFootprint.audienceAgentIds.length) {
    throw new Error(`activity ${activity.id} has inconsistent footprint evidence`);
  }
  validateTemporalPlan(activity.plan, profiles, resources);
  if (activity.plan.basis.kind !== "mechanic") {
    const basis: TemporalPlanDraft["basis"] = activity.plan.basis.kind === "profile"
      ? { kind: "profile" }
      : activity.plan.basis.kind === "explicit_duration"
        ? {
            kind: "explicit_duration",
            seconds: activity.plan.basis.seconds,
            sourceText: activity.plan.basis.sourceText,
          }
        : {
            kind: "explicit_quantity",
            amount: activity.plan.basis.amount,
            unit: activity.plan.basis.unit,
            sourceText: activity.plan.basis.sourceText,
          };
    const grounded = materializeTemporalPlan({
      id: activity.plan.id,
      actionId: activity.plan.actionId,
      actorId: activity.plan.actorId,
      rawText: activity.sourceAction.rawText,
      startsAtSeconds: activity.plan.startsAtSeconds,
      draft: {
        profileId: activity.plan.profileId,
        basis,
        description: activity.plan.description,
        continuationAssertions: activity.plan.continuationAssertions,
        causes: activity.plan.causes,
      },
      profiles,
    });
    if (!sameCanonicalValue(grounded, activity.plan)) {
      throw new Error(`activity ${activity.id} temporal authority is not grounded in its source action`);
    }
  }
  if (!Number.isSafeInteger(activity.startedAtSeconds) || activity.startedAtSeconds !== activity.plan.startsAtSeconds ||
    !Number.isSafeInteger(activity.updatedAtSeconds) || activity.updatedAtSeconds < activity.startedAtSeconds ||
    activity.updatedAtSeconds > elapsedSeconds ||
    (activity.plan.mode !== "conditional" && activity.completionAtSeconds !== activity.plan.completionAtSeconds) ||
    (activity.plan.mode === "conditional" && activity.status !== "completed" && activity.completionAtSeconds !== null)) {
    throw new Error(`activity ${activity.id} has invalid clock`);
  }
  const terminal = new Set<ActivityStatus>(["completed", "blocked", "failed", "cancelled"]);
  if (activity.status === "active" &&
    (activity.nextBoundaryAtSeconds === null || activity.nextBoundaryAtSeconds <= elapsedSeconds)) {
    throw new Error(`activity ${activity.id} has no future boundary`);
  }
  if ((activity.status === "paused" || terminal.has(activity.status)) && activity.nextBoundaryAtSeconds !== null) {
    throw new Error(`inactive activity ${activity.id} retains a boundary`);
  }
  if (activity.status === "completed" && activity.completionAtSeconds !== activity.updatedAtSeconds) {
    throw new Error(`completed activity ${activity.id} does not end at completion`);
  }
  if (activity.stageIndex < 0 || !Number.isSafeInteger(activity.stageIndex) ||
    activity.stageIndex >= Math.max(1, activity.plan.stages.length)) {
    throw new Error(`activity ${activity.id} has invalid stage index`);
  }
  if (activity.progress && (!Number.isFinite(activity.progress.current) || activity.progress.current < 0 ||
    activity.progress.current > activity.progress.target || activity.progress.target <= 0 || !activity.progress.unit.trim())) {
    throw new Error(`activity ${activity.id} has invalid progress`);
  }
}

export function validateWorldTimer(timer: WorldTimer, elapsedSeconds: number): void {
  if (!timer.id.trim() || !timer.description.trim() || !Number.isSafeInteger(timer.createdAtSeconds) ||
    timer.createdAtSeconds < 0 || !Number.isSafeInteger(timer.dueAtSeconds) || timer.dueAtSeconds <= timer.createdAtSeconds ||
    new Set(timer.wakeAgentIds).size !== timer.wakeAgentIds.length || timer.causes.length === 0 || timer.assertions.length === 0) {
    throw new Error(`invalid world timer ${timer.id}`);
  }
  if (timer.status === "scheduled" && timer.dueAtSeconds <= elapsedSeconds) {
    throw new Error(`scheduled timer ${timer.id} is overdue`);
  }
  if (timer.status === "fired" && timer.dueAtSeconds > elapsedSeconds) {
    throw new Error(`timer ${timer.id} fired before it was due`);
  }
}

export function validateActivityResources(
  activities: Readonly<Record<string, ActivityState>>,
  resources: Readonly<Record<string, ActivityResourceDefinition>>,
): void {
  const totals = new Map<string, number>();
  for (const activity of Object.values(activities)) {
    if (activity.status !== "active" && activity.status !== "paused") continue;
    for (const agentId of activity.participantAgentIds) {
      for (const claim of activity.resourceClaims) {
        const key = `${agentId}\u0000${claim.resourceId}`;
        totals.set(key, (totals.get(key) ?? 0) + claim.amount);
      }
    }
  }
  for (const [key, amount] of totals) {
    const [agentId, resourceId] = key.split("\u0000");
    const resource = resources[resourceId!];
    if (!resource || amount > resource.capacity) {
      throw new Error(`Agent ${agentId} exceeds activity resource ${resourceId}`);
    }
  }
}

export function selectTemporalBoundary(input: {
  elapsedSeconds: number;
  maxAutonomousSpanSeconds: number;
  activities: Readonly<Record<string, ActivityState>>;
  timers: Readonly<Record<string, WorldTimer>>;
  conditionExpiries: Readonly<Record<string, number>>;
}): TemporalBoundary {
  assertPositiveInteger(input.maxAutonomousSpanSeconds, "maximum autonomous span");
  const candidates: Array<{ at: number; reason: TemporalBoundaryReason }> = [{
    at: input.elapsedSeconds + input.maxAutonomousSpanSeconds,
    reason: { kind: "safety_horizon" },
  }];
  for (const activity of Object.values(input.activities)) {
    if (activity.status !== "active" || activity.nextBoundaryAtSeconds === null) continue;
    if (activity.nextBoundaryAtSeconds <= input.elapsedSeconds) throw new Error(`activity ${activity.id} has an overdue boundary`);
    candidates.push({
      at: activity.nextBoundaryAtSeconds,
      reason: activity.completionAtSeconds === activity.nextBoundaryAtSeconds
        ? { kind: "activity_completion", activityId: activity.id }
        : { kind: "activity_checkpoint", activityId: activity.id },
    });
    const assertionBoundary = activityContinuationBoundary(activity, input.elapsedSeconds);
    if (assertionBoundary !== null) {
      candidates.push({
        at: assertionBoundary,
        reason: { kind: "activity_assertion", activityId: activity.id },
      });
    }
  }
  for (const timer of Object.values(input.timers)) {
    if (timer.status !== "scheduled") continue;
    if (timer.dueAtSeconds <= input.elapsedSeconds) throw new Error(`timer ${timer.id} is overdue`);
    candidates.push({ at: timer.dueAtSeconds, reason: { kind: "timer", timerId: timer.id } });
  }
  for (const [conditionId, at] of Object.entries(input.conditionExpiries)) {
    if (!Number.isSafeInteger(at) || at <= input.elapsedSeconds) throw new Error(`condition ${conditionId} has invalid expiry`);
    candidates.push({ at, reason: { kind: "condition_expiry", conditionId } });
  }
  const toElapsedSeconds = Math.min(...candidates.map((candidate) => candidate.at));
  const reasons = candidates.filter((candidate) => candidate.at === toElapsedSeconds).map((candidate) => candidate.reason)
    .sort((left, right) => `${left.kind}:${"activityId" in left ? left.activityId : "timerId" in left ? left.timerId : "conditionId" in left ? left.conditionId : ""}`
      .localeCompare(`${right.kind}:${"activityId" in right ? right.activityId : "timerId" in right ? right.timerId : "conditionId" in right ? right.conditionId : ""}`));
  return {
    fromElapsedSeconds: input.elapsedSeconds,
    toElapsedSeconds,
    deltaSeconds: toElapsedSeconds - input.elapsedSeconds,
    reasons,
    dueActivityIds: reasons.flatMap((reason) => "activityId" in reason ? [reason.activityId] : []),
    dueTimerIds: reasons.flatMap((reason) => "timerId" in reason ? [reason.timerId] : []),
    dueConditionIds: reasons.flatMap((reason) => "conditionId" in reason ? [reason.conditionId] : []),
  };
}

function stageAt(activity: ActivityState, elapsedSeconds: number): number {
  if (activity.plan.stages.length === 0) return 0;
  const index = activity.plan.stages.findIndex((stage) => elapsedSeconds < stage.endsAtSeconds);
  return index === -1 ? activity.plan.stages.length - 1 : index;
}

function nextActivityBoundary(activity: ActivityState, at: number): number | null {
  if (activity.status !== "active") return null;
  if (activity.completionAtSeconds !== null && at >= activity.completionAtSeconds) return null;
  if (activity.plan.stages.length > 0) {
    const stage = activity.plan.stages[stageAt(activity, at)]!;
    return Math.min(stage.endsAtSeconds, at + stage.checkpointSeconds);
  }
  const checkpoint = at + activity.plan.checkpointSeconds;
  return activity.completionAtSeconds === null ? checkpoint : Math.min(checkpoint, activity.completionAtSeconds);
}

export function advanceTemporalState(input: {
  boundary: TemporalBoundary;
  activities: Readonly<Record<string, ActivityState>>;
  timers: Readonly<Record<string, WorldTimer>>;
}): TemporalAdvanceResult {
  const activities = structuredClone(input.activities) as Record<string, ActivityState>;
  const timers = structuredClone(input.timers) as Record<string, WorldTimer>;
  const transitions: ActivityTransition[] = [];
  const decisionPoints: DecisionPoint[] = [];
  const dueActivityIds = new Set(input.boundary.dueActivityIds);
  for (const activity of Object.values(activities).sort((left, right) => left.id.localeCompare(right.id))) {
    if (activity.status !== "active") continue;
    const fromStatus = activity.status;
    const previousStage = activity.stageIndex;
    activity.updatedAtSeconds = input.boundary.toElapsedSeconds;
    activity.stageIndex = stageAt(activity, input.boundary.toElapsedSeconds);
    if (activity.progress && activity.completionAtSeconds !== null) {
      const total = activity.completionAtSeconds - activity.startedAtSeconds;
      const elapsed = input.boundary.toElapsedSeconds - activity.startedAtSeconds;
      activity.progress.current = Math.min(activity.progress.target, activity.progress.target * elapsed / total);
    }
    const completed = activity.completionAtSeconds !== null && input.boundary.toElapsedSeconds >= activity.completionAtSeconds;
    if (completed) {
      activity.status = "completed";
      activity.nextBoundaryAtSeconds = null;
      if (activity.progress) activity.progress.current = activity.progress.target;
      decisionPoints.push({
        agentId: activity.actorId,
        reason: "activity_completed",
        activityId: activity.id,
        timerId: null,
      });
    } else if (dueActivityIds.has(activity.id)) {
      activity.nextBoundaryAtSeconds = nextActivityBoundary(activity, input.boundary.toElapsedSeconds);
    }
    transitions.push({
      activityId: activity.id,
      actorId: activity.actorId,
      kind: completed ? "completed" : previousStage !== activity.stageIndex ? "stage_changed" : "progressed",
      fromStatus,
      toStatus: activity.status,
      fromElapsedSeconds: input.boundary.fromElapsedSeconds,
      toElapsedSeconds: input.boundary.toElapsedSeconds,
      progress: structuredClone(activity.progress),
    });
  }
  for (const timerId of input.boundary.dueTimerIds) {
    const timer = timers[timerId];
    if (!timer || timer.status !== "scheduled" || timer.dueAtSeconds !== input.boundary.toElapsedSeconds) {
      throw new Error(`boundary references invalid timer ${timerId}`);
    }
    timer.status = "fired";
    for (const agentId of timer.wakeAgentIds) {
      decisionPoints.push({ agentId, reason: "timer", activityId: null, timerId });
    }
  }
  const uniquePoints = new Map(decisionPoints.map((point) => [
    `${point.agentId}:${point.reason}:${point.activityId ?? ""}:${point.timerId ?? ""}`,
    point,
  ]));
  return {
    boundary: structuredClone(input.boundary),
    activities,
    timers,
    transitions,
    decisionPoints: [...uniquePoints.values()].sort((left, right) => left.agentId.localeCompare(right.agentId)),
  };
}

export function reconcileTemporalOutcomes(
  input: Readonly<TemporalAdvanceResult>,
  outcomes: readonly ActionOutcome[],
): TemporalAdvanceResult {
  const next = structuredClone(input) as TemporalAdvanceResult;
  const byAction = new Map(outcomes.map((outcome) => [outcome.proposalId, outcome]));
  for (const activity of Object.values(next.activities)) {
    if (activity.status !== "active") continue;
    const outcome = byAction.get(activity.sourceActionId);
    if (!outcome) continue;
    const terminal = outcome.status === "failed"
      ? "failed" as const
      : outcome.status === "blocked"
        ? "blocked" as const
        : activity.plan.mode === "conditional" && outcome.status === "succeeded"
          ? "completed" as const
          : null;
    if (!terminal) continue;
    activity.status = terminal;
    activity.nextBoundaryAtSeconds = null;
    if (terminal === "completed") activity.completionAtSeconds = next.boundary.toElapsedSeconds;
    const existing = next.transitions.find((transition) => transition.activityId === activity.id);
    next.transitions = [
      ...next.transitions.filter((candidate) => candidate.activityId !== activity.id),
      {
        activityId: activity.id,
        actorId: activity.actorId,
        kind: terminal,
        fromStatus: existing?.fromStatus ?? "active",
        toStatus: terminal,
        fromElapsedSeconds: next.boundary.fromElapsedSeconds,
        toElapsedSeconds: next.boundary.toElapsedSeconds,
        progress: structuredClone(activity.progress),
      },
    ].sort((left, right) => left.activityId.localeCompare(right.activityId));
    const reason: DecisionPoint["reason"] = terminal === "completed"
      ? "activity_completed"
      : terminal === "blocked"
        ? "activity_blocked"
        : "activity_failed";
    next.decisionPoints.push({
      agentId: activity.actorId,
      reason,
      activityId: activity.id,
      timerId: null,
    });
  }
  next.decisionPoints = [...new Map(next.decisionPoints.map((point) => [
    `${point.agentId}:${point.reason}:${point.activityId ?? ""}:${point.timerId ?? ""}`,
    point,
  ])).values()].sort((left, right) => left.agentId.localeCompare(right.agentId));
  return next;
}

function replaceActivityTransition(
  temporal: TemporalAdvanceResult,
  activity: Readonly<ActivityState>,
  kind: ActivityTransition["kind"],
  fromStatus: ActivityStatus,
): void {
  temporal.transitions = [
    ...temporal.transitions.filter((transition) => transition.activityId !== activity.id),
    {
      activityId: activity.id,
      actorId: activity.actorId,
      kind,
      fromStatus,
      toStatus: activity.status,
      fromElapsedSeconds: temporal.boundary.fromElapsedSeconds,
      toElapsedSeconds: temporal.boundary.toElapsedSeconds,
      progress: structuredClone(activity.progress),
    },
  ].sort((left, right) => left.activityId.localeCompare(right.activityId));
}

export function settleActivityContexts(input: {
  state: Readonly<SimulationState>;
  temporal: Readonly<TemporalAdvanceResult>;
  activityIds: readonly string[];
  relevantObserverIds: ReadonlySet<AgentId>;
}): { temporal: TemporalAdvanceResult; dispositions: ActivityDisposition[] } {
  const temporal = structuredClone(input.temporal) as TemporalAdvanceResult;
  const relevantActivityIds = new Set(input.activityIds);
  const dispositions: ActivityDisposition[] = [];
  const dispositionByActivity = new Map<string, ActivityDisposition>();

  const addDisposition = (
    activity: Readonly<ActivityState>,
    kind: ActivityDispositionKind,
    reason: string,
    assertionResults: CausalAssertionResult[],
  ): void => {
    const disposition = {
      activityId: activity.id,
      actorId: activity.actorId,
      kind,
      reason,
      effectiveAtSeconds: temporal.boundary.toElapsedSeconds,
      assertionResults: structuredClone(assertionResults),
    } satisfies ActivityDisposition;
    dispositionByActivity.set(activity.id, disposition);
  };

  for (const activityId of [...relevantActivityIds].sort()) {
    let activity = temporal.activities[activityId];
    if (!activity) throw new Error(`activity context references unknown activity ${activityId}`);
    const evaluationState = structuredClone(input.state) as SimulationState;
    evaluationState.truth.activities = structuredClone(temporal.activities);
    const assertionResults = evaluateActivityContinuation(evaluationState, activity);
    if (activity.status === "active" && assertionResults.some((result) => !result.passed)) {
      const fromStatus = activity.status;
      activity = structuredClone(activity);
      activity.status = "blocked";
      activity.nextBoundaryAtSeconds = null;
      temporal.activities[activityId] = activity;
      replaceActivityTransition(temporal, activity, "blocked", fromStatus);
      temporal.decisionPoints.push({
        agentId: activity.actorId,
        reason: "activity_blocked",
        activityId,
        timerId: null,
      });
      addDisposition(activity, "block", "continuation_assertion_failed", assertionResults);
      continue;
    }
    if (activity.status === "active" && activity.plan.interruptible &&
      activity.participantAgentIds.some((agentId) => input.relevantObserverIds.has(agentId))) {
      const fromStatus = activity.status;
      activity = structuredClone(activity);
      activity.status = "paused";
      activity.nextBoundaryAtSeconds = null;
      temporal.activities[activityId] = activity;
      replaceActivityTransition(temporal, activity, "paused", fromStatus);
      temporal.decisionPoints.push({
        agentId: activity.actorId,
        reason: "activity_interrupted",
        activityId,
        timerId: null,
      });
      addDisposition(activity, "pause", "relevant_committed_observation", assertionResults);
      continue;
    }
    const kind: ActivityDispositionKind = activity.status === "completed"
      ? "complete"
      : activity.status === "blocked"
        ? "block"
        : activity.status === "failed"
          ? "fail"
          : activity.status === "cancelled"
            ? "cancel"
            : activity.status === "paused"
              ? "pause"
              : "continue";
    addDisposition(activity, kind, kind === "continue" ? "continuation_valid" : `activity_${activity.status}`, assertionResults);
  }

  const retainedDecisionPoints: DecisionPoint[] = [];
  for (const point of temporal.decisionPoints) {
    const occupying = Object.values(temporal.activities)
      .filter((activity) => activity.status === "active" && activity.participantAgentIds.includes(point.agentId));
    if (occupying.length === 0) {
      retainedDecisionPoints.push(point);
      continue;
    }
    const interruptible = occupying.filter((activity) => activity.plan.interruptible);
    if (interruptible.length !== occupying.length) continue;
    for (const current of interruptible) {
      const paused = structuredClone(current);
      paused.status = "paused";
      paused.nextBoundaryAtSeconds = null;
      temporal.activities[current.id] = paused;
      replaceActivityTransition(temporal, paused, "paused", current.status);
      if (!dispositionByActivity.has(current.id)) {
        addDisposition(paused, "pause", `decision_point:${point.reason}`, evaluateActivityContinuation(input.state, current));
      }
    }
    retainedDecisionPoints.push(point);
  }
  temporal.decisionPoints = [...new Map(retainedDecisionPoints.map((point) => [
    `${point.agentId}:${point.reason}:${point.activityId ?? ""}:${point.timerId ?? ""}`,
    point,
  ])).values()].sort((left, right) => left.agentId.localeCompare(right.agentId));
  dispositions.push(...[...dispositionByActivity.values()].sort((left, right) =>
    left.activityId.localeCompare(right.activityId)));
  return { temporal, dispositions };
}

export function pauseActivity(activity: Readonly<ActivityState>, atSeconds: number): {
  activity: ActivityState;
  transition: ActivityTransition;
} {
  if (activity.status !== "active" || !activity.plan.interruptible || atSeconds !== activity.updatedAtSeconds) {
    throw new Error(`activity ${activity.id} cannot pause at ${atSeconds}`);
  }
  const next = structuredClone(activity) as ActivityState;
  next.status = "paused";
  next.nextBoundaryAtSeconds = null;
  return {
    activity: next,
    transition: {
      activityId: next.id,
      actorId: next.actorId,
      kind: "paused",
      fromStatus: "active",
      toStatus: "paused",
      fromElapsedSeconds: atSeconds,
      toElapsedSeconds: atSeconds,
      progress: structuredClone(next.progress),
    },
  };
}

export function resumeActivity(activity: Readonly<ActivityState>, atSeconds: number): {
  activity: ActivityState;
  transition: ActivityTransition;
} {
  if (activity.status !== "paused" || atSeconds !== activity.updatedAtSeconds) {
    throw new Error(`activity ${activity.id} cannot resume at ${atSeconds}`);
  }
  const next = structuredClone(activity) as ActivityState;
  next.status = "active";
  next.nextBoundaryAtSeconds = nextActivityBoundary(next, atSeconds);
  return {
    activity: next,
    transition: {
      activityId: next.id,
      actorId: next.actorId,
      kind: "resumed",
      fromStatus: "paused",
      toStatus: "active",
      fromElapsedSeconds: atSeconds,
      toElapsedSeconds: atSeconds,
      progress: structuredClone(next.progress),
    },
  };
}

export function cancelActivity(activity: Readonly<ActivityState>, atSeconds: number): {
  activity: ActivityState;
  transition: ActivityTransition;
} {
  if ((activity.status !== "active" && activity.status !== "paused") || !activity.plan.interruptible ||
    atSeconds !== activity.updatedAtSeconds) {
    throw new Error(`activity ${activity.id} cannot be cancelled at ${atSeconds}`);
  }
  const next = structuredClone(activity) as ActivityState;
  const fromStatus = next.status;
  next.status = "cancelled";
  next.nextBoundaryAtSeconds = null;
  return {
    activity: next,
    transition: {
      activityId: next.id,
      actorId: next.actorId,
      kind: "cancelled",
      fromStatus,
      toStatus: "cancelled",
      fromElapsedSeconds: atSeconds,
      toElapsedSeconds: atSeconds,
      progress: structuredClone(next.progress),
    },
  };
}
