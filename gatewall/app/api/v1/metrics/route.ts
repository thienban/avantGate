import { NextResponse } from "next/server";
import { telemetryStore } from "@/lib/storage/telemetry-store";

export const GET = async (): Promise<NextResponse> => {
  const finops = telemetryStore.getFinOpsSummary();
  const toolHealth = telemetryStore.getToolHealthMetrics();
  return NextResponse.json({ finops, toolHealth });
};
