import { NextRequest, NextResponse } from "next/server";
import { TelemetryIngestPayloadSchema } from "@/lib/types/telemetry";
import { telemetryStore } from "@/lib/storage/telemetry-store";
import { realtimeEmitter } from "@/lib/sse/event-emitter";
import { auth } from "@/lib/auth";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
};

export const OPTIONS = async (): Promise<NextResponse> => {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

const CLIENT_ONLY_EVENT_TYPES = new Set([
  "CLIENT_DATA_RENDERED",
  "CLIENT_SECURITY_ALERT",
  "USER_FEEDBACK",
]);

export const POST = async (request: NextRequest): Promise<NextResponse> => {
  try {
    const verifiedKey = await auth.api.verifyApiKey({ headers: request.headers });
    if (!verifiedKey || !verifiedKey.valid) {
      return NextResponse.json(
        {
          error: "Unauthorized: Invalid or missing API key (required prefix: 'gw_live_' or 'gw_pub_')",
          details: verifiedKey?.error,
        },
        { status: 401, headers: CORS_HEADERS }
      );
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch (err) {
      console.warn(
        "[gateWall Ingest] 400 Bad Request - Invalid JSON syntax:",
        err instanceof Error ? err.message : err
      );
      return NextResponse.json(
        {
          error: "Invalid JSON: The request body is not valid JSON.",
          hint: "Ensure keys and string values are enclosed in double quotes (\") and JSON.stringify() is used.",
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const parseResult = TelemetryIngestPayloadSchema.safeParse(json);

    if (!parseResult.success) {
      console.warn(
        "[gateWall Ingest] 400 Bad Request - Schema validation failed:",
        JSON.stringify(parseResult.error.flatten(), null, 2),
        "\nReceived Payload:",
        JSON.stringify(json, null, 2)
      );
      return NextResponse.json(
        {
          error: "Invalid telemetry payload",
          details: parseResult.error.flatten(),
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const payload = parseResult.data;
    const keyPrefix = verifiedKey.key?.prefix || "";
    const isPublicKey = keyPrefix.includes("pub_");

    if (isPublicKey) {
      const hasServerEvents = payload.events.some(
        (event) => !CLIENT_ONLY_EVENT_TYPES.has(event.type)
      );
      if (hasServerEvents) {
        return NextResponse.json(
          {
            error: "Forbidden: Public keys (gw_pub_...) are restricted to client events",
            allowedEvents: Array.from(CLIENT_ONLY_EVENT_TYPES),
          },
          { status: 403, headers: CORS_HEADERS }
        );
      }
    }

    const sessionRun = telemetryStore.ingest(payload);

    // Broadcast SSE update to listening frontend clients
    realtimeEmitter.broadcast("session_update", sessionRun);
    if (sessionRun.status === "WAITING_APPROVAL") {
      realtimeEmitter.broadcast("approval_required", {
        runId: sessionRun.runId,
        agentName: sessionRun.agentName,
      });
    }

    return NextResponse.json(
      {
        success: true,
        runId: sessionRun.runId,
        status: sessionRun.status,
        totalCostUsd: sessionRun.totalCostUsd,
        loopAlertTriggered: sessionRun.loopAlertTriggered,
        eventsCount: sessionRun.eventsCount,
        clientSecurityAlertsCount: sessionRun.clientSecurityAlertsCount,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error: unknown) {
    console.error("Ingest error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal Server Error", message },
      { status: 500, headers: CORS_HEADERS }
    );
  }
};
