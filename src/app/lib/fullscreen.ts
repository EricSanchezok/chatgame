// Fullscreen helper: wraps the browser Fullscreen API with silent
// degradation. Gameplay never depends on fullscreen — a policy rejection
// (iframe, permissions) leaves the game playable in windowed mode.

/** True when the document is currently in fullscreen mode. */
export function isFullscreen(): boolean {
  return typeof document !== "undefined" && document.fullscreenElement !== null;
}

/**
 * Requests fullscreen on the given element (defaults to documentElement).
 * Returns true when the request succeeded or was already fullscreen.
 * Never throws — failures are reported as false (silent degradation).
 */
export async function enterFullscreen(el?: HTMLElement): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (isFullscreen()) return true;
  try {
    await (el ?? document.documentElement).requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

/** Exits fullscreen. Returns true when the document is no longer fullscreen. */
export async function exitFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return true;
  if (!isFullscreen()) return true;
  try {
    await document.exitFullscreen();
    return true;
  } catch {
    return false;
  }
}

/** Toggles fullscreen for the given element. */
export function toggleFullscreen(el?: HTMLElement): Promise<boolean> {
  return isFullscreen() ? exitFullscreen() : enterFullscreen(el);
}

/** Esc-key handler that exits fullscreen when it is the only active target. */
export function handleFullscreenEscape(e: KeyboardEvent): void {
  if (e.key === "Escape" && isFullscreen()) {
    // Let the browser's native Esc-to-exit run; nothing else to do here.
    // Kept as a single choke point for tests / future policy hooks.
  }
}
