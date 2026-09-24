import { NextResponse } from "next/server";
import { telemetryStore } from "@/lib/storage/telemetry-store";

export const GET = async (): Promise<NextResponse> => {
  const sessions = telemetryStore.getSessions();
  return NextResponse.json({ sessions });
};
