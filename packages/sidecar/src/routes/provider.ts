/**
 * Provider Routes
 *
 * Ports the Electron provider-handler IPC handlers to Hono HTTP routes.
 * Manages authentication for AI providers (Anthropic, OpenAI/Codex, Expo).
 *
 * Key differences from the Electron handler:
 * - No Electron APIs (dialog, BrowserWindow, app.isPackaged).
 * - The bundled Claude CLI / Codex binary spawning is replaced with
 *   Bun.spawn() + the system PATH (npx fallback).
 * - Provider auth output is streamed over SSE instead of via IPC.
 * - The OpenAI browser OAuth callback server is started inside the sidecar
 *   process (exactly as in the Electron handler).
 *
 * Routes:
 *   GET  /api/provider/check-auth               – check Claude auth status
 *   GET  /api/provider/check-expo-auth          – check Expo auth status
 *   GET  /api/provider/check-openai-auth        – check Codex / OpenAI auth status
 *   GET  /api/provider/check-claude-cli         – check if system claude CLI is installed
 *   GET  /api/provider/load-tokens              – load all provider tokens
 *   POST /api/provider/connect-anthropic        – spawn claude auth login (blocking)
 *   POST /api/provider/connect-openai           – browser PKCE OAuth flow (blocking)
 *   POST /api/provider/connect-expo             – npx expo login (SSE response)
 *   POST /api/provider/disconnect               – disable a provider
 *   POST /api/provider/save-tokens             – persist tokens
 *   POST /api/provider/save-git-bash-path       – Windows only: store git-bash path
 */

import { Hono } from "hono";
import { z } from "zod";
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Configuration paths (mirrors provider-handler.ts)
// ---------------------------------------------------------------------------

const CLAUDE_CONFIG_PATH = path.join(os.homedir(), ".claude.json");
const CLAUDE_CONFIG_DIR =
  process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
const CLAUDE_CREDENTIALS_PATH = path.join(CLAUDE_CONFIG_DIR, ".credentials.json");
const DEFAULT_CODEX_HOME = path.join(os.homedir(), ".codex");
const EXPO_STATE_PATH = path.join(os.homedir(), ".expo", "state.json");
const BFLOAT_CONFIG_DIR = path.join(os.homedir(), ".bfloat-ide", "config");
const SETTINGS_PATH = path.join(BFLOAT_CONFIG_DIR, "settings.json");

// OpenAI PKCE OAuth constants (same as provider-handler)
const OPENAI_ISSUER = "https://auth.openai.com";
const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_OAUTH_PORT = 1455;

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface ClaudeOAuthAccount {
  accountUuid: string;
  emailAddress: string;
  organizationUuid?: string;
}

interface ClaudeConfig {
  oauthAccount?: ClaudeOAuthAccount;
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string | null;
    expiresAt?: number | null;
    scopes?: string[];
    subscriptionType?: string | null;
    rateLimitTier?: string | null;
  };
  apiKey?: string;
  anthropicApiKey?: string;
  oauthToken?: string;
}

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

interface ExpoStateFile {
  auth?: {
    sessionSecret?: string;
    userId?: string;
    username?: string;
    currentConnection?: string;
  };
}

interface BfloatSettings {
  integrations?: {
    anthropic?: { enabled: boolean; connectedAt?: number; accountId?: string };
    openai?: { enabled: boolean; connectedAt?: number; accountId?: string };
    expo?: { enabled: boolean; connectedAt?: number; userId?: string; username?: string };
  };
  credentials?: Partial<Record<"EXPO_TOKEN", string>>;
  cli?: { gitBashPath?: string };
}

