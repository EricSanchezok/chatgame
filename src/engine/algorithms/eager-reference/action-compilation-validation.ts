import type { ActionCompilationDraft } from "../../runtime/execution";
import type { SimulationState } from "../../contracts/model";
import {
  isProposalReference,
  type ExistingReferenceHandle,
  type ModelReference,
  type ModelReferenceKind,
  type ModelReferenceUse,
  type ModelRepairIssue,
  type ReferenceResolver,
} from "../../contracts/model-context";

const MAX_FIELD_ALTERNATIVES = 64;

interface ActionCompilationFieldContract {
  use: ModelReferenceUse;
  kinds: readonly ModelReferenceKind[];
}

const FOOTPRINT_KINDS = [
  "entity",
  "fact",
  "placement",
  "meter",
  "quantity",
  "rating",
  "condition",
  "activity",
  "shared_resource_pool",
  "world",
] as const satisfies readonly ModelReferenceKind[];

export const ACTION_COMPILATION_FIELD_USES = {
  temporalProfile: { use: "profile", kinds: ["temporal_profile"] },
  cause: { use: "cause", kinds: ["action", "check", "random", "event", "fact", "law", "mechanic"] },
  assertionEntity: { use: "assertion", kinds: ["entity"] },
  assertionPlacement: { use: "assertion", kinds: ["placement"] },
  assertionFact: { use: "assertion", kinds: ["fact"] },
  assertionCheck: { use: "assertion", kinds: ["check"] },
  assertionRandom: { use: "assertion", kinds: ["random"] },
  assertionMeter: { use: "assertion", kinds: ["meter"] },
  assertionQuantity: { use: "assertion", kinds: ["quantity"] },
  assertionRating: { use: "assertion", kinds: ["rating"] },
  assertionPool: { use: "assertion", kinds: ["shared_resource_pool"] },
  stateDependency: { use: "conflict", kinds: FOOTPRINT_KINDS },
  audience: { use: "audience", kinds: ["agent"] },
  resourcePool: { use: "conflict", kinds: ["shared_resource_pool"] },
} as const satisfies Record<string, ActionCompilationFieldContract>;

export class ActionCompilationValidationError extends Error {
  constructor(readonly issues: readonly ModelRepairIssue[]) {
    super(`action compilation contains ${issues.length} field-level reference issue(s)`);
    this.name = "ActionCompilationValidationError";
  }
}

export function normalizeActionCompilationDraftReferences(input: {
  draft: ActionCompilationDraft;
  resolver: ReferenceResolver;
  state: Readonly<SimulationState>;
}): { draft: ActionCompilationDraft; agentFootprintConversions: number } {
  const draft = structuredClone(input.draft);
  let agentFootprintConversions = 0;
  const normalizeFootprint = (handle: ExistingReferenceHandle): ExistingReferenceHandle => {
    try {
      const resolved = input.resolver.resolve(handle);
      if (resolved.kind !== "agent") return handle;
      const agent = input.state.agents[resolved.engineId];
      if (!agent) return handle;
      const entity = input.state.truth.entities[agent.entityId];
      if (!entity || entity.lifecycle !== "active") return handle;
      const bindings = Object.values(input.state.agents).filter((candidate) => candidate.entityId === agent.entityId);
      if (bindings.length !== 1) return handle;
      const entityHandle = input.resolver.handleFor("entity", agent.entityId);
      agentFootprintConversions += 1;
      return entityHandle;
    } catch {
      return handle;
    }
  };
  draft.interactionDependency.stateDependencies.requiredExistingRefs =
    draft.interactionDependency.stateDependencies.requiredExistingRefs.map(normalizeFootprint);
  draft.interactionDependency.stateDependencies.potentiallyAffectedExistingRefs =
    draft.interactionDependency.stateDependencies.potentiallyAffectedExistingRefs.map(normalizeFootprint);
  return { draft, agentFootprintConversions };
}

function allowedHandles(
  resolver: ReferenceResolver,
  contract: ActionCompilationFieldContract,
  eligibleProfileHandles?: ReadonlySet<string>,
): string[] {
  return resolver.candidatesFor(contract.use)
    .filter((candidate) => contract.kinds.includes(candidate.kind))
    .filter((candidate) => eligibleProfileHandles === undefined || eligibleProfileHandles.has(candidate.handle))
    .map((candidate) => candidate.handle)
    .sort()
    .slice(0, MAX_FIELD_ALTERNATIVES);
}

