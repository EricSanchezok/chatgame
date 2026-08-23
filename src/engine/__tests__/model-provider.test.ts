import { describe, expect, it } from "vitest";
import { modelProviderOptionsFromEnv, VercelModelProvider } from "../model-provider";

describe("model provider profiles", () => {
  it.each(["DEEPSEEK_API_KEY", "DEEPSEEKAPIKEY", "deepseekapikey"])(
    "uses DeepSeek-compatible defaults for the %s key alias",
    (key) => {
      const options = modelProviderOptionsFromEnv({ [key]: "test-key" });

      expect(options).toMatchObject({
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "test-key",
        defaultModel: "deepseek-chat",
        profileModels: {
          "truth-engine": "deepseek-chat",
          "agent-default": "deepseek-chat",
        },
      });
    },
  );

  it("ignores empty higher-priority key aliases instead of masking a usable DeepSeek key", () => {
    expect(modelProviderOptionsFromEnv({
      DEEPSEEK_API_KEY: " ",
      deepseekapikey: "usable-key",
      CHATGAME_LLM_API_KEY: "",
      CHATGAME_LLM_BASE_URL: " ",
    })).toMatchObject({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "usable-key",
      defaultModel: "deepseek-chat",
    });
  });

  it("maps arbitrary Agent modelProfileId values to deployment-selected models", () => {
    const options = modelProviderOptionsFromEnv({
      CHATGAME_LLM_API_KEY: "test-key",
      CHATGAME_LLM_MODEL: "default-model",
      CHATGAME_LLM_PROFILE_MODELS: JSON.stringify({
        "agent-scholar": "reasoning-model",
        "agent-crowd": "fast-model",
      }),
    });
    const provider = new VercelModelProvider(options);

    expect(provider.describe("agent-scholar")).toMatchObject({ modelId: "reasoning-model" });
    expect(provider.describe("agent-crowd")).toMatchObject({ modelId: "fast-model" });
    expect(provider.describe("unmapped-profile")).toMatchObject({ modelId: "default-model" });
  });

  it("rejects malformed profile configuration instead of silently falling back", () => {
    expect(() => modelProviderOptionsFromEnv({ CHATGAME_LLM_PROFILE_MODELS: "[]" }))
      .toThrow("must be a JSON object");
    expect(() => modelProviderOptionsFromEnv({ CHATGAME_LLM_PROFILE_MODELS: '{"agent":""}' }))
      .toThrow("invalid profile mapping");
    expect(() => modelProviderOptionsFromEnv({ CHATGAME_LLM_TIMEOUT_MS: "forever" }))
      .toThrow("must be an integer");
  });
});
