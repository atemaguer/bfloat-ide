import { afterEach, describe, expect, it } from "bun:test";
import {
  closeSession,
  createSession,
  getBackgroundMessages,
  getSession,
  listSessions,
  registerProvider,
  sendMessage,
  type AgentProvider,
  type AgentProviderId,
  type ProviderStreamEvent,
  type SessionCreateOptions,
} from "./agent-session.ts";

class StubClaudeProvider implements AgentProvider {
  readonly id: AgentProviderId = "claude";
  readonly name = "Stub Claude";
  private callCount = 0;
  readonly seenResumeSessionIds: Array<string | undefined> = [];

  async isAuthenticated(): Promise<boolean> {
    return true;
  }

  async getAvailableModels(): Promise<Array<{ id: string; name: string; description?: string }>> {
    return [{ id: "stub-model", name: "Stub Model" }];
  }

  async *streamMessage(
    _message: string,
    options: SessionCreateOptions & { abortController: AbortController },
  ): AsyncIterable<ProviderStreamEvent> {
    this.callCount += 1;
    this.seenResumeSessionIds.push(options.resumeSessionId);

    const realSessionId = options.resumeSessionId || `real-session-${this.callCount}`;

    yield {
      kind: "init",
      realSessionId,
      model: "stub-model",
      availableTools: [],
    };

    yield {
      kind: "text",
      delta: `assistant turn ${this.callCount}`,
    };

    yield {
      kind: "done",
      interrupted: false,
    };
  }
}

class ScaffoldAttemptProvider implements AgentProvider {
  readonly id: AgentProviderId = "claude";
  readonly name = "Scaffold Attempt Provider";

  async isAuthenticated(): Promise<boolean> {
    return true;
  }

  async getAvailableModels(): Promise<Array<{ id: string; name: string; description?: string }>> {
    return [{ id: "stub-model", name: "Stub Model" }];
  }

  async *streamMessage(
    _message: string,
    options: SessionCreateOptions & { abortController: AbortController },
  ): AsyncIterable<ProviderStreamEvent> {
    yield {
      kind: "init",
      realSessionId: options.resumeSessionId || "real-session-scaffold",
      model: "stub-model",
      availableTools: [],
    };

    yield {
      kind: "tool_call",
      callId: "bash-1",
      name: "Bash",
      input: { command: "npx create-expo-app@latest timer-app --template" },
      status: "running",
    };

    // This should never be reached if scaffold guard works.
    yield {
      kind: "done",
      interrupted: false,
    };
  }
}

async function waitForSessionStatus(
  sessionId: string,
  targetStatus: "completed" | "error",
  timeoutMs = 1000,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const session = getSession(sessionId);
    if (session?.status === targetStatus) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const current = getSession(sessionId)?.status;
  throw new Error(`Timed out waiting for status "${targetStatus}". Current status: ${current ?? "missing"}`);
}

afterEach(async () => {
  const active = listSessions();
  await Promise.all(active.map((session) => closeSession(session.id)));
});

describe("agent-session resume persistence", () => {
  it("persists provider realSessionId for subsequent turns", async () => {
    const stubProvider = new StubClaudeProvider();
    registerProvider(stubProvider);

    const created = createSession("claude", {
      cwd: process.cwd(),
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const sessionId = created.sessionId;

    const firstTurn = sendMessage(sessionId, "first");
    expect(firstTurn.success).toBe(true);
    await waitForSessionStatus(sessionId, "completed");

    const sessionAfterFirstTurn = getSession(sessionId);
    const capturedRealSessionId = sessionAfterFirstTurn?.realSessionId;
    expect(capturedRealSessionId).toBe("real-session-1");

    const secondTurn = sendMessage(sessionId, "second");
    expect(secondTurn.success).toBe(true);
    await waitForSessionStatus(sessionId, "completed");

    expect(stubProvider.seenResumeSessionIds).toHaveLength(2);
    expect(stubProvider.seenResumeSessionIds[0]).toBeUndefined();
    expect(stubProvider.seenResumeSessionIds[1]).toBe(capturedRealSessionId);
  });

  it("blocks scaffold commands in existing workspaces", async () => {
    const provider = new ScaffoldAttemptProvider();
    registerProvider(provider);

    const created = createSession("claude", { cwd: process.cwd(), projectId: "test-project-scaffold" });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const sessionId = created.sessionId;
    const send = sendMessage(sessionId, "Create a timer");
    expect(send.success).toBe(true);
    await waitForSessionStatus(sessionId, "error");

    const session = getSession(sessionId);
    expect(session?.status).toBe("error");

    const replay = getBackgroundMessages(sessionId);
    expect(replay.success).toBe(true);
    const errorFrame = replay.messages.find((f) => f.type === "error");
    const payload = (errorFrame?.payload ?? {}) as { code?: string };
    expect(payload.code).toBe("scaffold_blocked_existing_workspace");
  });
});
