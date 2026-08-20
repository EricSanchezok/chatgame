"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  applyPreferenceAttributes,
  getPlayerSettingsSnapshot,
  getServerPlayerSettingsSnapshot,
  hydratePlayerSettings,
  subscribePlayerSettings,
} from "../lib/settings";

export function PlayerPreferenceSync() {
  const settings = useSyncExternalStore(
    subscribePlayerSettings,
    getPlayerSettingsSnapshot,
    getServerPlayerSettingsSnapshot,
  );

  useEffect(() => {
    hydratePlayerSettings();
  }, []);

  useEffect(() => {
    applyPreferenceAttributes(settings);
  }, [settings]);

  return null;
}
