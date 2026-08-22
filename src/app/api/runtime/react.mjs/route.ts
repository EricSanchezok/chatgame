// Shared React runtime shim: serves the host page's React instance to script
// UI bundles, so they never load a second React copy (two Reacts break hooks).
const SHIM = [
  "export default window.__CG__.react;",
  "export const { captureOwnerStack, Children, cloneElement, createContext, createElement, Fragment, forwardRef, isValidElement, memo, startTransition, useCallback, useContext, useEffect, useId, useInsertionEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, version } = window.__CG__.react;",
  "export const react = window.__CG__.react;",
].join("\n");

export function GET(): Response {
  return new Response(SHIM, {
    headers: { "Content-Type": "text/javascript" },
  });
}
