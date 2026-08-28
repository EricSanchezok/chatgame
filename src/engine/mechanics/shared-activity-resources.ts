import { isRuntimeId, sharedActivityResourcePoolId } from "../runtime/runtime-id";

export type SharedActivityResourceContention = "reject" | "queue" | "adjudicate";
export type SharedActivityResourcePausedRetention = "retain" | "release";

export interface SharedActivityResourceDefinition {
  id: string;
  name: string;
  unit: string;
  defaultClaimAmount: number;
  allowExplicitAmount: boolean;
  contention: SharedActivityResourceContention;
  pausedRetention: SharedActivityResourcePausedRetention;
}

export interface SharedActivityResourcePool {
  id: string;
  definitionId: string;
  entityId: string;
  capacity: number;
}

export type SharedActivityResourceClaimBasis =
  | { kind: "default" }
  | { kind: "explicit_quantity"; amount: number; unit: string; sourceText: string }
  | { kind: "mechanic"; invocationId: string };

export interface SharedActivityResourceClaim {
  poolId: string;
  definitionId: string;
  entityId: string;
  amount: number;
  basis: SharedActivityResourceClaimBasis;
}

export interface SharedActivityResourceClaimDraft {
  poolId: string;
  basis:
    | { kind: "default" }
    | { kind: "explicit_quantity"; amount: number; unit: string; sourceText: string };
}

export function validateSharedActivityResourceDefinition(
  definition: Readonly<SharedActivityResourceDefinition>,
): void {
  if (!definition.id.trim() || !definition.name.trim() || !definition.unit.trim() ||
    !Number.isFinite(definition.defaultClaimAmount) || definition.defaultClaimAmount <= 0 ||
    !(["reject", "queue", "adjudicate"] as const).includes(definition.contention) ||
    !(["retain", "release"] as const).includes(definition.pausedRetention)) {
    throw new Error(`invalid shared activity resource definition ${definition.id}`);
  }
}

export function validateSharedActivityResourcePool(
  worldHash: string,
  pool: Readonly<SharedActivityResourcePool>,
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>,
  entityIds: ReadonlySet<string>,
): void {
  const expectedId = sharedActivityResourcePoolId(worldHash, pool.definitionId, pool.entityId);
  if (!isRuntimeId(pool.id, "shared-resource-pool") || pool.id !== expectedId ||
    !definitions[pool.definitionId] || !entityIds.has(pool.entityId) ||
    !Number.isFinite(pool.capacity) || pool.capacity < 0) {
    throw new Error(`invalid shared activity resource pool ${pool.id}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function explicitAmounts(text: string, unit: string): number[] {
  const pattern = `([0-9]+(?:\\.[0-9]+)?|[零一二两三四五六七八九十半]{1,3})\\s*${escapeRegExp(unit)}`;
  return [...text.normalize("NFC").matchAll(new RegExp(pattern, "giu"))].flatMap((match) => {
    const amount = Number(match[1]);
    const parsed = Number.isFinite(amount) ? amount : chineseNumber(match[1]!);
    return parsed !== null && Number.isFinite(parsed) && parsed > 0 ? [parsed] : [];
  });
}

export function materializeSharedActivityResourceClaims(input: {
  drafts: readonly SharedActivityResourceClaimDraft[];
  rawText: string;
  pools: Readonly<Record<string, SharedActivityResourcePool>>;
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>;
}): SharedActivityResourceClaim[] {
  const seen = new Set<string>();
  const claims = input.drafts.map((draft): SharedActivityResourceClaim => {
    if (seen.has(draft.poolId)) throw new Error(`duplicate shared activity resource claim ${draft.poolId}`);
    seen.add(draft.poolId);
    const pool = input.pools[draft.poolId];
    const definition = pool ? input.definitions[pool.definitionId] : undefined;
    if (!pool || !definition) throw new Error(`unknown shared activity resource pool ${draft.poolId}`);
    let amount: number;
    if (draft.basis.kind === "default") {
      amount = definition.defaultClaimAmount;
    } else {
      if (!definition.allowExplicitAmount || draft.basis.unit !== definition.unit ||
        !input.rawText.includes(draft.basis.sourceText) ||
        !explicitAmounts(input.rawText, definition.unit).includes(draft.basis.amount)) {
        throw new Error(`explicit shared resource amount is not grounded for ${draft.poolId}`);
      }
      amount = draft.basis.amount;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`invalid shared activity resource claim amount ${draft.poolId}`);
    }
    return {
      poolId: pool.id,
      definitionId: pool.definitionId,
      entityId: pool.entityId,
      amount,
      basis: structuredClone(draft.basis),
    };
  });
  return claims.sort((left, right) => left.poolId.localeCompare(right.poolId));
}

export function validateSharedActivityResourceClaimForAction(
  claim: Readonly<SharedActivityResourceClaim>,
  rawText: string,
  pools: Readonly<Record<string, SharedActivityResourcePool>>,
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>,
  trustedMechanicInvocationIds: ReadonlySet<string> = new Set(),
): void {
  validateSharedActivityResourceClaim(claim, pools, definitions);
  if (claim.basis.kind === "mechanic") {
    if (!trustedMechanicInvocationIds.has(claim.basis.invocationId)) {
      throw new Error(`shared activity resource claim ${claim.poolId} has untrusted mechanic provenance`);
    }
    return;
  }
  const derived = materializeSharedActivityResourceClaims({
    drafts: [{ poolId: claim.poolId, basis: structuredClone(claim.basis) }],
    rawText,
    pools,
    definitions,
  })[0]!;
  if (JSON.stringify(derived) !== JSON.stringify(claim)) {
    throw new Error(`shared activity resource claim ${claim.poolId} does not match its action evidence`);
  }
}

export function validateSharedActivityResourceClaim(
  claim: Readonly<SharedActivityResourceClaim>,
  pools: Readonly<Record<string, SharedActivityResourcePool>>,
  definitions: Readonly<Record<string, SharedActivityResourceDefinition>>,
): void {
  const pool = pools[claim.poolId];
  const definition = pool ? definitions[pool.definitionId] : undefined;
  if (!pool || !definition || claim.definitionId !== pool.definitionId || claim.entityId !== pool.entityId ||
    !Number.isFinite(claim.amount) || claim.amount <= 0) {
    throw new Error(`invalid shared activity resource claim ${claim.poolId}`);
  }
  if (claim.basis.kind === "default" && claim.amount !== definition.defaultClaimAmount) {
    throw new Error(`shared activity resource claim ${claim.poolId} changes its authored default`);
  }
  if (claim.basis.kind === "explicit_quantity" &&
    (!definition.allowExplicitAmount || claim.basis.amount !== claim.amount || claim.basis.unit !== definition.unit ||
      !claim.basis.sourceText.trim())) {
    throw new Error(`shared activity resource claim ${claim.poolId} has invalid explicit provenance`);
  }
  if (claim.basis.kind === "mechanic" && !claim.basis.invocationId.trim()) {
    throw new Error(`shared activity resource claim ${claim.poolId} has invalid mechanic provenance`);
  }
}
