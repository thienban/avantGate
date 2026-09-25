"use client";

import { useEffect } from "react";
import { useThemeStore, ThemeMode } from "@/store/themeStore";

export interface UseThemeReturn {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  isDark: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export const useTheme = (): UseThemeReturn => {
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const initTheme = useThemeStore((state) => state.initTheme);

  useEffect(() => {
    initTheme();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const currentTheme = useThemeStore.getState().theme;
      if (currentTheme === "system") {
        useThemeStore.getState().setTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [initTheme]);

  return {
    theme,
    resolvedTheme,
    isDark: resolvedTheme === "dark",
    setTheme,
    toggleTheme,
  };
};