interface OAuthTokens {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
  scopes?: string[];
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function ensureConfigDir(): void {
  if (!fs.existsSync(BFLOAT_CONFIG_DIR)) {
    fs.mkdirSync(BFLOAT_CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadSettings(): BfloatSettings {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    const content = fs.readFileSync(SETTINGS_PATH, "utf-8");
    return JSON.parse(content) as BfloatSettings;
  } catch {
    return {};
  }
}

function saveSettings(settings: BfloatSettings): void {
  ensureConfigDir();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Claude credential helpers
// ---------------------------------------------------------------------------

function readClaudeCredentials(): ClaudeCredentialsFile | null {
  try {
    if (!fs.existsSync(CLAUDE_CREDENTIALS_PATH)) return null;
    return JSON.parse(fs.readFileSync(CLAUDE_CREDENTIALS_PATH, "utf-8")) as ClaudeCredentialsFile;
  } catch {
    return null;
  }
}

function writeClaudeCredentials(credentials: ClaudeCredentialsFile): void {
  if (!fs.existsSync(CLAUDE_CONFIG_DIR)) {
    fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(CLAUDE_CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

function clearClaudeAuthState(): void {
  try {
    if (fs.existsSync(CLAUDE_CONFIG_PATH)) {
      const raw = fs.readFileSync(CLAUDE_CONFIG_PATH, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      if (config.oauthAccount) {
        delete config.oauthAccount;
        fs.writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), {
          encoding: "utf-8",
          mode: 0o600,
        });
      }
    }
  } catch (err) {
    console.error("[Provider] Failed to clear oauthAccount:", err);
  }

  try {
    const creds = readClaudeCredentials();
    if (creds?.oauthToken) {
      delete creds.oauthToken;
      writeClaudeCredentials(creds);
    }
  } catch (err) {
    console.error("[Provider] Failed to clear oauthToken:", err);
  }
}

// ---------------------------------------------------------------------------
// Codex auth helpers
// ---------------------------------------------------------------------------

function getCodexAuthPath(): string {
  const envHome = process.env.CODEX_HOME;
  const home = envHome && envHome.trim() ? envHome : DEFAULT_CODEX_HOME;
  return path.join(home, "auth.json");
}

function readCodexAuthFile(): CodexAuthFile | null {
  const candidates = [
    getCodexAuthPath(),
    path.join(os.homedir(), ".codex", "auth.json"),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      return JSON.parse(fs.readFileSync(candidate, "utf-8")) as CodexAuthFile;
    } catch { /* try next */ }
  }
  return null;
}

function writeCodexAuthFile(auth: CodexAuthFile): void {
  const codexDir = path.dirname(getCodexAuthPath());
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(getCodexAuthPath(), JSON.stringify(auth, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Auth checking functions
// ---------------------------------------------------------------------------

function checkClaudeAuth(): {
  authenticated: boolean;
  providers: string[];
  account?: ClaudeOAuthAccount;
} {
  try {
    let config: ClaudeConfig | null = null;
    if (fs.existsSync(CLAUDE_CONFIG_PATH)) {
      try {
        config = JSON.parse(fs.readFileSync(CLAUDE_CONFIG_PATH, "utf-8")) as ClaudeConfig;
      } catch { config = null; }
    }

    const creds = readClaudeCredentials();
    const hasOauthToken = Boolean(creds?.claudeAiOauth?.accessToken);
    const hasAccount = Boolean(config?.oauthAccount?.accountUuid);
    const hasApiKey = Boolean(creds?.apiKey || creds?.anthropicApiKey);
    const hasSetupToken = Boolean(creds?.oauthToken);
    const hasEnvApiKey = Boolean(process.env.ANTHROPIC_API_KEY);

    if (hasOauthToken || hasAccount || hasApiKey || hasSetupToken || hasEnvApiKey) {
      return { authenticated: true, providers: ["anthropic"], account: config?.oauthAccount };
    }
    return { authenticated: false, providers: [] };
  } catch {
    return { authenticated: false, providers: [] };
  }
}

function checkCodexAuth(): {
  authenticated: boolean;
  accessToken?: string;
  refreshToken?: string;
  accountId?: string;
} {
  try {
    const auth = readCodexAuthFile();
    if (!auth) return { authenticated: false };
    if (auth.tokens?.refresh_token) {
      return {
        authenticated: true,
        accessToken: auth.tokens.access_token,
        refreshToken: auth.tokens.refresh_token,
        accountId: auth.tokens.account_id,
      };
    }
    return { authenticated: false };
  } catch {
    return { authenticated: false };
  }
}

function checkExpoAuth(): {
  authenticated: boolean;
  userId?: string;
  username?: string;
} {
  try {
    if (!fs.existsSync(EXPO_STATE_PATH)) return { authenticated: false };
    const state = JSON.parse(fs.readFileSync(EXPO_STATE_PATH, "utf-8")) as ExpoStateFile;
    if (state.auth?.userId && state.auth?.username) {
      return { authenticated: true, userId: state.auth.userId, username: state.auth.username };
    }
    return { authenticated: false };
  } catch {
    return { authenticated: false };
  }
}

// ---------------------------------------------------------------------------
// System Claude CLI detection (mirrors findSystemClaudeCli)
// ---------------------------------------------------------------------------

function findSystemClaudeCli(): { installed: boolean; path?: string } {
  const candidates: string[] =
    process.platform === "win32"
      ? [
          path.join(os.homedir(), ".local", "bin", "claude.exe"),
          path.join(os.homedir(), "AppData", "Local", "Programs", "claude-code", "claude.exe"),
          path.join(os.homedir(), "AppData", "Roaming", "npm", "claude.cmd"),
        ]
      : [
          path.join(os.homedir(), ".local", "bin", "claude"),
          "/opt/homebrew/bin/claude",
          "/usr/local/bin/claude",
          "/usr/bin/claude",
        ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return { installed: true, path: p };
    } catch { /* ignore */ }
  }
  return { installed: false };
}

// ---------------------------------------------------------------------------
// Spawn CLI (Bun.spawn wrapper, mirrors spawnCliCommand for macOS/Linux)
// ---------------------------------------------------------------------------

async function spawnCli(
  command: string,
  args: string[],
  options?: { env?: Record<string, string>; cwd?: string; onOutput?: (data: string) => void; timeoutMs?: number }
): Promise<{ success: boolean; exitCode: number; output: string }> {
  let output = "";
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: "xterm-256color",
    ...(options?.env ?? {}),
  };

  const proc = Bun.spawn([command, ...args], {
    cwd: options?.cwd ?? os.homedir(),
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  // Set up timeout
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  if (options?.timeoutMs && options.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, options.timeoutMs);
  }

  const streamOutput = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      output += chunk;
      options?.onOutput?.(chunk);
    }
  };

  await Promise.all([streamOutput(proc.stdout), streamOutput(proc.stderr)]);

  const exitCode = await proc.exited;
  if (timeoutHandle) clearTimeout(timeoutHandle);

  if (timedOut) {
    return {
      success: false,
      exitCode: -1,
      output: `Command timed out after ${Math.round((options?.timeoutMs ?? 0) / 1000)}s. ${output}`.trim(),
    };
  }

  return { success: exitCode === 0, exitCode, output };
}

// ---------------------------------------------------------------------------
// OpenAI PKCE helpers (mirrors provider-handler)
// ---------------------------------------------------------------------------

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = generateRandomString(43);
  const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractOpenAIAccountId(tokens: { id_token?: string; access_token?: string }): string | undefined {
  for (const jwt of [tokens.id_token, tokens.access_token]) {
    if (!jwt) continue;
    const claims = parseJwtClaims(jwt);
    if (!claims) continue;
    const authClaim = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    const accountId =
      (claims["chatgpt_account_id"] as string | undefined) ||
      (authClaim?.["chatgpt_account_id"] as string | undefined) ||
      ((claims["organizations"] as Array<{ id: string }> | undefined)?.[0]?.id);
    if (accountId) return accountId;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Token save helpers
// ---------------------------------------------------------------------------

const DEFAULT_CLAUDE_SCOPES = ["org:create_api_key", "user:profile", "user:inference"];

function saveClaudeTokens(tokens: OAuthTokens): void {
  if (!tokens.accessToken) throw new Error("Missing Claude access token");
  const scopes = tokens.scopes && tokens.scopes.length > 0 ? tokens.scopes : DEFAULT_CLAUDE_SCOPES;
  const existing = readClaudeCredentials() ?? {};
  existing.claudeAiOauth = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    expiresAt: tokens.expiresAt ?? null,
    scopes,
    subscriptionType: tokens.subscriptionType ?? null,
    rateLimitTier: tokens.rateLimitTier ?? null,
  };
  writeClaudeCredentials(existing);
}

function saveCodexTokens(tokens: OAuthTokens): void {
  if (!tokens.refreshToken) throw new Error("Missing Codex refresh token");
  const existing = readCodexAuthFile() ?? {};
  const existingTokens = existing.tokens ?? {};
  writeCodexAuthFile({
    ...existing,
    tokens: {
      ...existingTokens,
      access_token: tokens.accessToken ?? existingTokens.access_token,
      refresh_token: tokens.refreshToken,
      account_id: tokens.accountId ?? existingTokens.account_id,
    },
    last_refresh: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Format CLI output helper
// ---------------------------------------------------------------------------

function formatCliOutput(output?: string | null, lineCount = 6): string | undefined {
  if (!output) return undefined;
  const trimmed = output.trim();
  if (!trimmed) return undefined;
  const lines = trimmed.split(/\r?\n/);
  return lines.slice(-lineCount).join("\n").trim() || undefined;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const DisconnectSchema = z.object({
  provider: z.enum(["anthropic", "openai", "expo"]),
});

const SaveTokensSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  tokens: z.object({
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    expiresAt: z.number().optional(),
    accountId: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    subscriptionType: z.string().nullable().optional(),
    rateLimitTier: z.string().nullable().optional(),
  }),
});

const ProviderSettingsCredentialKeySchema = z.enum(["EXPO_TOKEN"]);

const SaveProviderSettingsCredentialsSchema = z.object({
  entries: z.array(
    z.object({
      key: ProviderSettingsCredentialKeySchema,
      value: z.string(),
    }),
  ),
});

const ConnectExpoSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  otp: z.string().optional(),
});

const SaveGitBashPathSchema = z.object({
  path: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const providerRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/provider/check-auth
// ---------------------------------------------------------------------------
providerRouter.get("/check-auth", (c) => {
  return c.json(checkClaudeAuth());
});

// ---------------------------------------------------------------------------
// GET /api/provider/check-expo-auth
// ---------------------------------------------------------------------------
providerRouter.get("/check-expo-auth", (c) => {
  return c.json(checkExpoAuth());
});

// ---------------------------------------------------------------------------
// GET /api/provider/check-openai-auth
// ---------------------------------------------------------------------------
providerRouter.get("/check-openai-auth", (c) => {
  return c.json(checkCodexAuth());
});

// ---------------------------------------------------------------------------
// GET /api/provider/check-claude-cli
// ---------------------------------------------------------------------------
providerRouter.get("/check-claude-cli", (c) => {
  return c.json(findSystemClaudeCli());
});

// ---------------------------------------------------------------------------
// GET /api/provider/load-tokens
// ---------------------------------------------------------------------------
providerRouter.get("/load-tokens", (c) => {
  const claudeAuth = checkClaudeAuth();
  const claudeCreds = readClaudeCredentials();
  const codexAuth = checkCodexAuth();
  const expoAuth = checkExpoAuth();
  const settings = loadSettings();
  const integrations = settings.integrations ?? {};

  const anthropicEnabled = claudeAuth.authenticated && integrations.anthropic?.enabled !== false;
  const openaiEnabled = codexAuth.authenticated && integrations.openai?.enabled !== false;
  const expoEnabled = expoAuth.authenticated && integrations.expo?.enabled !== false;

  return c.json({
    anthropic: anthropicEnabled
      ? {
          type: "oauth" as const,
          accountId: claudeAuth.account?.accountUuid,
          accessToken: claudeCreds?.claudeAiOauth?.accessToken,
          refreshToken: claudeCreds?.claudeAiOauth?.refreshToken ?? undefined,
          expiresAt: claudeCreds?.claudeAiOauth?.expiresAt ?? Date.now() + 365 * 24 * 60 * 60 * 1000,
          scopes: claudeCreds?.claudeAiOauth?.scopes,
          subscriptionType: claudeCreds?.claudeAiOauth?.subscriptionType,
          rateLimitTier: claudeCreds?.claudeAiOauth?.rateLimitTier,
        }
      : null,
    openai: openaiEnabled
      ? {
          type: "oauth" as const,
          accountId: codexAuth.accountId,
          accessToken: codexAuth.accessToken,
          refreshToken: codexAuth.refreshToken,
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        }
      : null,
    expo: expoEnabled
      ? {
          type: "oauth" as const,
          userId: expoAuth.userId,
          username: expoAuth.username,
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        }
      : null,
  });
});

// ---------------------------------------------------------------------------
// POST /api/provider/connect-anthropic
//
// Spawns `claude auth login` (or `npx @anthropic-ai/claude-code auth login`
// as a fallback) and blocks until the CLI exits. The CLI itself opens the
// user's browser for the OAuth flow. Returns the result as normal JSON.
//
// Modeled after opencode's provider auth pattern: simple POST that blocks
// until completion — no SSE/EventSource involved.
// ---------------------------------------------------------------------------
providerRouter.post("/connect-anthropic", async (c) => {
  // Resolve claude CLI (prefer system-installed, fall back to npx)
  const systemCli = findSystemClaudeCli();
  const claudeCommand = systemCli.installed && systemCli.path ? systemCli.path : "npx";
  const claudeArgs = systemCli.installed && systemCli.path
    ? ["auth", "login"]
    : ["@anthropic-ai/claude-code", "auth", "login"];

  // CI=true tells Ink (React terminal UI used by Claude Code) to use a static
  // renderer that does not require raw mode on stdin.  Without this, Ink crashes
  // with "Raw mode is not supported on the current process.stdin" when stdin is
  // not a real TTY (which is the case when spawned from the sidecar).
  // This matches the Electron Windows implementation in provider-handler.ts.
  const baseEnv = { ...(process.env as Record<string, string>) };
  // Remove CLAUDECODE env var — if set (e.g. when the sidecar is launched from
  // within a Claude Code session), the CLI will refuse to start with "Claude
  // Code cannot be launched inside another Claude Code session".
  delete baseEnv.CLAUDECODE;
  const env: Record<string, string> = {
    ...baseEnv,
    ELECTRON_RUN_AS_NODE: "1",
    CI: "true",
    TERM: "xterm-256color",
  };

  try {
    const result = await spawnCli(claudeCommand, claudeArgs, {
      env,
      timeoutMs: 3 * 60 * 1000, // 3-minute timeout
    });

    // Always check credential files regardless of CLI exit code.
    // The OAuth flow may succeed (browser callback saves credentials) even if
    // the CLI itself exits with a non-zero code (e.g. Ink rendering issues).
    const authStatus = checkClaudeAuth();

    if (authStatus.authenticated) {
      const settings = loadSettings();
      settings.integrations = settings.integrations ?? {};
      settings.integrations.anthropic = {
        enabled: true,
        connectedAt: Date.now(),
        accountId: authStatus.account?.accountUuid,
      };
      saveSettings(settings);
    }

    return c.json({
      success: authStatus.authenticated,
      exitCode: result.exitCode,
      authenticated: authStatus.authenticated,
      providers: authStatus.providers,
      output: formatCliOutput(result.output),
    });
  } catch (err) {
    // Even on spawn failure, check if credentials exist (e.g. from a
    // concurrent auth flow or previously completed browser callback).
    const authStatus = checkClaudeAuth();
    if (authStatus.authenticated) {
      const settings = loadSettings();
      settings.integrations = settings.integrations ?? {};
      settings.integrations.anthropic = {
        enabled: true,
        connectedAt: Date.now(),
        accountId: authStatus.account?.accountUuid,
      };
      saveSettings(settings);
      return c.json({
        success: true,
        exitCode: 0,
        authenticated: true,
        providers: authStatus.providers,
      });
    }

    return c.json({
      success: false,
      exitCode: -1,
      authenticated: false,
      providers: [],
      output: err instanceof Error ? err.message : String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/provider/connect-openai
//
// Runs the PKCE OAuth flow for OpenAI/ChatGPT:
//   1. Starts a local HTTP server on OPENAI_OAUTH_PORT to receive the callback
//   2. Opens the authorization URL in the user's default browser
//   3. Blocks until the callback is received (or timeout)
//   4. Exchanges the authorization code for tokens
//   5. Persists tokens and returns the result as JSON
//
// Modeled after opencode's provider auth pattern: the sidecar owns the
// entire flow (including opening the browser) and returns a single JSON
// response when complete.
// ---------------------------------------------------------------------------
providerRouter.post("/connect-openai", async (c) => {
  // Check if already authenticated
  const existing = checkCodexAuth();
  if (existing.authenticated) {
    const settings = loadSettings();
    settings.integrations = settings.integrations ?? {};
    settings.integrations.openai = {
      enabled: true,
      connectedAt: Date.now(),
      accountId: existing.accountId,
    };
    saveSettings(settings);
    return c.json({
      success: true,
      exitCode: 0,
      authenticated: true,
      providers: ["openai"],
    });
  }

  try {
    const pkce = generatePKCE();
    const state = base64UrlEncode(crypto.randomBytes(32));
    const redirectUri = `http://localhost:${OPENAI_OAUTH_PORT}/auth/callback`;

    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: OPENAI_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access",
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      state,
      originator: "bfloat",
    });

    const authUrl = `${OPENAI_ISSUER}/oauth/authorize?${authParams.toString()}`;

    // Run the OAuth flow as a blocking promise
    const result = await new Promise<{
      success: boolean;
      exitCode: number;
      authenticated: boolean;
      providers: string[];
      output: string;
    }>((resolve) => {
      let resolved = false;
      let server: http.Server | null = null;

      const finish = (r: { success: boolean; exitCode: number; output?: string }) => {
        if (resolved) return;
        resolved = true;
        if (server) server.close();
        const authStatus = checkCodexAuth();
        if (authStatus.authenticated) {
          const settings = loadSettings();
          settings.integrations = settings.integrations ?? {};
          settings.integrations.openai = {
            enabled: true,
            connectedAt: Date.now(),
            accountId: authStatus.accountId,
          };
          saveSettings(settings);
        }
        resolve({
          ...r,
          output: r.output ?? "",
          authenticated: authStatus.authenticated,
          providers: authStatus.authenticated ? ["openai"] : [],
        });
      };

      const timeoutHandle = setTimeout(() => {
        finish({ success: false, exitCode: 1, output: "Authentication timed out." });
      }, 5 * 60 * 1000);

      server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${OPENAI_OAUTH_PORT}`);
        if (url.pathname !== "/auth/callback") {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authorization Failed</h2><p>You can close this tab.</p></body></html>");
          clearTimeout(timeoutHandle);
          finish({ success: false, exitCode: 1, output: `OAuth error: ${error}` });
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h2>Authorization Failed</h2></body></html>");
          clearTimeout(timeoutHandle);
          finish({ success: false, exitCode: 1, output: "Invalid OAuth callback (state mismatch)" });
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          '<html><body style="background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui">' +
            '<div style="text-align:center"><h2 style="color:#4ade80">Authorized!</h2><p>Redirecting back to Bfloat...</p></div>' +
            '<script>window.location.href="bfloat://oauth-success?message=ChatGPT+connected+successfully";setTimeout(()=>window.close(),3000)</script></body></html>'
        );

        try {
          const tokenRes = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri,
              client_id: OPENAI_CLIENT_ID,
              code_verifier: pkce.verifier,
            }).toString(),
          });

          if (!tokenRes.ok) {
            const body = await tokenRes.text().catch(() => "");
            clearTimeout(timeoutHandle);
            finish({ success: false, exitCode: 1, output: `Token exchange failed (HTTP ${tokenRes.status}): ${body}` });
            return;
          }

          const tokens = (await tokenRes.json()) as {
            id_token?: string;
            access_token: string;
            refresh_token: string;
          };

          const accountId = extractOpenAIAccountId(tokens);
          writeCodexAuthFile({
            tokens: {
              id_token: tokens.id_token,
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              account_id: accountId,
            },
            last_refresh: new Date().toISOString(),
          });

          clearTimeout(timeoutHandle);
          finish({ success: true, exitCode: 0, output: "Authentication successful!" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          clearTimeout(timeoutHandle);
          finish({ success: false, exitCode: 1, output: `Token exchange error: ${msg}` });
        }
      });

      server.on("error", (err) => {
        clearTimeout(timeoutHandle);
        finish({ success: false, exitCode: 1, output: `OAuth server error: ${err.message}` });
      });

      server.listen(OPENAI_OAUTH_PORT, "127.0.0.1", () => {
        // Open the authorization URL in the user's default browser.
        // On macOS use "open", on Linux use "xdg-open", on Windows use "start".
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        Bun.spawn([openCmd, authUrl], { stdout: "ignore", stderr: "ignore" });
      });
    });

    return c.json(result);
  } catch (err) {
    return c.json({
      success: false,
      exitCode: -1,
      authenticated: false,
      providers: [],
      output: err instanceof Error ? err.message : String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/provider/connect-expo  { username, password, otp? }
// ---------------------------------------------------------------------------
providerRouter.post("/connect-expo", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ConnectExpoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { username, password, otp } = parsed.data;

  // Check if already authenticated
  const existingAuth = checkExpoAuth();
  if (existingAuth.authenticated) {
    const settings = loadSettings();
    settings.integrations = settings.integrations ?? {};
    settings.integrations.expo = {
      enabled: true,
      connectedAt: Date.now(),
      userId: existingAuth.userId,
      username: existingAuth.username,
    };
    saveSettings(settings);
    return c.json({ success: true, exitCode: 0, authenticated: true, username: existingAuth.username });
  }

  const args = ["--yes", "expo", "login", "-u", username, "-p", password];
  if (otp) args.push("--otp", otp);

  try {
    const result = await spawnCli("npx", args, { timeoutMs: 90_000 });
    const authStatus = checkExpoAuth();

    if (authStatus.authenticated) {
      const settings = loadSettings();
      settings.integrations = settings.integrations ?? {};
      settings.integrations.expo = {
        enabled: true,
        connectedAt: Date.now(),
        userId: authStatus.userId,
        username: authStatus.username,
      };
      saveSettings(settings);
    }

    let error: string | undefined;
    if (!authStatus.authenticated) {
      if (result.output.includes("Invalid username") || result.output.includes("Invalid credentials")) {
        error = "Invalid username or password";
      } else if (result.output.includes("OTP") || result.output.includes("2FA")) {
        error = "2FA code required";
      } else {
        const rawOutput = result.output.trim();
        error = rawOutput
          ? `Login failed (exit ${result.exitCode}): ${rawOutput.substring(0, 300)}`
          : "Login failed. Please check your credentials.";
      }
    }

    return c.json({
      success: result.success && authStatus.authenticated,
      exitCode: result.exitCode,
      authenticated: authStatus.authenticated,
      username: authStatus.username,
      error,
      output: formatCliOutput(result.output),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, exitCode: -1, authenticated: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/provider/disconnect  { provider }
// ---------------------------------------------------------------------------
providerRouter.post("/disconnect", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = DisconnectSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { provider } = parsed.data;
  const settings = loadSettings();
  settings.integrations = settings.integrations ?? {};

  if (provider === "anthropic") {
    clearClaudeAuthState();
    settings.integrations.anthropic = { enabled: false, connectedAt: undefined, accountId: undefined };
  } else if (provider === "openai") {
    settings.integrations.openai = { ...settings.integrations.openai, enabled: false };
  } else if (provider === "expo") {
    settings.integrations.expo = { ...settings.integrations.expo, enabled: false };
  }

  saveSettings(settings);
  return c.json({ success: true, exitCode: 0 });
});

// ---------------------------------------------------------------------------
// POST /api/provider/save-tokens  { provider, tokens }
// ---------------------------------------------------------------------------
providerRouter.post("/save-tokens", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SaveTokensSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  const { provider, tokens } = parsed.data;
  const settings = loadSettings();
  settings.integrations = settings.integrations ?? {};

  try {
    if (provider === "anthropic") {
      saveClaudeTokens(tokens as OAuthTokens);
      settings.integrations.anthropic = { enabled: true, connectedAt: Date.now(), accountId: tokens.accountId };
      saveSettings(settings);
    } else if (provider === "openai") {
      saveCodexTokens(tokens as OAuthTokens);
      settings.integrations.openai = { enabled: true, connectedAt: Date.now(), accountId: tokens.accountId };
      saveSettings(settings);
    }

    return c.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/provider/save-git-bash-path  { path }  (Windows only)
// ---------------------------------------------------------------------------
providerRouter.post("/save-git-bash-path", async (c) => {
  if (process.platform !== "win32") {
    return c.json({ success: false, error: "Git Bash path is only needed on Windows" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = SaveGitBashPathSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten() }, 400);
  }

  if (!fs.existsSync(parsed.data.path)) {
    return c.json({ success: false, error: "Path does not exist" }, 400);
  }

  const settings = loadSettings();
  settings.cli = { ...settings.cli, gitBashPath: parsed.data.path };
  saveSettings(settings);

  return c.json({ success: true, path: parsed.data.path });
});

// ---------------------------------------------------------------------------
// GET /api/provider/settings
// ---------------------------------------------------------------------------
providerRouter.get("/settings", (c) => {
  return c.json(loadSettings());
});

providerRouter.post("/settings/credentials", async (c) => {
  const body = await c.req.json();
  const parsed = SaveProviderSettingsCredentialsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const settings = loadSettings();
  const nextCredentials = { ...(settings.credentials ?? {}) };

  for (const entry of parsed.data.entries) {
    const trimmed = entry.value.trim();
    if (trimmed) {
      nextCredentials[entry.key] = trimmed;
    } else {
      delete nextCredentials[entry.key];
    }
  }

  settings.credentials = Object.keys(nextCredentials).length > 0 ? nextCredentials : undefined;
  saveSettings(settings);
  return c.json(settings);
});
