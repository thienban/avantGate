import { NextRequest, NextResponse } from "next/server";
import { telemetryStore } from "@/lib/storage/telemetry-store";

export const GET = async (
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  const { id } = await context.params;
  const session = telemetryStore.getSessionById(id);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({ session });
};
