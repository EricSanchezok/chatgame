import "@testing-library/jest-dom/vitest";

if (typeof globalThis.PointerEvent === "undefined" && typeof globalThis.MouseEvent !== "undefined") {
  Object.defineProperty(globalThis, "PointerEvent", { configurable: true, value: globalThis.MouseEvent });
}
