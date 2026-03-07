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

class DeprecatedPackageInstallProvider implements AgentProvider {
  readonly id: AgentProviderId = "claude";
  readonly name = "Deprecated Package Install Provider";

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
      realSessionId: options.resumeSessionId || "real-session-deprecated",
      model: "stub-model",
      availableTools: [],
    };

    yield {
      kind: "tool_call",
      callId: "bash-1",
      name: "Bash",
      input: { command: "npm install expo-av" },
      status: "running",
    };

    // This should never be reached if deprecated-package guard works.
    yield {
      kind: "done",
      interrupted: false,
    };
  }
}

class CaptureMcpServersProvider implements AgentProvider {
  readonly id: AgentProviderId = "claude";
  readonly name = "Capture MCP Servers Provider";
  readonly seenMcpServers: Array<Record<string, unknown> | undefined> = [];

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
    this.seenMcpServers.push(options.mcpServers as Record<string, unknown> | undefined);

    yield {
      kind: "init",
      realSessionId: options.resumeSessionId || "real-session-mcp-capture",
      model: "stub-model",
      availableTools: [],
    };

    yield {
      kind: "done",
      interrupted: false,
    };
  }
}

class CaptureSystemPromptProvider implements AgentProvider {
  readonly id: AgentProviderId = "claude";
  readonly name = "Capture System Prompt Provider";
  readonly seenSystemPrompts: Array<string | undefined> = [];

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
    this.seenSystemPrompts.push(options.systemPrompt);
    yield {
      kind: "init",
      realSessionId: options.resumeSessionId || "real-session-system-prompt",
      model: "stub-model",
      availableTools: [],
    };
    yield {
      kind: "done",
      interrupted: false,
    };
  }
}

class MutatingWithoutVerificationProvider implements AgentProvider {
  readonly id: AgentProviderId = "claude";
  readonly name = "Mutating Without Verification Provider";

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
      realSessionId: options.resumeSessionId || "real-session-no-verify",
      model: "stub-model",
      availableTools: [],
    };

    yield {
      kind: "tool_call",
      callId: "bash-1",
      name: "Bash",
      input: { command: "npm install left-pad" },
      status: "running",
    };

    yield {
      kind: "done",
      interrupted: false,
    };
  }
}

class MutatingWithSuccessfulVerificationProvider implements AgentProvider {
  readonly id: AgentProviderId = "claude";
  readonly name = "Mutating With Successful Verification Provider";

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
      realSessionId: options.resumeSessionId || "real-session-with-verify",
      model: "stub-model",
      availableTools: [],
    };

    yield {
      kind: "tool_call",
      callId: "write-1",
      name: "Write",
      input: { file_path: "app.ts", content: "export {};" },
      status: "running",
    };

    yield {
      kind: "tool_call",
      callId: "verify-1",
      name: "workbench.verify_app_state",
      input: { include_logs: true, include_screenshot: true },
      status: "running",
    };

    yield {
      kind: "tool_result",
      callId: "verify-1",
      name: "workbench.verify_app_state",
      output: JSON.stringify({
        checkedAt: "2026-03-06T10:00:00.000Z",
        status: "ok",
        evidence: {
          logs: { text: "ready", chars: 5 },
          screenshot: { success: true },
        },
        failures: [],
      }),
      isError: false,
    };

    yield {
      kind: "done",
      interrupted: false,
    };
  }
}

class MutatingInterruptedProvider implements AgentProvider {
  readonly id: AgentProviderId = "claude";
  readonly name = "Mutating Interrupted Provider";

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
      realSessionId: options.resumeSessionId || "real-session-interrupted",
      model: "stub-model",
      availableTools: [],
    };

    yield {
      kind: "tool_call",
      callId: "bash-1",
      name: "Bash",
      input: { command: "npm install left-pad" },
      status: "running",
    };

    // Intentionally end stream without "done"
    return;
  }
}

