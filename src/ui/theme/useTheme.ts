import { useState } from "react";
import { readThemePreference, saveThemePreference } from "../../core/theme.ts";
import type { ThemePreference } from "../../core/theme.ts";

export function useTheme() {
  const [theme, setThemeState] = useState<ThemePreference>(readThemePreference);

  function setTheme(value: ThemePreference) {
    saveThemePreference(value);
    setThemeState(value);
  }

  return { theme, setTheme };
}
