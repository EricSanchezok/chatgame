"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const IDLE_DELAY_MS = 500;

export function useScrollActivity() {
  const [active, setActive] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markActive = useCallback(() => {
    setActive(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setActive(false);
    }, IDLE_DELAY_MS);
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return {
    "data-scroll-active": active ? "true" : "false",
    onScroll: markActive,
    onPointerEnter: markActive,
    onFocusCapture: markActive,
  } as const;
}
