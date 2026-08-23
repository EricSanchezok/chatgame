import { z } from "zod";

export interface RulePackageReference {
  id: string;
  version: string;
  config: unknown;
}

export interface RulePackage<TConfig = unknown> {
  id: string;
  version: string;
  configSchema: z.ZodType<TConfig>;
}

export class RulePackageRegistry {
  private readonly packages = new Map<string, RulePackage>();

  constructor(packages: readonly RulePackage[] = []) {
    for (const rulePackage of packages) this.register(rulePackage);
  }

  register(rulePackage: RulePackage): void {
    if (!rulePackage.id.trim() || !rulePackage.version.trim()) throw new Error("rule package identity is required");
    if (this.packages.has(rulePackage.id)) throw new Error(`duplicate rule package ${rulePackage.id}`);
    this.packages.set(rulePackage.id, rulePackage);
  }

  validate(references: readonly RulePackageReference[]): RulePackageReference[] {
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
      };
    });
  }
}

export const coreD20RulePackage: RulePackage = {
  id: "core-d20",
  version: "1.0.0",
  configSchema: z.object({
    opposedChecks: z.boolean().default(true),
    damageUsesMeters: z.boolean().default(true),
  }).strict(),
};

export function createCoreRulePackageRegistry(): RulePackageRegistry {
  return new RulePackageRegistry([coreD20RulePackage]);
}
