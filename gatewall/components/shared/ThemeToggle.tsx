"use client";

import React, { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

export interface ThemeToggleProps {
  className?: string;
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = "", compact = false }) => {
  const { resolvedTheme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Chargement du thème"
        className={`p-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-400 dark:text-zinc-500 opacity-60 ${className}`}
      >
        <span className="block h-4 w-4" />
      </button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Passer en mode Clair" : "Passer en mode Sombre"}
      aria-label={isDark ? "Activer le thème clair" : "Activer le thème sombre"}
      className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 shadow-xs hover:shadow-sm transition-all duration-150 cursor-pointer ${className}`}
    >
      <div className="relative h-4 w-4 flex items-center justify-center">
        {isDark ? (
          <Moon className="h-4 w-4 text-indigo-400 transition-transform duration-200 rotate-0 scale-100" />
        ) : (
          <Sun className="h-4 w-4 text-amber-500 transition-transform duration-200 rotate-0 scale-100" />
        )}
      </div>
      {!compact && (
        <span className="text-xs font-medium tracking-tight">
          {isDark ? "Mode Sombre" : "Mode Clair"}
        </span>
      )}
    </button>
  );
};
