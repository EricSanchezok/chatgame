import { createHash } from "node:crypto";

export type RuntimeIdKind =
  | "action"
  | "check"
  | "resolution-plan"
  | "resolution-receipt"
  | "random"
  | "mechanic"
  | "event"
  | "outcome"
  | "observation"
  | "claim"
  | "evidence"
  | "quantity"
  | "fact"
  | "model-audit";

export interface RuntimeIdInput {
  worldHash: string;
  revision: number;
  kind: RuntimeIdKind;
  stage: string;
  owner: string | readonly string[];
  round: number;
  ordinal: number;
}

const runtimeIdPattern = /^rt:([a-z][a-z0-9-]*):[a-f0-9]{64}$/;

/**
 * Creates a stable, engine-owned identity. Array encoding deliberately avoids
 * delimiter-based identities such as `definition:holder`.
 */
export function runtimeId(input: RuntimeIdInput): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(input.worldHash)) throw new Error("runtime id requires a world hash");
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 ||
    !Number.isSafeInteger(input.round) || input.round < 0 ||
    !Number.isSafeInteger(input.ordinal) || input.ordinal < 0 || !input.stage) {
    throw new Error("runtime id requires non-negative canonical coordinates");
  }
  const tuple = [
    input.worldHash,
    input.revision,
    input.kind,
    input.stage,
    input.owner,
    input.round,
    input.ordinal,
  ];
  const hash = createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex");
  return `rt:${input.kind}:${hash}`;
}

export function isRuntimeId(value: string, kind?: RuntimeIdKind): boolean {
  const match = runtimeIdPattern.exec(value);
  return Boolean(match && (!kind || match[1] === kind));
}

export function quantityId(worldHash: string, definitionId: string, holderId: string): string {
  return runtimeId({
    worldHash,
    revision: 0,
    kind: "quantity",
    stage: "canonical-quantity",
    owner: [definitionId, holderId],
    round: 0,
    ordinal: 0,
  });
}
