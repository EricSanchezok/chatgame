// Shared React runtime shim: serves the host page's React instance to script
// UI bundles, so they never load a second React copy (two Reacts break hooks).
const SHIM = [
  "export default window.__CG__.react;",
  "export const { useState, useEffect, useMemo, useRef, useCallback, createElement, Fragment, useContext, useReducer, useLayoutEffect, forwardRef, memo, Children } = window.__CG__.react;",
  "export const react = window.__CG__.react;",
].join("\n");

export function GET(): Response {
  return new Response(SHIM, {
    headers: { "Content-Type": "text/javascript" },
  });
}
