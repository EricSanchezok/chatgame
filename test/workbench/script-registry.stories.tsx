"use client";

import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import {
  SCRIPT_UI_API_VERSION,
  type ScriptUiContext,
} from "@chatgame/ui";
import {
  clearSlots,
  loadScriptUi,
  useScriptRegistry,
} from "@/app/lib/script-registry";

type RegistryState = "idle" | "loading" | "active" | "error";

const descriptor = {
  apiVersion: SCRIPT_UI_API_VERSION,
  dependencyHash: "storybook-registry-contract",
  url: "/workbench/registry.js",
};

function RegistryMarker() {
  return <span>注册表插槽已提交</span>;
}

function RegistryStatePreview({ state }: { state: RegistryState }) {
  const registry = useScriptRegistry();

  useEffect(() => {
    clearSlots();
    if (state === "loading") {
      void loadScriptUi("workbench-loading", descriptor, {
        importer: () => new Promise(() => undefined),
      });
    } else if (state === "active") {
      void loadScriptUi("workbench-active", descriptor, {
        importer: async () => ({
          apiVersion: SCRIPT_UI_API_VERSION,
          default(context: ScriptUiContext) {
            context.register("scene", { component: RegistryMarker });
          },
        }),
      });
    } else if (state === "error") {
      void loadScriptUi("workbench-error", descriptor, {
        importer: async () => ({ apiVersion: SCRIPT_UI_API_VERSION + 1 }),
      });
    }
    return clearSlots;
  }, [state]);

  return (
    <main style={{ minHeight: "100dvh", padding: "var(--cg-space-4)", background: "var(--cg-background)" }}>
      <h1>插槽注册表</h1>
      <dl>
        <div><dt>状态</dt><dd data-testid="registry-status">{registry.status}</dd></div>
        <div><dt>代次</dt><dd>{registry.generation}</dd></div>
        <div><dt>剧本</dt><dd>{registry.scriptId ?? "未激活"}</dd></div>
        <div><dt>插槽数</dt><dd>{registry.slots.size}</dd></div>
      </dl>
      {registry.error ? <p role="alert">{registry.error}</p> : null}
    </main>
  );
}

const meta = {
  title: "Workbench/Script registry",
  component: RegistryStatePreview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RegistryStatePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

function story(state: RegistryState): Story {
  return {
    args: { state },
    play: async ({ canvasElement }) => {
      await expect(within(canvasElement).findByTestId("registry-status")).resolves.toHaveTextContent(state);
    },
  };
}

export const Idle = story("idle");
export const Loading = story("loading");
export const Active = story("active");
export const Error = story("error");
