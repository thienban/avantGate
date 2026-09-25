import React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ className, children, ...props }) => {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200/90 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/70 p-5 shadow-xs dark:shadow-none backdrop-blur-md transition-all hover:border-slate-300 dark:hover:border-zinc-700/80 text-slate-900 dark:text-zinc-100",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

