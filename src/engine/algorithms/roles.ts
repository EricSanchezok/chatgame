import type { RulePackageRegistry } from "../mechanics/rule-package";
import type { StructuredModelProvider } from "../models/model-provider";
import type { JsonObject } from "../runtime/json";
import type { SymbolRepairPolicy } from "../contracts/symbol-repair";
import type { ActionCompilationRetrievalRuntime } from "./eager-reference/candidate-retrieval/runtime";
import type { EagerReferenceComponents } from "./eager-reference/eager-reference";
import type {
  AlgorithmImplementation,
  AlgorithmRole,
  ResolvedAlgorithm,
} from "./composition";

export interface ConfiguredRoleAlgorithm<R extends AlgorithmRole = AlgorithmRole>
  extends AlgorithmImplementation<R> {
  readonly config: JsonObject;
  readonly children: Readonly<Record<string, ResolvedAlgorithm>>;
}

export interface AgentCognitionRoleAlgorithm extends ConfiguredRoleAlgorithm<"agent-cognition"> {
  create(provider: StructuredModelProvider, repairAttempts: number): EagerReferenceComponents["agentCognition"];
}

export interface ActionCompilationRoleAlgorithm extends ConfiguredRoleAlgorithm<"action-compilation"> {
  readonly compile: EagerReferenceComponents["actionCompilation"];
}

export interface CandidateSelectionRoleAlgorithm extends ConfiguredRoleAlgorithm<"candidate-selection"> {
  readonly runtime: ActionCompilationRetrievalRuntime | undefined;
}

export interface SymbolRepairRoleAlgorithm extends ConfiguredRoleAlgorithm<"symbol-repair"> {
  readonly policy: Readonly<SymbolRepairPolicy>;
}

export interface InteractionGroundingRoleAlgorithm extends ConfiguredRoleAlgorithm<"interaction-grounding"> {
  readonly ground: EagerReferenceComponents["interactionGrounding"];
}

export interface OnsetPerceptionRoleAlgorithm extends ConfiguredRoleAlgorithm<"onset-perception"> {
  create(
    provider: StructuredModelProvider,
    rulePackages: RulePackageRegistry,
    repairAttempts: number,
  ): EagerReferenceComponents["onsetPerception"];
}

export interface ReactionDecisionRoleAlgorithm extends ConfiguredRoleAlgorithm<"reaction-decision"> {
  create(provider: StructuredModelProvider, repairAttempts: number): EagerReferenceComponents["reactionDecision"];
}

export interface TruthResolutionRoleAlgorithm extends ConfiguredRoleAlgorithm<"truth-resolution"> {
  create(
    provider: StructuredModelProvider,
    rulePackages: RulePackageRegistry,
    repairAttempts: number,
  ): EagerReferenceComponents["truthResolution"];
}

export interface ObservationRenderingRoleAlgorithm extends ConfiguredRoleAlgorithm<"observation-rendering"> {
  create(provider: StructuredModelProvider): EagerReferenceComponents["observationRendering"];
}
