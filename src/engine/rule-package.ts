import { z } from "zod";
import { worldDeltaOperationSchema } from "./llm-schemas";
import type {
  AgentActionProposal,
  CausalAssertion,
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

const meterImpactInputSchema = z.strictObject({
  checkId: z.string().min(1),
  expected: z.enum(["succeeded", "failed"]),
  recipient: z.enum(["actor", "target"]),
  meterId: z.string().min(1),
  amount: z.number().finite().refine((amount) => amount !== 0, "amount must be non-zero"),
});

type MeterImpactInput = z.infer<typeof meterImpactInputSchema>;
const coreD20ConfigSchema = z.strictObject({
  damageUsesMeters: z.boolean().default(true),
});

const applyMeterImpact: MechanicRule = {
  id: "apply-meter-impact",
  description: "在已提交的 resolution 检定结果满足断言时，对 actor 或 target 的 meter 施加确定性变化。",
  inputSchema: meterImpactInputSchema,
  resolve: (context, config, input, invocation) => {
    const coreConfig = config as z.infer<typeof coreD20ConfigSchema>;
    const meterInput = input as MeterImpactInput;
    if (!coreConfig.damageUsesMeters) throw new Error("core-d20 meter impacts are disabled by world config");
    const request = context.checkRequests.find((candidate) => candidate.id === meterInput.checkId);
    const result = context.checkResults.find((candidate) => candidate.requestId === meterInput.checkId);
    if (!request || request.phase !== "resolution" || !result) {
      throw new Error(`meter impact requires committed resolution check ${meterInput.checkId}`);
    }
    const observed = result.succeeded ? "succeeded" : "failed";
    if (observed !== meterInput.expected) throw new Error(`meter impact contradicts check ${meterInput.checkId}`);
    const entityId = meterInput.recipient === "actor" ? request.actorId : request.targetId;
    if (!entityId) throw new Error(`check ${meterInput.checkId} has no target recipient`);
    const meter = context.state.truth.meters[meterInput.meterId];
    if (!meter || meter.entityId !== entityId) {
      throw new Error(`meter ${meterInput.meterId} does not belong to the declared recipient`);
    }
    const assertion: CausalAssertion = {
      kind: "check_result",
      checkId: meterInput.checkId,
      expected: meterInput.expected,
    };
    return {
      code: "meter-impact-applied",
      data: { meterId: meterInput.meterId, amount: meterInput.amount, recipientEntityId: entityId },
      operations: [{
        kind: "adjust_meter",
        meterId: meterInput.meterId,
        amount: meterInput.amount,
        causes: structuredClone(invocation.causes),
        assertions: [assertion],
      }],
    };
  },
};

export const coreD20RulePackage: RulePackage = {
  id: "core-d20",
  version: "1.1.0",
  adjudication: "需要不确定性且结果有实质风险时使用 d20 检定。normal 掷 1d20；advantage/disadvantage 掷 2d20 并分别取高/低。总值为 kept + modifier，与 DC 比较；所有 modifier 必须来自结构化 rating 或 number fact。检定导致 meter 变化时必须调用 apply-meter-impact，禁止直接绕过规则。",
  configSchema: coreD20ConfigSchema,
  rules: [applyMeterImpact],
  validateDirectOperations: (_context, config, operations) => {
    if (!(config as z.infer<typeof coreD20ConfigSchema>).damageUsesMeters) return;
    for (const operation of operations) {
      if (operation.kind === "adjust_meter" && operation.causes.some((cause) => cause.kind === "check")) {
        throw new Error("check-driven meter changes must use core-d20/apply-meter-impact");
      }
    }
  },
};

export function createCoreRulePackageRegistry(): RulePackageRegistry {
  return new RulePackageRegistry([coreD20RulePackage]);
}