async function waitForSessionStatus(
  sessionId: string,
  targetStatus: "completed" | "error" | "interrupted",
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

  it("blocks deprecated package install commands", async () => {
    const provider = new DeprecatedPackageInstallProvider();
    registerProvider(provider);

    const created = createSession("claude", { cwd: process.cwd(), projectId: "test-project-deprecated" });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const sessionId = created.sessionId;
    const send = sendMessage(sessionId, "Install expo-av");
    expect(send.success).toBe(true);
    await waitForSessionStatus(sessionId, "completed");

    const session = getSession(sessionId);
    expect(session?.status).toBe("completed");

    const replay = getBackgroundMessages(sessionId);
    expect(replay.success).toBe(true);

    const toolResultFrame = replay.messages.find((f) => f.type === "tool_result");
    expect(toolResultFrame).toBeDefined();
    const toolPayload = (toolResultFrame?.payload ?? {}) as { isError?: boolean; output?: string };
    expect(toolPayload.isError).toBe(true);
    expect(toolPayload.output).toContain("Blocked deprecated package install (expo-av)");

    const doneFrame = replay.messages.find((f) => f.type === "done");
    expect(doneFrame).toBeDefined();
  });
});

describe("agent-session auto MCP server wiring", () => {
  it("auto-configures RevenueCat MCP from env", async () => {
    const provider = new CaptureMcpServersProvider();
    registerProvider(provider);

    const created = createSession("claude", {
      cwd: process.cwd(),
      env: {
        REVENUECAT_API_KEY: "rc_test_123",
      },
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const send = sendMessage(created.sessionId, "test");
    expect(send.success).toBe(true);
    await waitForSessionStatus(created.sessionId, "completed");

    expect(provider.seenMcpServers).toHaveLength(1);
    const mcpServers = provider.seenMcpServers[0] || {};
    const revenuecat = mcpServers.revenuecat as { type?: string; url?: string; headers?: { Authorization?: string } };
    expect(revenuecat?.type).toBe("http");
    expect(revenuecat?.url).toBe("https://mcp.revenuecat.ai/mcp");
    expect(revenuecat?.headers?.Authorization).toBe("Bearer rc_test_123");
  });

  it("auto-configures Stripe MCP from STRIPE_SECRET_KEY", async () => {
    const provider = new CaptureMcpServersProvider();
    registerProvider(provider);

    const created = createSession("claude", {
      cwd: process.cwd(),
      env: {
        STRIPE_SECRET_KEY: "sk_test_123",
      },
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const send = sendMessage(created.sessionId, "test");
    expect(send.success).toBe(true);
    await waitForSessionStatus(created.sessionId, "completed");

    expect(provider.seenMcpServers).toHaveLength(1);
    const mcpServers = provider.seenMcpServers[0] || {};
    const stripe = mcpServers.stripe as { type?: string; url?: string; headers?: { Authorization?: string } };
    expect(stripe?.type).toBe("http");
    expect(stripe?.url).toBe("https://mcp.stripe.com");
    expect(stripe?.headers?.Authorization).toBe("Bearer sk_test_123");
  });

  it("does not auto-configure Stripe MCP when STRIPE_SECRET_KEY is blank", async () => {
    const provider = new CaptureMcpServersProvider();
    registerProvider(provider);

    const created = createSession("claude", {
      cwd: process.cwd(),
      env: {
        STRIPE_SECRET_KEY: "   ",
      },
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const send = sendMessage(created.sessionId, "test");
    expect(send.success).toBe(true);
    await waitForSessionStatus(created.sessionId, "completed");

    expect(provider.seenMcpServers).toHaveLength(1);
    const mcpServers = provider.seenMcpServers[0] || {};
    expect(mcpServers.stripe).toBeUndefined();
  });

  it("lets explicit stripe mcp config override auto stripe config", async () => {
    const provider = new CaptureMcpServersProvider();
    registerProvider(provider);

    const customStripe = {
      type: "http",
      url: "https://example.com/custom-stripe",
      headers: {
        Authorization: "Bearer custom_token",
      },
    };

    const created = createSession("claude", {
      cwd: process.cwd(),
      env: {
        STRIPE_SECRET_KEY: "sk_test_123",
      },
      mcpServers: {
        stripe: customStripe,
      },
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const send = sendMessage(created.sessionId, "test");
    expect(send.success).toBe(true);
    await waitForSessionStatus(created.sessionId, "completed");

    expect(provider.seenMcpServers).toHaveLength(1);
    const mcpServers = provider.seenMcpServers[0] || {};
    expect(mcpServers.stripe).toEqual(customStripe);
  });

  it("auto-configures both Stripe and RevenueCat MCP when both secrets exist", async () => {
    const provider = new CaptureMcpServersProvider();
    registerProvider(provider);

    const created = createSession("claude", {
      cwd: process.cwd(),
      env: {
        STRIPE_SECRET_KEY: "sk_test_123",
        REVENUECAT_API_KEY: "rc_test_123",
      },
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const send = sendMessage(created.sessionId, "test");
    expect(send.success).toBe(true);
    await waitForSessionStatus(created.sessionId, "completed");

    expect(provider.seenMcpServers).toHaveLength(1);
    const mcpServers = provider.seenMcpServers[0] || {};
    expect(mcpServers.stripe).toBeDefined();
    expect(mcpServers.revenuecat).toBeDefined();
  });
});

describe("agent-session completion verification policy", () => {
  it("injects verification directive into system prompt", async () => {
    const provider = new CaptureSystemPromptProvider();
    registerProvider(provider);

    const created = createSession("claude", {
      cwd: process.cwd(),
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const send = sendMessage(created.sessionId, "test");
    expect(send.success).toBe(true);
    await waitForSessionStatus(created.sessionId, "completed");

    expect(provider.seenSystemPrompts).toHaveLength(1);
    const prompt = provider.seenSystemPrompts[0] || "";
    expect(prompt).toContain("Verification Before Completion");
    expect(prompt).toContain("workbench.verify_app_state");
    expect(prompt).toContain("completion gate");
    expect(prompt).toContain("workbench.get_app_logs");
    expect(prompt).toContain("workbench.get_terminal_output");
    expect(prompt).toContain("workbench.stop_app");
    expect(prompt).toContain("workbench.start_app");
  });

  it("pauses completion when mutating actions cannot be auto-verified", async () => {
    const provider = new MutatingWithoutVerificationProvider();
    registerProvider(provider);

    const created = createSession("claude", {
      cwd: process.cwd(),
      projectId: "test-project-gate-block",
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const send = sendMessage(created.sessionId, "Make changes");
    expect(send.success).toBe(true);
    await waitForSessionStatus(created.sessionId, "interrupted");

    const replay = getBackgroundMessages(created.sessionId);
    expect(replay.success).toBe(true);
    const textFrames = replay.messages.filter((f) => f.type === "text");
    const joinedText = textFrames
      .map((frame) => String((frame.payload as { delta?: string })?.delta || ""))
      .join("\n");
    expect(joinedText).toContain("Completion verification gate paused this turn");
    expect(joinedText).toContain("Run workbench.verify_app_state");
    const doneFrame = replay.messages.find((f) => f.type === "done");
    expect(doneFrame).toBeUndefined();
    const cancelledFrame = replay.messages.find((f) => f.type === "cancelled");
    expect(cancelledFrame).toBeDefined();
  });

  it("allows completion when verify_app_state succeeds after mutating actions", async () => {
    const provider = new MutatingWithSuccessfulVerificationProvider();
    registerProvider(provider);

    const created = createSession("claude", {
      cwd: process.cwd(),
      projectId: "test-project-gate-pass",
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const send = sendMessage(created.sessionId, "Make changes");
    expect(send.success).toBe(true);
    await waitForSessionStatus(created.sessionId, "completed");

    const replay = getBackgroundMessages(created.sessionId);
    expect(replay.success).toBe(true);
    const doneFrame = replay.messages.find((f) => f.type === "done");
    expect(doneFrame).toBeDefined();
    const errorFrame = replay.messages.find((f) => f.type === "error");
    expect(errorFrame).toBeUndefined();
  });

  it("queues verification guidance as a user prompt when stream stops before completion verification", async () => {
    const provider = new MutatingInterruptedProvider();
    registerProvider(provider);

    const created = createSession("claude", {
      cwd: process.cwd(),
      projectId: "test-project-gate-interrupted",
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const send = sendMessage(created.sessionId, "Make changes");
    expect(send.success).toBe(true);
    await waitForSessionStatus(created.sessionId, "interrupted");

    const replay = getBackgroundMessages(created.sessionId);
    expect(replay.success).toBe(true);
    const queueFrame = replay.messages.find((f) => f.type === "queue_user_prompt");
    expect(queueFrame).toBeDefined();
    const queuedPrompt = String(
      (queueFrame?.payload as { prompt?: string } | undefined)?.prompt ?? "",
    );
    expect(queuedPrompt).toContain("stream stopped before completion verification");
    expect(queuedPrompt).toContain("run workbench.verify_app_state");

    const cancelledFrame = replay.messages.find((f) => f.type === "cancelled");
    expect(cancelledFrame).toBeDefined();
  });
});
