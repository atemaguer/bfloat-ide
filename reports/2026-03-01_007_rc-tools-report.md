# 2026-03-01_007_rc-tools — RevenueCat MCP Auth Feasibility Report

## Question
Can `bfloat-ide` support RevenueCat MCP tools **without OAuth** while replicating the same functionality as `bfloat-workbench`?

## Short answer
No, not with feature parity.

`bfloat-ide` can call RevenueCat MCP using a bearer key from env in some cases, but that does not match workbench behavior, which is built on user OAuth tokens, token refresh, account linkage, and scoped project provisioning.

## Evidence: Current IDE behavior

### 1. Primary RevenueCat token path is stubbed
- `bfloat-ide/lib/conveyor/handlers/revenuecat-handler.ts:8` returns hardcoded failure (`"RevenueCat token fetch is not configured in this build"`).
- `bfloat-ide/lib/mcp/servers/revenuecat.ts:21` depends on `fetchRevenueCatToken()` and returns `null` MCP config when token fetch fails.

### 2. Sidecar fallback injects raw env key as MCP bearer token
- `bfloat-ide/packages/sidecar/src/services/agent-session.ts:911-914` reads `REVENUECAT_API_KEY` or `EXPO_PUBLIC_REVENUECAT_API_KEY`.
- `bfloat-ide/packages/sidecar/src/services/agent-session.ts:916-923` injects that key directly into MCP `Authorization: Bearer ...`.

Implication: IDE currently supports a non-OAuth fallback path, but only by trusting a preexisting key in project/session env.

## Evidence: Workbench behavior (reference implementation)

### 1. Desktop requests token from backend
- `bfloat-workbench/apps/desktop/lib/conveyor/handlers/revenuecat-handler.ts:41-47` calls backend `/api/revenuecat/token` with user auth bearer.
- `bfloat-workbench/apps/desktop/lib/mcp/servers/revenuecat.ts:21-33` uses returned OAuth access token for MCP auth.

### 2. Backend owns full OAuth lifecycle
- `bfloat-workbench/apps/web/app/lib/revenuecat-oauth.server.ts:35-65` starts OAuth + PKCE.
- `.../revenuecat-oauth.server.ts:70-129` exchanges auth code for tokens.
- `.../revenuecat-oauth.server.ts:136-186` refreshes token.
- `.../revenuecat-oauth.server.ts:269-307` returns valid token with refresh buffer logic.

### 3. Backend setup flow depends on OAuth scopes
- `bfloat-workbench/apps/web/app/routes/api.projects.$id.setup-revenuecat.ts:47-52` requires valid OAuth access token.
- `...setup-revenuecat.ts:75-83` enforces `project_configuration:projects:read_write`.
- `...setup-revenuecat.ts:86-195` creates/links RC project + apps, fetches public API keys, persists project linkage and env values.

## Parity analysis

To match workbench functionality, IDE would need all of the following:
- Per-user RevenueCat connection state.
- OAuth token storage + refresh handling.
- Scoped authorization checks.
- Project provisioning/linking APIs (create RC project/apps, fetch keys, persist metadata).

The current non-OAuth env-key approach in IDE does not provide these capabilities.

## Can non-OAuth still work at all?
Yes, partially.

If a valid bearer credential with sufficient RevenueCat permissions is manually supplied in env, MCP calls may succeed. However:
- It is not equivalent to workbench’s user OAuth model.
- It lacks refresh/account lifecycle.
- It lacks automatic project provisioning/linking workflow.
- It likely conflates key types (`EXPO_PUBLIC_REVENUECAT_API_KEY` is usually app SDK key, not account OAuth token).

## Final verdict
- **Without OAuth:** feasible for limited/manual MCP usage only.
- **Without OAuth + full workbench parity:** **not feasible**.

## Practical options
1. **Parity path (recommended for true equivalence):** implement backend token endpoint + OAuth lifecycle in IDE stack and wire `fetchRevenueCatToken()` to it (workbench model).
2. **Non-parity path (keep current):** keep env-key fallback, document it as best-effort/manual, and do not claim workbench-equivalent RevenueCat integration.
