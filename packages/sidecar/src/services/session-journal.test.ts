import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  appendAgentMessageToJournal,
  appendUserMessageToJournal,
  initializeSessionJournal,
  readSessionHistory,
  updateSessionJournalStatus,
} from "./session-journal.ts";

const SESSION_JOURNALS_DIR = path.join(os.homedir(), ".bfloat-ide", "agent-sessions");
const createdSessionIds = new Set<string>();

afterEach(() => {
  for (const sessionId of createdSessionIds) {
    const journalPath = path.join(SESSION_JOURNALS_DIR, `${sessionId}.json`);
    if (fs.existsSync(journalPath)) {
      fs.rmSync(journalPath, { force: true });
    }
  }
  createdSessionIds.clear();
});

describe("session journal", () => {
  it("persists user and agent transcript entries with the latest sequence number", async () => {
    const sessionId = `journal-test-${Date.now()}`;
    createdSessionIds.add(sessionId);

    await initializeSessionJournal({
      sessionId,
      provider: "codex",
      cwd: process.cwd(),
      projectId: "project-1",
    });

    await appendUserMessageToJournal(
      {
        sessionId,
        provider: "codex",
        cwd: process.cwd(),
        projectId: "project-1",
        status: "running",
      },
      {
        id: "user-1",
        role: "user",
        content: "Build me an app",
        parts: [{ type: "text", text: "Build me an app" }],
        createdAt: "2026-03-11T12:00:00.000Z",
      },
    );

    await appendAgentMessageToJournal(
      {
        sessionId,
        provider: "codex",
        cwd: process.cwd(),
        projectId: "project-1",
        status: "running",
      },
      {
        type: "text",
        content: "Working on it",
        metadata: { seq: 4, timestamp: Date.now() },
      },
    );

    await updateSessionJournalStatus(sessionId, "completed");

    const result = await readSessionHistory(sessionId);
    expect(result).not.toBeNull();
    expect(result?.journal.entries).toHaveLength(2);
    expect(result?.journal.lastSeq).toBe(4);
    expect(result?.journal.status).toBe("completed");
  });

  it("resolves a journal by provider session ID alias", async () => {
    const sessionId = `journal-alias-${Date.now()}`;
    createdSessionIds.add(sessionId);

    await initializeSessionJournal({
      sessionId,
      provider: "claude",
      cwd: process.cwd(),
      providerSessionId: "provider-session-123",
    });

    const result = await readSessionHistory("provider-session-123");
    expect(result?.canonicalSessionId).toBe(sessionId);
    expect(result?.journal.providerSessionId).toBe("provider-session-123");
  });
});
