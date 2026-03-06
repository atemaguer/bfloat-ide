import { getRuntimeState } from "./workbench-runtime.ts";
import {
  getLatestTerminalSessionSnapshotForCwd,
  getTerminalSessionSnapshot,
  type TerminalSessionSnapshot,
} from "../routes/terminal.ts";

const DEFAULT_LOG_MAX_CHARS = 6_000;

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "key",
  "secret",
  "password",
  "pwd",
  "authorization",
  "auth",
  "session",
]);

const PUBLIC_ENV_PREFIXES = ["NEXT_PUBLIC_", "EXPO_PUBLIC_", "PUBLIC_", "VITE_", "REACT_APP_"];

const SENSITIVE_ENV_FRAGMENTS = [
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PASS",
  "PRIVATE",
  "AUTH",
  "COOKIE",
  "KEY",
  "SESSION",
];

export interface ResolvedTerminalInfo {
  snapshot: TerminalSessionSnapshot | null;
  source: "runtime_terminal_id" | "cwd_latest" | "explicit_terminal_id" | "none";
  warning?: string;
}

export interface RedactionResult {
  text: string;
  redactionCount: number;
}

function isSensitiveEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (PUBLIC_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))) return false;
  return SENSITIVE_ENV_FRAGMENTS.some((fragment) => upper.includes(fragment));
}

function redactQueryString(text: string): RedactionResult {
  let redactionCount = 0;

  const redacted = text.replace(
    /([?&])([^\s&#=]+)=([^\s&#]*)/gi,
    (match, delimiter: string, rawKey: string, rawValue: string) => {
      const key = rawKey.toLowerCase();
      if (!SENSITIVE_QUERY_KEYS.has(key) || !rawValue) {
        return match;
      }
      redactionCount += 1;
      return `${delimiter}${rawKey}=[REDACTED]`;
    }
  );

  return { text: redacted, redactionCount };
}

export function redactTerminalOutput(raw: string): RedactionResult {
  let text = raw;
  let redactionCount = 0;

  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/g, (_match, prefix: string) => {
    redactionCount += 1;
    return `${prefix}[REDACTED]`;
  });

  text = text.replace(/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, () => {
    redactionCount += 1;
    return "[REDACTED_JWT]";
  });

  text = text.replace(/\b(sk|pk)_(live|test)_[A-Za-z0-9]{8,}\b/g, () => {
    redactionCount += 1;
    return "[REDACTED_KEY]";
  });

  text = text.replace(
    /\b([A-Z][A-Z0-9_]{2,})\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/g,
    (match, rawKey: string, rawValue: string) => {
      if (!isSensitiveEnvKey(rawKey)) return match;
      redactionCount += 1;
      return `${rawKey}=[REDACTED:${rawValue.length}]`;
    }
  );

  const queryRedaction = redactQueryString(text);
  text = queryRedaction.text;
  redactionCount += queryRedaction.redactionCount;

  return { text, redactionCount };
}

export function resolveRuntimeTerminal(cwd: string): ResolvedTerminalInfo {
  const runtime = getRuntimeState(cwd);
  const terminalId = runtime?.devServerTerminalId;

  if (terminalId) {
    const runtimeSnapshot = getTerminalSessionSnapshot(terminalId);
    if (runtimeSnapshot) {
      return {
        snapshot: runtimeSnapshot,
        source: "runtime_terminal_id",
      };
    }

    const fallbackSnapshot = getLatestTerminalSessionSnapshotForCwd(cwd);
    if (fallbackSnapshot) {
      return {
        snapshot: fallbackSnapshot,
        source: "cwd_latest",
        warning:
          `Runtime terminal '${terminalId}' was not active; fell back to latest terminal '${fallbackSnapshot.id}' for cwd.`,
      };
    }

    return {
      snapshot: null,
      source: "none",
      warning: `Runtime terminal '${terminalId}' was not active and no terminal sessions were found for cwd.`,
    };
  }

  const snapshot = getLatestTerminalSessionSnapshotForCwd(cwd);
  if (snapshot) {
    return {
      snapshot,
      source: "cwd_latest",
      warning: "Runtime did not report devServerTerminalId; using latest terminal for cwd.",
    };
  }

  return {
    snapshot: null,
    source: "none",
    warning: "No active terminal session found for cwd.",
  };
}

export function getRedactedTerminalTail(
  cwd: string,
  maxChars: number = DEFAULT_LOG_MAX_CHARS
): {
  terminalId?: string;
  source: ResolvedTerminalInfo["source"];
  warning?: string;
  logText?: string;
  logChars?: number;
  redactionCount?: number;
} {
  const boundedChars = Math.max(200, Math.min(maxChars, 20_000));
  const resolved = resolveRuntimeTerminal(cwd);
  const snapshot = resolved.snapshot;

  if (!snapshot) {
    return {
      source: resolved.source,
      warning: resolved.warning,
    };
  }

  return getRedactedTerminalTailForTerminalId(snapshot.id, boundedChars, {
    source: resolved.source,
    warning: resolved.warning,
  });
}

export function getRedactedTerminalTailForTerminalId(
  terminalId: string,
  maxChars: number = DEFAULT_LOG_MAX_CHARS,
  context?: {
    source?: ResolvedTerminalInfo["source"];
    warning?: string;
  }
): {
  terminalId?: string;
  source: ResolvedTerminalInfo["source"];
  warning?: string;
  logText?: string;
  logChars?: number;
  redactionCount?: number;
} {
  const boundedChars = Math.max(200, Math.min(maxChars, 20_000));
  const snapshot = getTerminalSessionSnapshot(terminalId, boundedChars);
  if (!snapshot) {
    return {
      source: context?.source ?? "none",
      warning:
        context?.warning ??
        `Terminal session '${terminalId}' is not active.`,
    };
  }

  const tail = snapshot.outputTail.slice(-boundedChars);
  const redacted = redactTerminalOutput(tail);

  return {
    terminalId: snapshot.id,
    source: context?.source ?? "explicit_terminal_id",
    warning: context?.warning,
    logText: redacted.text,
    logChars: redacted.text.length,
    redactionCount: redacted.redactionCount,
  };
}
