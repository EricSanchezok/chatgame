import { z } from "zod";
import { worldDeltaOperationSchema } from "./llm-schemas";
import type {
  AgentActionProposal,
  D20CheckRequest,
  D20CheckResult,
  DiscreteRandomRequest,
  DiscreteRandomResult,
  MechanicInvocation,
  MechanicResult,
  SimulationState,
  WorldDeltaOperation,
} from "./model";

export interface RulePackageReference {
  id: string;
  version: string;
  config: unknown;
  adjudication: string;
  rules: Array<{ id: string; description: string }>;
}

export interface RuleExecutionContext {
  state: SimulationState;
  actions: readonly AgentActionProposal[];
  checkRequests: readonly D20CheckRequest[];
  checkResults: readonly D20CheckResult[];
  randomRequests: readonly DiscreteRandomRequest[];
  randomResults: readonly DiscreteRandomResult[];
}

export interface RuleResultDraft {
  code: string;
  data: unknown;
  operations: WorldDeltaOperation[];
}

export interface MechanicRule {
  id: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  resolve: (
    context: RuleExecutionContext,
    config: unknown,
    input: unknown,
    invocation: MechanicInvocation,
  ) => RuleResultDraft;
}

export interface RulePackage {
  id: string;
  version: string;
  configSchema: z.ZodType<unknown>;
  adjudication: string;
  rules: readonly MechanicRule[];
  validateDirectOperations?: (
    context: RuleExecutionContext,
    config: unknown,
    operations: readonly WorldDeltaOperation[],
  ) => void;
}

interface SelectedPackage {
  definition: RulePackage;
  config: unknown;
}

export interface ResolvedMechanics {
  invocations: MechanicInvocation[];
  results: MechanicResult[];
  operations: WorldDeltaOperation[];
}

const ruleResultDraftSchema = z.strictObject({
  code: z.string().min(1),
  data: z.json(),
  operations: z.array(worldDeltaOperationSchema),
});

export class RulePackageRegistry {
  private readonly packages = new Map<string, RulePackage>();

  constructor(packages: readonly RulePackage[] = []) {
    for (const rulePackage of packages) this.register(rulePackage);
  }

  register(rulePackage: RulePackage): void {
    if (!rulePackage.id.trim() || !rulePackage.version.trim()) throw new Error("rule package identity is required");
    if (this.packages.has(rulePackage.id)) throw new Error(`duplicate rule package ${rulePackage.id}`);
    const ruleIds = rulePackage.rules.map((rule) => rule.id);
    if (ruleIds.some((id) => !id.trim()) || new Set(ruleIds).size !== ruleIds.length) {
      throw new Error(`rule package ${rulePackage.id} has invalid rule ids`);
    }
    this.packages.set(rulePackage.id, rulePackage);
  }

  private select(references: readonly RulePackageReference[]): Map<string, SelectedPackage> {
    const selected = new Map<string, SelectedPackage>();
    for (const reference of references) {
      const definition = this.packages.get(reference.id);
      if (!definition || definition.version !== reference.version) {
        throw new Error(`rule package runtime is unavailable: ${reference.id}@${reference.version}`);
      }
      selected.set(reference.id, { definition, config: definition.configSchema.parse(reference.config) });
    }
    return selected;
  }

  validate(references: readonly Omit<RulePackageReference, "adjudication" | "rules">[]): RulePackageReference[] {
    const seen = new Set<string>();
    return references.map((reference) => {
      if (seen.has(reference.id)) throw new Error(`duplicate rule package reference ${reference.id}`);
      seen.add(reference.id);
      const rulePackage = this.packages.get(reference.id);
      if (!rulePackage) throw new Error(`unknown rule package ${reference.id}`);
      if (rulePackage.version !== reference.version) {
        throw new Error(`rule package ${reference.id} requires version ${rulePackage.version}, received ${reference.version}`);
      }
      return {
        id: reference.id,
        version: reference.version,
        config: rulePackage.configSchema.parse(reference.config),
        adjudication: rulePackage.adjudication,
        rules: rulePackage.rules.map((rule) => ({ id: rule.id, description: rule.description })),
      };
    });
  }

  resolve(
    references: readonly RulePackageReference[],
    context: RuleExecutionContext,
    invocations: readonly MechanicInvocation[],
    directOperations: readonly WorldDeltaOperation[],
  ): ResolvedMechanics {
    const selected = this.select(references);
    if (directOperations.some((operation) => operation.causes.some((cause) => cause.kind === "mechanic"))) {
      throw new Error("direct operations cannot claim mechanic-derived provenance");
    }
    for (const entry of selected.values()) {
      entry.definition.validateDirectOperations?.(
        structuredClone(context),
        structuredClone(entry.config),
        structuredClone(directOperations),
      );
    }

    const invocationIds = new Set<string>();
    const normalizedInvocations: MechanicInvocation[] = [];
    const results: MechanicResult[] = [];
    const operations: WorldDeltaOperation[] = [];
    for (const invocation of invocations) {
      if (invocationIds.has(invocation.id)) throw new Error(`duplicate mechanic invocation ${invocation.id}`);
      invocationIds.add(invocation.id);
      const entry = selected.get(invocation.packageId);
      if (!entry) throw new Error(`mechanic ${invocation.id} cites inactive package ${invocation.packageId}`);
      const rule = entry.definition.rules.find((candidate) => candidate.id === invocation.ruleId);
      if (!rule) throw new Error(`mechanic ${invocation.id} cites unknown rule ${invocation.ruleId}`);
      const input = rule.inputSchema.parse(invocation.input);
      const normalizedInvocation = { ...structuredClone(invocation), input: structuredClone(input) };
      normalizedInvocations.push(normalizedInvocation);
      const draft = ruleResultDraftSchema.parse(rule.resolve(
        structuredClone(context),
        structuredClone(entry.config),
        structuredClone(input),
        structuredClone(normalizedInvocation),
      ));
      if (draft.operations.some((operation) => operation.causes.some((cause) => cause.kind === "mechanic"))) {
        throw new Error(`rule ${invocation.packageId}/${invocation.ruleId} cannot claim mechanic provenance`);
      }
      const mechanicCause = { kind: "mechanic" as const, id: invocation.id };
      const derived = draft.operations.map((operation) => ({
        ...structuredClone(operation),
        causes: [...structuredClone(operation.causes), mechanicCause],
      }));
      results.push({
        invocationId: invocation.id,
        packageId: invocation.packageId,
        ruleId: invocation.ruleId,
        code: draft.code,
        data: structuredClone(draft.data),
        operations: derived,
      });
      operations.push(...derived);
    }
    return { invocations: normalizedInvocations, results, operations };
  }
}

const coreResolutionConfigSchema = z.strictObject({});

export const coreResolutionRulePackage: RulePackage = {
  id: "core-resolution",
  version: "2.0.0",
  adjudication: "先提交 ResolutionPlan，再由引擎把命名难度、风险和效果档确定性映射为 d20 检定与规则效果。模型不得提交 raw DC、modifier、Meter delta、Condition 强度或 Rating 数值。",
  configSchema: coreResolutionConfigSchema,
  rules: [],
  validateDirectOperations: (_context, _config, operations) => {
    for (const operation of operations) {
      if (operation.kind === "adjust_meter" || operation.kind === "set_meter" || operation.kind === "set_rating") {
        throw new Error(`${operation.kind} must be derived by a trusted core-resolution rule`);
      }
    }
  },
};

export function createCoreRulePackageRegistry(): RulePackageRegistry {
  return new RulePackageRegistry([coreResolutionRulePackage]);
}
