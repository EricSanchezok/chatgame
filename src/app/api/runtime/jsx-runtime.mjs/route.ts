// Shared JSX runtime shim: serves the host page's react/jsx-runtime instance
// to script UI bundles (same instance the app's own compiled JSX uses).
const SHIM = "export const { jsx, jsxs, Fragment } = window.__CG__.jsxRuntime;\n";

export function GET(): Response {
  return new Response(SHIM, {
    headers: { "Content-Type": "text/javascript" },
  });
}
