import path from "node:path";
import { build, type Plugin } from "esbuild";

let cached: Promise<string> | undefined;

const hostReactRuntime: Plugin = {
  name: "chatgame-host-react-runtime",
  setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({
      path: "react",
      namespace: "chatgame-host-runtime",
    }));
    builder.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
      path: "react/jsx-runtime",
      namespace: "chatgame-host-runtime",
    }));
    builder.onResolve({ filter: /^\/api\/runtime\// }, (args) => ({
      path: args.path,
      external: true,
    }));
    builder.onLoad({ filter: /^react$/, namespace: "chatgame-host-runtime" }, () => ({
      contents: [
        'export * from "/api/runtime/react.mjs";',
        'import React from "/api/runtime/react.mjs";',
        "export default React;",
      ].join("\n"),
      loader: "js",
    }));
    builder.onLoad({ filter: /^react\/jsx-runtime$/, namespace: "chatgame-host-runtime" }, () => ({
      contents: 'export * from "/api/runtime/jsx-runtime.mjs";',
      loader: "js",
    }));
  },
};

export function buildUiRuntime(): Promise<string> {
  cached ??= build({
    absWorkingDir: process.cwd(),
    entryPoints: [path.resolve(process.cwd(), "src/shared/ui-runtime.tsx")],
    bundle: true,
    format: "esm",
    jsx: "automatic",
    platform: "browser",
    plugins: [hostReactRuntime],
    logLevel: "silent",
    write: false,
  }).then((result) => {
    const output = result.outputFiles?.[0];
    if (!output) throw new Error("shared UI runtime build produced no output");
    return output.text;
  });
  return cached;
}
