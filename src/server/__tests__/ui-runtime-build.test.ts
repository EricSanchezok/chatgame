import { describe, expect, it } from "vitest";
import { buildUiRuntime } from "../ui-runtime-build";

describe("browser UI runtime build", () => {
  it("bundles public primitives once and shares the host React runtime", async () => {
    const code = await buildUiRuntime();
    expect(code).toContain("/api/runtime/react.mjs");
    expect(code).toContain("/api/runtime/jsx-runtime.mjs");
    expect(code).toContain("SCRIPT_UI_API_VERSION");
    expect(code).not.toMatch(/from\s*["']@chatgame\/ui["']/);
    expect(code).not.toContain('require("react")');
    expect(code).not.toContain("Dynamic require of");
  });
});
