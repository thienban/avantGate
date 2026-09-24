"use client";

import React from "react";
import { QueryProvider } from "./QueryProvider";
import { Sidebar } from "./Sidebar";
import { useRealtimeStream } from "@/hooks/useTelemetry";

interface RealtimeListenerProps {
  children: React.ReactNode;
}

const RealtimeListener: React.FC<RealtimeListenerProps> = ({ children }) => {
  useRealtimeStream();
  return <>{children}</>;
};

export interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  return (
    <QueryProvider>
      <RealtimeListener>
        <div className="flex h-screen w-full bg-zinc-950 text-zinc-100 overflow-hidden">
          <Sidebar />
          <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
            {children}
          </main>
        </div>
      </RealtimeListener>
    </QueryProvider>
  );
};
