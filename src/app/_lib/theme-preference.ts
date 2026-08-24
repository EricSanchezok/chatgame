export const themePreferences = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof themePreferences)[number];

export function normalizeThemePreference(value: string | undefined): ThemePreference {
  return themePreferences.find((preference) => preference === value) ?? "system";
}