function validateReference(input: {
  value: ModelReference;
  path: Array<string | number>;
  contract: ActionCompilationFieldContract;
  resolver: ReferenceResolver;
  eligibleProfileHandles?: ReadonlySet<string>;
  ineligibleProfileReasons?: ReadonlyMap<string, string>;
}): ModelRepairIssue | null {
  const alternatives = allowedHandles(input.resolver, input.contract, input.eligibleProfileHandles);
  if (isProposalReference(input.value)) {
    return {
      code: "reference.proposal_disallowed",
      class: "reference",
      path: input.path,
      originalValue: structuredClone(input.value),
      allowedHandles: alternatives,
      reason: "Action Compilation may select only existing request-local handles; proposal references are not allowed in this field.",
    };
  }
  try {
    const resolved = input.resolver.resolve(input.value, input.contract.use);
    if (!input.contract.kinds.includes(resolved.kind)) {
      return {
        code: "reference.wrong_field_kind",
        class: "reference",
        path: input.path,
        originalValue: input.value,
        allowedHandles: alternatives,
        reason: `This field accepts only ${input.contract.kinds.join(" | ")} handles, not ${resolved.kind}.`,
      };
    }
    if (input.eligibleProfileHandles !== undefined && !input.eligibleProfileHandles.has(input.value)) {
      const rejectionCode = input.ineligibleProfileReasons?.get(input.value) ?? "ineligible";
      return {
        code: "temporal.profile_ineligible",
        class: "mechanic",
        path: input.path,
        originalValue: input.value,
        allowedHandles: alternatives,
        reason: `The selected temporal profile is not eligible for the exact evidence in this action text (${rejectionCode}).`,
      };
    }
    return null;
  } catch (error) {
    return {
      code: error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "reference.invalid",
      class: "reference",
      path: input.path,
      originalValue: input.value,
      allowedHandles: alternatives,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function assertionReferences(
  assertion: ActionCompilationDraft["temporalPlan"]["continuationAssertions"][number],
  index: number,
): Array<{
  value: ModelReference;
  path: Array<string | number>;
  contract: ActionCompilationFieldContract;
}> {
  const base = ["temporalPlan", "continuationAssertions", index] as Array<string | number>;
  switch (assertion.kind) {
    case "check_result": return [{ value: assertion.checkRef, path: [...base, "checkRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionCheck }];
    case "random_result": return [
      { value: assertion.requestRef, path: [...base, "requestRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionRandom },
      { value: assertion.stepRef, path: [...base, "stepRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionRandom },
    ];
    case "fact_matches":
    case "fact_absent": return [{ value: assertion.factRef, path: [...base, "factRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionFact }];
    case "entity_absent":
    case "entity_lifecycle": return [{ value: assertion.entityRef, path: [...base, "entityRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionEntity }];
    case "placement_equals": return [
      { value: assertion.entityRef, path: [...base, "entityRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionEntity },
      ...(assertion.placementRef === null ? [] : [{ value: assertion.placementRef, path: [...base, "placementRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionPlacement }]),
    ];
    case "shared_placement": return [
      { value: assertion.leftEntityRef, path: [...base, "leftEntityRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionEntity },
      { value: assertion.rightEntityRef, path: [...base, "rightEntityRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionEntity },
    ];
    case "meter_compare": return [{ value: assertion.meterRef, path: [...base, "meterRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionMeter }];
    case "quantity_compare": return [{ value: assertion.quantityRef, path: [...base, "quantityRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionQuantity }];
    case "rating_compare": return [{ value: assertion.ratingRef, path: [...base, "ratingRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionRating }];
    case "shared_resource_capacity_compare": return [{ value: assertion.poolRef, path: [...base, "poolRef"], contract: ACTION_COMPILATION_FIELD_USES.assertionPool }];
    case "elapsed_seconds_compare": return [];
  }
}

export function validateActionCompilationDraft(input: {
  draft: ActionCompilationDraft;
  resolver: ReferenceResolver;
  eligibleProfileHandles: ReadonlySet<string>;
  ineligibleProfileReasons: ReadonlyMap<string, string>;
  conditionalProfileHandles: ReadonlySet<string>;
}): ModelRepairIssue[] {
  const references: Array<{
    value: ModelReference;
    path: Array<string | number>;
    contract: ActionCompilationFieldContract;
    eligibleProfileHandles?: ReadonlySet<string>;
  }> = [{
    value: input.draft.temporalPlan.profileRef,
    path: ["temporalPlan", "profileRef"],
    contract: ACTION_COMPILATION_FIELD_USES.temporalProfile,
    eligibleProfileHandles: input.eligibleProfileHandles,
  }];
  input.draft.temporalPlan.causes.forEach((cause, index) => references.push({
    value: cause.ref,
    path: ["temporalPlan", "causes", index, "ref"],
    contract: ACTION_COMPILATION_FIELD_USES.cause,
  }));
  input.draft.temporalPlan.continuationAssertions.forEach((assertion, index) =>
    references.push(...assertionReferences(assertion, index)));
  input.draft.interactionDependency.stateDependencies.requiredExistingRefs.forEach((value, index) => references.push({
    value,
    path: ["interactionDependency", "stateDependencies", "requiredExistingRefs", index],
    contract: ACTION_COMPILATION_FIELD_USES.stateDependency,
  }));
  input.draft.interactionDependency.stateDependencies.potentiallyAffectedExistingRefs.forEach((value, index) => references.push({
    value,
    path: ["interactionDependency", "stateDependencies", "potentiallyAffectedExistingRefs", index],
    contract: ACTION_COMPILATION_FIELD_USES.stateDependency,
  }));
  input.draft.interactionDependency.audienceAgentHandles.forEach((value, index) => references.push({
    value,
    path: ["interactionDependency", "audienceAgentHandles", index],
    contract: ACTION_COMPILATION_FIELD_USES.audience,
  }));
  input.draft.interactionDependency.sharedResourceClaims.forEach((claim, index) => references.push({
    value: claim.resourcePoolHandle,
    path: ["interactionDependency", "sharedResourceClaims", index, "resourcePoolHandle"],
    contract: ACTION_COMPILATION_FIELD_USES.resourcePool,
  }));
  const issues = references.flatMap((reference) => {
    const issue = validateReference({
      ...reference,
      resolver: input.resolver,
      ineligibleProfileReasons: reference.eligibleProfileHandles === undefined
        ? undefined
        : input.ineligibleProfileReasons,
    });
    return issue === null ? [] : [issue];
  });
  if (typeof input.draft.temporalPlan.profileRef === "string" &&
    input.conditionalProfileHandles.has(input.draft.temporalPlan.profileRef) &&
    input.draft.temporalPlan.continuationAssertions.length === 0) {
    issues.push({
      code: "temporal.continuation_condition_missing",
      class: "mechanic",
      path: ["temporalPlan", "continuationAssertions"],
      originalValue: [],
      allowedHandles: [],
      reason: "The selected conditional temporal profile requires at least one continuation assertion grounded in exact catalog handles.",
    });
  }
  return issues;
}
