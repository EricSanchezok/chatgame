import type { CreateInstanceInput } from "../../shared/world-api";

export type EditableStartStage = "choice" | "customize";

export type WorldStartStage =
  | { kind: "choice" }
  | { kind: "customize" }
  | {
      kind: "awakening";
      returnTo: EditableStartStage;
      submission: CreateInstanceInput;
    };

export function snapshotCreateInstanceInput(input: CreateInstanceInput): CreateInstanceInput {
  const common = {
    worldId: input.worldId,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.seed === undefined ? {} : { seed: input.seed }),
  };
  return input.start.kind === "observer"
    ? { ...common, start: { kind: "observer" } }
    : {
        ...common,
        start: {
          kind: "origin",
          originId: input.start.originId,
          displayName: input.start.displayName,
          appearance: input.start.appearance,
          motivation: input.start.motivation,
        },
      };
}

export function beginAwakening(
  input: CreateInstanceInput,
  returnTo: EditableStartStage,
): Extract<WorldStartStage, { kind: "awakening" }> {
  return { kind: "awakening", returnTo, submission: snapshotCreateInstanceInput(input) };
}

export function restoreAfterAwakeningFailure(
  stage: Extract<WorldStartStage, { kind: "awakening" }>,
): WorldStartStage {
  return { kind: stage.returnTo };
}

export function canDismissStart(stage: WorldStartStage): boolean {
  return stage.kind !== "awakening";
}
