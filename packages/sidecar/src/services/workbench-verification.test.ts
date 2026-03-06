import { afterEach, describe, expect, it } from "bun:test";
import { listTerminalSessionsForCwd, terminalSessions } from "../routes/terminal.ts";
import { upsertRuntimeState } from "./workbench-runtime.ts";
import {
  getRedactedTerminalTail,
  getRedactedTerminalTailForTerminalId,
  redactTerminalOutput,
  resolveRuntimeTerminal,
} from "./workbench-verification.ts";

function makeCwd(label: string): string {
  return `/tmp/workbench-verification-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

afterEach(() => {
  terminalSessions.clear();
});

describe("workbench verification redaction", () => {
  it("redacts common secrets and keeps public env vars", () => {
    const raw = [
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
      "STRIPE_SECRET_KEY=sk_test_1234567890abcdef",
      "NEXT_PUBLIC_API_URL=https://example.com?token=abc123&ok=1",
      "JWT=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.your_signature_value_1234",
    ].join("\n");

    const redacted = redactTerminalOutput(raw);

    expect(redacted.redactionCount).toBeGreaterThan(0);
    expect(redacted.text).toContain("Bearer [REDACTED]");
    expect(redacted.text).toContain("STRIPE_SECRET_KEY=[REDACTED");
    expect(redacted.text).toContain("token=[REDACTED]");
    expect(redacted.text).toContain("NEXT_PUBLIC_API_URL=https://example.com");
    expect(redacted.text).not.toContain("sk_test_1234567890abcdef");
  });
});

describe("workbench verification terminal resolution", () => {
  it("prefers runtime devServerTerminalId when active", () => {
    const cwd = makeCwd("runtime-id");
    upsertRuntimeState({ cwd, devServerTerminalId: "term-runtime", serverStatus: "running" });

    terminalSessions.set(
      "term-runtime",
      {
        id: "term-runtime",
        pty: null,
        fallbackProc: null,
        isPty: false,
        shell: "/bin/zsh",
        cwd,
        cols: 80,
        rows: 24,
        createdAt: 1,
        outputBuffer: "ready",
        subscribers: new Set(),
      } as any,
    );

    const resolved = resolveRuntimeTerminal(cwd);
    expect(resolved.source).toBe("runtime_terminal_id");
    expect(resolved.snapshot?.id).toBe("term-runtime");
    expect(resolved.warning).toBeUndefined();
  });

  it("falls back to latest cwd terminal when runtime terminal is stale", () => {
    const cwd = makeCwd("fallback");
    upsertRuntimeState({ cwd, devServerTerminalId: "missing-terminal", serverStatus: "running" });

    terminalSessions.set(
      "older",
      {
        id: "older",
        pty: null,
        fallbackProc: null,
        isPty: false,
        shell: "/bin/zsh",
        cwd,
        cols: 80,
        rows: 24,
        createdAt: 10,
        outputBuffer: "old output",
        subscribers: new Set(),
      } as any,
    );

    terminalSessions.set(
      "latest",
      {
        id: "latest",
        pty: null,
        fallbackProc: null,
        isPty: false,
        shell: "/bin/zsh",
        cwd,
        cols: 80,
        rows: 24,
        createdAt: 20,
        outputBuffer: "latest output",
        subscribers: new Set(),
      } as any,
    );

    const resolved = resolveRuntimeTerminal(cwd);
    expect(resolved.source).toBe("cwd_latest");
    expect(resolved.snapshot?.id).toBe("latest");
    expect(resolved.warning).toContain("fell back to latest terminal");
  });

  it("returns redacted terminal tail metadata", () => {
    const cwd = makeCwd("tail");

    terminalSessions.set(
      "tail-terminal",
      {
        id: "tail-terminal",
        pty: null,
        fallbackProc: null,
        isPty: false,
        shell: "/bin/zsh",
        cwd,
        cols: 80,
        rows: 24,
        createdAt: 50,
        outputBuffer:
          "API_KEY=supersecret\nGET /api?token=abc123\nAuthorization: Bearer thisisaverysecrettoken",
        subscribers: new Set(),
      } as any,
    );

    const tail = getRedactedTerminalTail(cwd, 5000);
    expect(tail.terminalId).toBe("tail-terminal");
    expect(tail.source).toBe("cwd_latest");
    expect(tail.logText).toContain("API_KEY=[REDACTED");
    expect(tail.logText).toContain("token=[REDACTED]");
    expect(tail.logText).toContain("Bearer [REDACTED]");
    expect(tail.redactionCount).toBeGreaterThan(0);
  });

  it("returns explicit warning when no terminal can be resolved", () => {
    const cwd = makeCwd("none");
    upsertRuntimeState({ cwd, serverStatus: "running", devServerTerminalId: "missing" });

    const tail = getRedactedTerminalTail(cwd, 1000);
    expect(tail.terminalId).toBeUndefined();
    expect(tail.logText).toBeUndefined();
    expect(tail.warning).toContain("not active");
  });

  it("reads output by explicit terminal id with redaction", () => {
    const cwd = makeCwd("explicit");

    terminalSessions.set(
      "explicit-terminal",
      {
        id: "explicit-terminal",
        pty: null,
        fallbackProc: null,
        isPty: false,
        shell: "/bin/zsh",
        cwd,
        cols: 80,
        rows: 24,
        createdAt: 25,
        outputBuffer: "TOKEN=shhh-secret\nAuthorization: Bearer verysecretvalue",
        subscribers: new Set(),
      } as any,
    );

    const tail = getRedactedTerminalTailForTerminalId("explicit-terminal", 1000);
    expect(tail.terminalId).toBe("explicit-terminal");
    expect(tail.source).toBe("explicit_terminal_id");
    expect(tail.logText).toContain("TOKEN=[REDACTED");
    expect(tail.logText).toContain("Bearer [REDACTED]");
  });
});

describe("terminal session listing", () => {
  it("lists cwd terminal sessions newest-first with metadata", () => {
    const cwd = makeCwd("list");

    terminalSessions.set(
      "older",
      {
        id: "older",
        pty: null,
        fallbackProc: null,
        isPty: false,
        shell: "/bin/zsh",
        cwd,
        cols: 80,
        rows: 24,
        createdAt: 10,
        outputBuffer: "old",
        subscribers: new Set(),
      } as any,
    );
    terminalSessions.set(
      "newer",
      {
        id: "newer",
        pty: null,
        fallbackProc: null,
        isPty: false,
        shell: "/bin/zsh",
        cwd,
        cols: 100,
        rows: 40,
        createdAt: 20,
        outputBuffer: "new",
        subscribers: new Set(),
      } as any,
    );

    const sessions = listTerminalSessionsForCwd(cwd);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.id).toBe("newer");
    expect(sessions[1]?.id).toBe("older");
    expect(sessions[0]?.cols).toBe(100);
  });
});
