import type {
  ModelTemporalPlanBasis,
  TemporalPlanDraft,
  TemporalProfileDefinition,
} from "./temporal";
import type { ActionTemporalEvidence } from "./temporal-evidence";

export interface TemporalProfileEligibility {
  eligible: boolean;
  evidenceRequirement: TemporalProfileDefinition["selection"]["evidenceRequirement"];
  evidenceKeys: string[];
  rejectionCode: "missing_explicit_duration" | "missing_explicit_quantity" | null;
}

export class ProfileCoverageError extends Error {
  constructor(readonly rejectionCodes: readonly string[]) {
    super(`no temporal profile is eligible: ${rejectionCodes.join(", ") || "no profiles configured"}`);
    this.name = "ProfileCoverageError";
  }
}

export function temporalProfileEligibility(
  profile: TemporalProfileDefinition,
  evidence: readonly ActionTemporalEvidence[],
): TemporalProfileEligibility {
  const evidenceKeys = evidence
    .filter((candidate) => candidate.compatibleProfileIds.includes(profile.id))
    .map((candidate) => candidate.key)
    .sort();
  if (profile.selection.evidenceRequirement === "explicit_profile_quantity") {
    return {
      eligible: evidenceKeys.length > 0,
      evidenceRequirement: profile.selection.evidenceRequirement,
      evidenceKeys,
      rejectionCode: evidenceKeys.length > 0 ? null : "missing_explicit_quantity",
    };
  }
  if (profile.selection.evidenceRequirement === "explicit_duration") {
    return {
      eligible: evidenceKeys.length > 0,
      evidenceRequirement: profile.selection.evidenceRequirement,
      evidenceKeys,
      rejectionCode: evidenceKeys.length > 0 ? null : "missing_explicit_duration",
    };
  }
  return {
    eligible: true,
    evidenceRequirement: profile.selection.evidenceRequirement,
    evidenceKeys: [],
    rejectionCode: null,
  };
}

export function eligibleTemporalProfiles(
  profiles: Readonly<Record<string, TemporalProfileDefinition>>,
  evidence: readonly ActionTemporalEvidence[],
): Array<{ profile: TemporalProfileDefinition; eligibility: TemporalProfileEligibility }> {
  const evaluated = Object.values(profiles)
    .map((profile) => ({ profile, eligibility: temporalProfileEligibility(profile, evidence) }))
    .sort((left, right) => left.profile.id.localeCompare(right.profile.id));
  if (!evaluated.some((entry) => entry.eligibility.eligible)) {
    throw new ProfileCoverageError(evaluated.flatMap((entry) =>
      entry.eligibility.rejectionCode ? [entry.eligibility.rejectionCode] : []));
  }
  return evaluated;
}

export function materializeModelTemporalBasis(
  profile: TemporalProfileDefinition,
  basis: ModelTemporalPlanBasis,
  evidence: readonly ActionTemporalEvidence[],
): TemporalPlanDraft["basis"] {
  const eligibility = temporalProfileEligibility(profile, evidence);
  if (!eligibility.eligible) {
    throw new Error(`temporal profile ${profile.id} is ineligible: ${eligibility.rejectionCode}`);
  }
  if (basis.kind === "profile") {
    if (profile.selection.evidenceRequirement !== "none") {
      throw new Error(`temporal profile ${profile.id} requires an action_text_evidence basis`);
    }
    return { kind: "profile" };
  }
  const selected = evidence.find((candidate) => candidate.key === basis.evidenceKey);
  if (!selected) throw new Error(`unknown temporal evidence ${basis.evidenceKey}`);
  if (!selected.compatibleProfileIds.includes(profile.id)) {
    throw new Error(`temporal evidence ${basis.evidenceKey} is incompatible with profile ${profile.id}`);
  }
  if (profile.selection.evidenceRequirement === "explicit_duration" && selected.kind !== "duration") {
    throw new Error(`temporal profile ${profile.id} requires duration evidence`);
  }
  if (profile.selection.evidenceRequirement === "explicit_profile_quantity" && selected.kind !== "quantity") {
    throw new Error(`temporal profile ${profile.id} requires profile quantity evidence`);
  }
  return selected.kind === "duration"
    ? { kind: "explicit_duration", seconds: selected.seconds, sourceText: selected.sourceText }
    : { kind: "explicit_quantity", amount: selected.amount, unit: selected.unit, sourceText: selected.sourceText };
}
