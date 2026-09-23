export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

const themeKey = "pion.theme";

export function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(themeKey);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = resolveTheme(preference);
  document.documentElement.style.colorScheme = preference === "system" ? "light dark" : preference;
}

export function saveThemePreference(preference: ThemePreference) {
  localStorage.setItem(themeKey, preference);
  applyTheme(preference);
}

export function watchSystemTheme(preference: ThemePreference, listener: () => void) {
  if (preference !== "system") return () => {};
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
