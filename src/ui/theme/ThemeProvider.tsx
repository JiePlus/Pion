import type { ReactNode } from "react";
import type { ThemePreference } from "../../core/theme.ts";
import { useEffect } from "react";
import { applyTheme, watchSystemTheme } from "../../core/theme.ts";

export function ThemeProvider({
  value,
  children,
}: {
  value: ThemePreference;
  children: ReactNode;
}) {
  useEffect(() => {
    applyTheme(value);
    return watchSystemTheme(value, () => applyTheme(value));
  }, [value]);
  return <>{children}</>;
}
