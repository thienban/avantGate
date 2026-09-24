import React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ className, children, ...props }) => {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-950/70 p-5 shadow-sm backdrop-blur-md transition-all hover:border-zinc-700/80",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
