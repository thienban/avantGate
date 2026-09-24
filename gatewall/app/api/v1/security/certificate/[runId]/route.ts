import { NextRequest, NextResponse } from "next/server";
import { telemetryStore } from "@/lib/storage/telemetry-store";
import { generateDpoComplianceCertificate } from "@/lib/security/dpo-certificate";

export const GET = async (
  _request: NextRequest,
  context: { params: Promise<{ runId: string }> }
): Promise<NextResponse> => {
  const { runId } = await context.params;
  const session = telemetryStore.getSessionById(runId);

  if (!session) {
    return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
  }

  const certificate = generateDpoComplianceCertificate(session);
  return NextResponse.json({ certificate });
};
