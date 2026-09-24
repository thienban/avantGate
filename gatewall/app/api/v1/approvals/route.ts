import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { telemetryStore } from "@/lib/storage/telemetry-store";
import { realtimeEmitter } from "@/lib/sse/event-emitter";

const DecisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  decidedBy: z.string().default("Admin"),
  reason: z.string().optional(),
});

export const GET = async (): Promise<NextResponse> => {
  const approvals = telemetryStore.getApprovals();
  return NextResponse.json({ approvals });
};

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  try {
    const json = await request.json();
    const parseResult = DecisionSchema.safeParse(json);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid approval payload", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { id, decision, decidedBy, reason } = parseResult.data;
    const updated = telemetryStore.decideApproval(id, decision, decidedBy, reason);

    if (!updated) {
      return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
    }

    realtimeEmitter.broadcast("approval_decided", updated);

    return NextResponse.json({ success: true, approval: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to decide approval", message },
      { status: 500 }
    );
  }
};
