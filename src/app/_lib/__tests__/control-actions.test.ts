import { describe, expect, it } from "vitest";
import { controlActions } from "../control-actions";

describe("control actions", () => {
  it("keeps in-game management inside the active session", () => {
    const actions = controlActions("session / 1");
    expect(actions).toHaveLength(3);
    expect(actions.map((action) => action.href)).toEqual([
      "/play/session%20%2F%201/manage/saves",
      "/play/session%20%2F%201/manage/settings",
      "/",
    ]);
    expect(actions.filter((action) => action.kind === "exit")).toHaveLength(1);
  });
});
