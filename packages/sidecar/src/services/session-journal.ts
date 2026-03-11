import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { AgentProviderId, SessionStatus } from "./agent-session.ts";
import type { AgentMessage } from "./agent-message.ts";

const BFLOAT_DIR = path.join(os.homedir(), ".bfloat-ide");
const SESSION_JOURNALS_DIR = path.join(BFLOAT_DIR, "agent-sessions");

export interface SessionJournalDisplayMessage {
  id: string;
  role: "user";
  content: string;
  parts?: Array<Record<string, unknown>>;
  createdAt: string;
}

export type SessionJournalEntry =
  | { kind: "user_message"; message: SessionJournalDisplayMessage }
  | { kind: "agent_message"; message: AgentMessage };

export interface SessionJournal {
  sessionId: string;
  provider: AgentProviderId;
  providerSessionId?: string;
  projectId?: string;
  cwd: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  lastSeq: number;
  entries: SessionJournalEntry[];
}

interface SessionJournalInit {
  sessionId: string;
  provider: AgentProviderId;
  cwd: string;
  projectId?: string;
  providerSessionId?: string;
  status?: SessionStatus;
}

export interface SessionHistoryResult {
  journal: SessionJournal;
  canonicalSessionId: string;
}

const writeChains = new Map<string, Promise<void>>();

function ensureSessionJournalsDir(): void {
  if (!fs.existsSync(BFLOAT_DIR)) {
    fs.mkdirSync(BFLOAT_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSION_JOURNALS_DIR)) {
    fs.mkdirSync(SESSION_JOURNALS_DIR, { recursive: true });
  }
}

function getJournalPath(sessionId: string): string {
  ensureSessionJournalsDir();
  return path.join(SESSION_JOURNALS_DIR, `${sessionId}.json`);
}

function createEmptyJournal(init: SessionJournalInit): SessionJournal {
  const now = new Date().toISOString();
  return {
    sessionId: init.sessionId,
    provider: init.provider,
    providerSessionId: init.providerSessionId,
    projectId: init.projectId,
    cwd: init.cwd,
    status: init.status ?? "idle",
    createdAt: now,
    updatedAt: now,
    lastSeq: 0,
    entries: [],
  };
}

function readJournalFromDisk(sessionId: string): SessionJournal | null {
  const journalPath = getJournalPath(sessionId);
  if (!fs.existsSync(journalPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(journalPath, "utf-8")) as SessionJournal;
  } catch (error) {
    console.error("[SessionJournal] Failed to read journal:", sessionId, error);
    return null;
  }
}

function writeJournalToDisk(journal: SessionJournal): void {
  const journalPath = getJournalPath(journal.sessionId);
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
}

function withJournalWriteLock(sessionId: string, operation: () => void | Promise<void>): Promise<void> {
  const previous = writeChains.get(sessionId) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(operation);
  writeChains.set(sessionId, next.finally(() => {
    if (writeChains.get(sessionId) === next) {
      writeChains.delete(sessionId);
    }
  }));
  return next;
}

async function mutateJournal(
  init: SessionJournalInit,
  mutate: (journal: SessionJournal) => void
): Promise<SessionJournal> {
  let updated: SessionJournal | null = null;
  await withJournalWriteLock(init.sessionId, () => {
    const journal = readJournalFromDisk(init.sessionId) ?? createEmptyJournal(init);
    if (!journal.projectId && init.projectId) journal.projectId = init.projectId;
    if (!journal.providerSessionId && init.providerSessionId) journal.providerSessionId = init.providerSessionId;
    if (journal.status === "idle" && init.status && init.status !== "idle") journal.status = init.status;
    mutate(journal);
    journal.updatedAt = new Date().toISOString();
    writeJournalToDisk(journal);
    updated = journal;
  });

  return updated ?? createEmptyJournal(init);
}

function getAllJournalPaths(): string[] {
  ensureSessionJournalsDir();
  return fs.readdirSync(SESSION_JOURNALS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(SESSION_JOURNALS_DIR, file));
}

function findJournalByProviderSessionId(providerSessionId: string): SessionJournal | null {
  for (const journalPath of getAllJournalPaths()) {
    try {
      const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as SessionJournal;
      if (journal.providerSessionId === providerSessionId) {
        return journal;
      }
    } catch (error) {
      console.warn("[SessionJournal] Failed to scan journal:", journalPath, error);
    }
  }

  return null;
}

export async function initializeSessionJournal(init: SessionJournalInit): Promise<SessionJournal> {
  return mutateJournal(init, (journal) => {
    journal.provider = init.provider;
    journal.cwd = init.cwd;
    journal.projectId = init.projectId ?? journal.projectId;
    journal.providerSessionId = init.providerSessionId ?? journal.providerSessionId;
    journal.status = init.status ?? journal.status;
  });
}

export async function appendUserMessageToJournal(
  init: SessionJournalInit,
  message: SessionJournalDisplayMessage
): Promise<SessionJournal> {
  return mutateJournal(init, (journal) => {
    journal.entries.push({ kind: "user_message", message });
    journal.status = "running";
  });
}

export async function appendAgentMessageToJournal(
  init: SessionJournalInit,
  message: AgentMessage
): Promise<SessionJournal> {
  return mutateJournal(init, (journal) => {
    journal.entries.push({ kind: "agent_message", message });
    const seq = typeof message.metadata?.seq === "number" ? message.metadata.seq : undefined;
    if (typeof seq === "number" && seq > journal.lastSeq) {
      journal.lastSeq = seq;
    }

    if (message.type === "init") {
      const content = (message.content ?? {}) as { providerSessionId?: string };
      if (content.providerSessionId) {
        journal.providerSessionId = content.providerSessionId;
      }
    }
  });
}

export async function updateSessionJournalStatus(
  sessionId: string,
  status: SessionStatus
): Promise<SessionJournal | null> {
  const current = readJournalFromDisk(sessionId);
  if (!current) return null;

  return mutateJournal(
    {
      sessionId,
      provider: current.provider,
      cwd: current.cwd,
      projectId: current.projectId,
      providerSessionId: current.providerSessionId,
      status,
    },
    (journal) => {
      journal.status = status;
    }
  );
}

export async function updateSessionJournalMetadata(
  sessionId: string,
  metadata: Partial<Pick<SessionJournal, "providerSessionId" | "status" | "projectId" | "cwd">>
): Promise<SessionJournal | null> {
  const current = readJournalFromDisk(sessionId);
  if (!current) return null;

  return mutateJournal(
    {
      sessionId,
      provider: current.provider,
      cwd: metadata.cwd ?? current.cwd,
      projectId: metadata.projectId ?? current.projectId,
      providerSessionId: metadata.providerSessionId ?? current.providerSessionId,
      status: metadata.status ?? current.status,
    },
    (journal) => {
      if (metadata.providerSessionId) journal.providerSessionId = metadata.providerSessionId;
      if (metadata.projectId) journal.projectId = metadata.projectId;
      if (metadata.cwd) journal.cwd = metadata.cwd;
      if (metadata.status) journal.status = metadata.status;
    }
  );
}

export async function readSessionHistory(sessionId: string): Promise<SessionHistoryResult | null> {
  const direct = readJournalFromDisk(sessionId);
  if (direct) {
    return {
      journal: direct,
      canonicalSessionId: direct.sessionId,
    };
  }

  const aliased = findJournalByProviderSessionId(sessionId);
  if (aliased) {
    return {
      journal: aliased,
      canonicalSessionId: aliased.sessionId,
    };
  }

  return null;
}
