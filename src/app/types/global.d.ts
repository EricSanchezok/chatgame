// Global declarations for the script UI runtime bridge (window.__CG__).
export {};

declare global {
  interface Window {
    /** Host React instance + JSX runtime shared with script UI bundles. */
    __CG__?: {
      react: typeof import("react");
      jsxRuntime: typeof import("react/jsx-runtime");
    };
  }
}
