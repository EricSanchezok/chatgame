"use client";

// Injects the host React instance + JSX runtime onto window.__CG__ so script
// UI bundles (which resolve "react" to /api/runtime shims) share the same
// React copy as the app — two React instances break hooks.
import { useEffect } from "react";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";

export function ReactBridge() {
  useEffect(() => {
    if (!window.__CG__) {
      window.__CG__ = { react: React, jsxRuntime };
    }
  }, []);
  return null;
}
