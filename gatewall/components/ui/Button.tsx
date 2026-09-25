import React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "destructive" | "outline" | "ghost" | "success";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}) => {
  const variantStyles = {
    primary: "bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs",
    secondary: "bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100",
    destructive: "bg-rose-600 hover:bg-rose-700 text-white shadow-xs",
    success: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs",
    outline: "border border-slate-200 hover:bg-slate-100 text-slate-700 dark:border-zinc-700 dark:hover:bg-zinc-800/80 dark:text-zinc-200",
    ghost: "hover:bg-slate-100 text-slate-600 hover:text-slate-900 dark:hover:bg-zinc-800/50 dark:text-zinc-300 dark:hover:text-white",
  };

  const sizeStyles = {
    sm: "px-2.5 py-1 text-xs rounded-md",
    md: "px-4 py-2 text-sm rounded-lg",
    lg: "px-5 py-2.5 text-base rounded-xl font-medium",
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};
