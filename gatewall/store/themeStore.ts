import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeState {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  initTheme: () => void;
}

const STORAGE_KEY = "avantgate_theme";

const getSystemTheme = (): "light" | "dark" => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const applyDocumentTheme = (resolved: "light" | "dark") => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "light",
  resolvedTheme: "light",

  initTheme: () => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    const initialTheme: ThemeMode = saved || "light";
    const resolved = initialTheme === "system" ? getSystemTheme() : initialTheme;

    applyDocumentTheme(resolved);
    set({ theme: initialTheme, resolvedTheme: resolved });
  },

  setTheme: (theme: ThemeMode) => {
    const resolved = theme === "system" ? getSystemTheme() : theme;
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, theme);
    }
    applyDocumentTheme(resolved);
    set({ theme, resolvedTheme: resolved });
  },

  toggleTheme: () => {
    const current = get().resolvedTheme;
    const next = current === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
}));
