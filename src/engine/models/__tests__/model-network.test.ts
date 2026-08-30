import { describe, expect, it } from "vitest";
import type { ProviderAccountConfig } from "../model-catalog";
import { createModelFetchResolver } from "../model-network";

const account = (network?: ProviderAccountConfig["network"]): ProviderAccountConfig => ({
  channel: "api",
  region: "cn",
  protocol: "openai-chat",
  dialect: "qwen",
  models_dev_provider_id: "private-test",
  base_url: "https://models.example.test/v1",
  api_key_env: "TEST_MODEL_API_KEY",
  max_concurrency: 1,
  ...(network ? { network } : {}),
});

describe("model network resolver", () => {
  it("leaves accounts without an opt-in transport on the default fetch", () => {
    const resolveFetch = createModelFetchResolver({});
    expect(resolveFetch("default", account())).toBeUndefined();
  });

  it("does not create a bound transport when its address is unset", () => {
    const resolveFetch = createModelFetchResolver({});
    expect(resolveFetch("qwen", account({ local_address_env: "QWEN_LOCAL_ADDRESS" })))
      .toBeUndefined();
  });

  it("rejects a configured address that is not an IP literal", () => {
    const resolveFetch = createModelFetchResolver({ QWEN_LOCAL_ADDRESS: "en0" });
    expect(() => resolveFetch(
      "qwen",
      account({ local_address_env: "QWEN_LOCAL_ADDRESS" }),
    )).toThrow("QWEN_LOCAL_ADDRESS to contain a local IP address");
  });

  it("reuses a bound transport for the same account and address", () => {
    const resolveFetch = createModelFetchResolver({ QWEN_LOCAL_ADDRESS: "127.0.0.1" });
    const configured = account({ local_address_env: "QWEN_LOCAL_ADDRESS" });
    const first = resolveFetch("qwen", configured);
    const second = resolveFetch("qwen", configured);
    expect(first).toBeTypeOf("function");
    expect(second).toBe(first);
  });
});
