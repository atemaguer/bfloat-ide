import type { AgentFrame } from "./agent-session.ts";

export interface AgentMessage {
  type: string;
  content: unknown;
  metadata?: Record<string, unknown>;
}

export function translateFrameToMessage(frame: AgentFrame): AgentMessage {
  const metadata: Record<string, unknown> = {};
  if (typeof frame.seq === "number") metadata.seq = frame.seq;
  if (frame.ts) metadata.timestamp = new Date(frame.ts).getTime();

  const payload = (frame.payload ?? {}) as Record<string, unknown>;
  let content: unknown;

  switch (frame.type) {
    case "text":
    case "reasoning":
      content = (payload.delta as string) ?? "";
      break;

    case "tool_call":
      content = {
        id: payload.callId ?? payload.id ?? "",
        name: payload.name ?? "",
        input: payload.input ?? {},
        status: payload.status ?? "running",
      };
      break;

    case "tool_result":
      content = {
        callId: payload.callId ?? "",
        name: payload.name ?? "",
        output: payload.output ?? "",
        isError: payload.isError ?? false,
      };
      break;

    case "queue_user_prompt":
      content = {
        prompt: payload.prompt ?? "",
        reason: payload.reason,
        source: payload.source,
      };
      break;

    case "error":
      content = {
        code: payload.code ?? "unknown",
        message: payload.message ?? "Unknown error",
        recoverable: payload.recoverable ?? false,
      };
      break;

    case "init":
      content = {
        sessionId: frame.sessionId,
        providerSessionId: (payload.realSessionId as string) ?? frame.sessionId,
        availableTools: payload.availableTools ?? [],
        model: payload.model ?? "",
      };
      break;

    case "done":
      content = {
        sessionId: frame.sessionId,
        result: payload.result,
        interrupted: payload.interrupted ?? false,
      };
      if (typeof payload.totalTokens === "number") metadata.tokens = payload.totalTokens;
      if (typeof payload.totalCostUsd === "number") metadata.cost = payload.totalCostUsd;
      break;

    default:
      content = payload;
      break;
  }

  return {
    type: frame.type,
    content,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}
