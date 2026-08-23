"use client";

import { useEffect } from "react";
import { readPreferences, subscribePreferences } from "../_lib/browser-state";

export function PreferenceBridge() {
  useEffect(() => {
    const apply = () => {
      const preferences = readPreferences();
      document.documentElement.dataset.cgScale = preferences.fontScale;
      document.documentElement.dataset.cgMotion = preferences.reduceMotion ? "reduced" : "full";
    };
    apply();
    return subscribePreferences(apply);
  }, []);

  return null;
}
