# Task 2026-03-01_011_restart-app-mcp

## Phase 2 Plan

### Files to modify
- `packages/desktop/src/conveyor-bridge.ts`

### Order of operations and why
1. Update restart tool-name detection in the agent stream bridge so successful MCP restart results consistently trigger `onRestartDevServer` listeners.
2. Keep existing supported names but broaden matching to include MCP-prefixed aliases (especially `mcp__workbench__restart_app`) and equivalent forms.
3. Run targeted verification (tests/typecheck if available) for the desktop package.
4. Self-review diff, then commit with required task ID format.

### Approach chosen (and alternatives rejected)
- Chosen: Normalize tool names and match by canonical suffix/pattern (`restart_app`) so naming variations do not break restart bridging.
- Rejected: Hardcoding one additional string only, because future naming variants would regress the same behavior.

### Assumptions
1. The app restart action from agent flow depends on `onRestartDevServer` listeners being fired from this bridge path.
2. A successful tool result with any valid workbench restart tool alias should trigger the same restart behavior as the manual UI restart button.

### Risk areas
- Overly broad matching could incorrectly fire restart listeners for unrelated tools if matching is too loose.

### Verification
- Typecheck desktop package (or broader typecheck if needed).
- Inspect diff to confirm matching logic is scoped to restart tool aliases only.

# Task 2026-03-01_016_more-restarts

## Phase 2 Plan

### Files to modify
- `app/components/workbench/Workbench.tsx`

### Order of operations and why
1. Audit existing Expo port-prompt auto-accept flow in `handleTerminalOutput` and identify why repeated restarts can stop auto-answering.
2. Add a per-run reset trigger for Expo prompt de-duplication so each new `expo start` invocation can auto-accept fallback prompts again.
3. Keep the rest of restart flow unchanged to minimize risk.
4. Run targeted lint on the touched file.
5. Self-review the diff, stage only task changes, and commit with task ID format.

### Approach chosen (and alternatives rejected)
- Chosen: reset prompt de-duplication when a new Expo startup sequence is detected in terminal output (`Starting project at ...`), which covers both UI-triggered and manually-entered restart commands.
- Rejected: removing de-duplication entirely, because that can spam `y` on subsequent output chunks from a single prompt and introduce new racey behavior.

### Assumptions
1. The observed third-run failure comes from stale `lastAcceptedExpoPortPromptRef` state surviving into a new startup attempt.
2. Expo consistently emits `Starting project at ...` once per new startup invocation, making it a safe boundary to reset prompt acceptance state.
→ Proceeding with these.

### Risk areas
- If Expo output format changes and no longer includes `Starting project at`, reset may not trigger for some runs.

### Verification
- `pnpm eslint app/components/workbench/Workbench.tsx`
- Diff review to ensure only restart-prompt robustness logic changed.

# Task 2026-03-01_018_not-found-bug

## Phase 2 Plan

### Files to modify
- `app/hooks/useLocalAgent.ts`

### Order of operations and why
1. Tighten session-loss detection so prompt failures that only return `"Not Found"` still trigger recovery.
2. Add a one-cycle "skip resume" guard for session recreation after a session-not-found failure, to avoid retrying with the same stale resume session ID.
3. Clear stale provider/resume refs during recovery and only re-enable resume after a fresh `init` arrives.
4. Run focused verification (typecheck/lint for touched file area if feasible) and inspect diff for scope.
5. Stage only task-related changes and commit with required task ID format.

### Approach chosen (and alternatives rejected)
- Chosen: local, hook-level resilience in `useLocalAgent.sendPrompt/createSession` to recover from stale IDs and remount races without changing sidecar API semantics.
- Rejected: sidecar route changes, because the failure is UI lifecycle/race-related and this task requests single-bug mitigation with minimal surface area.

### Assumptions
1. The quick-exit/re-enter failure path is driven by stale resumed session IDs and prompt 404 responses that currently surface as `"Not Found"`.
2. For `POST /api/agent/sessions/:id/message`, a 404 effectively means "session is gone" and should trigger local session recreation.
→ Proceeding with these.

### Risk areas
- Over-broad not-found matching could recreate sessions for non-session-related errors if message formats change.

### Verification
- `pnpm eslint app/hooks/useLocalAgent.ts` (or nearest available lint command).
- `git diff` review to confirm only session recovery/resume logic changed.

# Task 2026-03-02_007_stripe-connect-error

## Phase 2 Plan

### Files to modify
- `app/components/project/ProjectSettings.tsx`
- `app/components/chat/Chat.tsx`

### Order of operations and why
1. Add Stripe post-save auto-trigger logic in `ProjectSettings` (matching the existing RevenueCat pattern) so saving Stripe credentials immediately queues setup in chat.
2. Reuse required-key validation/wait behavior for Stripe to avoid race conditions where chat starts before secrets are readable.
3. Update `Chat` pending-prompt handling to treat Stripe prompts as a setup flow state (same resilience pattern as RevenueCat) so UI state is consistent during auto-triggered setup.
4. Run targeted verification on touched files.
5. Self-review diff, stage only this task's hunks, and commit with required task ID format.

### Approach chosen (and alternatives rejected)
- Chosen: extend the existing integration auto-setup pipeline (already used by RevenueCat) for Stripe, rather than inventing a parallel flow.
- Rejected: adding a one-off direct `submitRef` call from settings, because it duplicates chat dispatch logic and is less robust than centralized pending-prompt handling.

### ASSUMPTIONS
1. The primary regression is missing Stripe auto-prompt dispatch after secrets are saved, not a backend Stripe MCP token issue.
2. Waiting for required secrets to be readable before sending `/add-stripe` reduces timing-related failures similarly to RevenueCat.
3. The reported RSC payload warning is incidental to navigation and does not change the integration-trigger fix scope.
→ Proceeding with these.

### Risk areas
- Triggering Stripe setup too aggressively could fire prompts on non-setup secret edits if guards are wrong.
- Required key detection must respect app type (`web` vs `mobile`) to avoid false negatives.

### Verification
- `pnpm eslint app/components/project/ProjectSettings.tsx app/components/chat/Chat.tsx`
- `git diff` review to ensure only Stripe integration prompt flow changes are included.

# Task 2026-03-02_007_stripe-connect-error (dev completion follow-up)

## Phase 2 Plan

### Files to modify
- `app/lib/integrations/credentials.ts`
- `app/components/project/ProjectSettings.tsx`

### Order of operations and why
1. Expand Stripe credential spec to require both publishable key and `STRIPE_SECRET_KEY` so Stripe "connected" state in dev reflects what setup actually needs.
2. Update single-secret save flow in `ProjectSettings` to trigger Stripe setup when either required Stripe key is saved and the full required Stripe key set is now present.
3. Keep Stripe webhook/account-ID (prod-related) out of required dev connect gating for now.
4. Run focused lint/check on touched files.
5. Self-review and commit with task ID format.

### Approach chosen (and alternatives rejected)
- Chosen: use existing `getRequiredSecretKeys/hasRequiredSecrets` pipeline so connect modal, status detection, and setup trigger behavior stay consistent.
- Rejected: adding Stripe-specific ad-hoc checks in chat/status code, because that duplicates requirement logic and risks drift.

### ASSUMPTIONS
1. For current dev flow (without OAuth), "fully connected" means both publishable key and `STRIPE_SECRET_KEY` are present before auto-running `/add-stripe`.
2. `STRIPE_WEBHOOK_SECRET` is generated/handled during setup flow and should not block initial Stripe connect in this task.
3. Prod account-ID requirements (`STRIPE_ACCOUNT_ID` / `NEXT_PUBLIC_STRIPE_ACCOUNT_ID`) remain out of scope for this follow-up.
→ Proceeding with these.

### Risk areas
- Tightening Stripe required keys can change "connected" badges where projects previously had only publishable key.

### Verification
- `pnpm eslint app/lib/integrations/credentials.ts app/components/project/ProjectSettings.tsx`
- `git diff` review for scope.

# Task 2026-03-02_007_stripe-connect-error (Stripe MCP auto wiring)

## Phase 2 Plan

### Files to modify
- `packages/sidecar/src/services/agent-session.ts`
- `packages/sidecar/src/services/agent-session.test.ts`

### Order of operations and why
1. Add Stripe MCP URL constant next to existing RevenueCat MCP constant for consistency.
2. Extend `buildAutoMcpServers()` to auto-configure Stripe MCP when `STRIPE_SECRET_KEY` is present in merged env (cwd/project/session env).
3. Keep merge precedence unchanged so explicit caller `mcpServers` overrides auto-generated Stripe config.
4. Add targeted unit tests for Stripe auto MCP injection and override behavior, plus parity checks with RevenueCat.
5. Run focused sidecar tests and self-review diff.

### Approach chosen (and alternatives rejected)
- Chosen: mirror RevenueCat auto MCP pattern in sidecar session creation for Stripe.
- Rejected: wiring Stripe only in frontend/workbench because MCP server injection happens in sidecar session options.

### ASSUMPTIONS
1. Dev no-OAuth Stripe MCP should authenticate via `Authorization: Bearer ${STRIPE_SECRET_KEY}`.
2. Stripe MCP base URL is `https://mcp.stripe.com` for sidecar HTTP server config.
3. Prod Stripe account-ID behavior is out of scope for this change.
→ Proceeding with these.

### Risk areas
- Incorrect Stripe MCP URL/path would prevent tool calls.
- Test fragility if session registry state leaks between test cases.

### Verification
- `bun test packages/sidecar/src/services/agent-session.test.ts`
- `git diff` review for scope and secret-safe logging.

# Task 2026-03-02_011_web-navigation-problem

## Phase 2 Plan

### Files to modify
- `packages/sidecar/src/routes/preview-proxy.ts`

### Order of operations and why
1. Replace the unconditional injected `history.replaceState('/', ...)` with path-preserving logic derived from the proxied `target` URL query parameter.
2. Keep error-capture behavior unchanged (console/error/unhandled-rejection postMessage) so existing preview error reporting still works.
3. Ensure fallback behavior leaves non-targeted requests untouched and does not mutate route when no `target` is present.
4. Run focused verification on the sidecar package to catch syntax/type regressions.
5. Self-review diff, stage only this task, and commit with the required task ID format.

### Approach chosen (and alternatives rejected)
- Chosen: preserve the real upstream path in injected script (`/pricing`, etc.) instead of forcing `/`, so Next.js router state stays consistent in IDE preview.
- Rejected: removing the URL normalization entirely, because Expo Router compatibility from prior tasks may rely on controlled history updates.

### ASSUMPTIONS
1. The persistent `/` route display and intermittent `/pricing/pricing` behavior in IDE preview are caused by the injected history rewrite, not by the app project's own router code.
2. Preserving the proxied target pathname is compatible with both Next.js and existing Expo preview usage.
→ Proceeding with these.

### Risk areas
- If some Expo flows depended specifically on forcing `/`, they may behave differently and need a follow-up conditional path strategy.

### Verification
- `pnpm --filter bfloat-sidecar build`
- `git diff` review for scope and behavior-only changes.

# Task 2026-03-02_011_web-navigation-problem (follow-up)

## Phase 2 Plan

# Task 2026-03-02_011_web-navigation-problem (checkout POST body follow-up)

## Phase 2 Plan

### Files to modify
- `packages/sidecar/src/routes/preview-proxy.ts`
- `packages/sidecar/src/routes/preview-proxy.test.ts`

### Order of operations and why
1. Add a shared request-forwarding helper in preview proxy so both the mounted proxy route and fallback proxy route use identical forwarding semantics.
2. Forward request bodies for non-`GET`/`HEAD` methods and include required request headers (`Content-Type`, `Content-Length`) so JSON API posts survive IDE proxying.
3. Keep existing target hardening and auth-bypass boundaries unchanged.
4. Add regression tests that assert body forwarding behavior by method.
5. Run sidecar tests and review diff scope.

### Approach chosen (and alternatives rejected)
- Chosen: centralize proxy `fetch` init construction via a small helper to prevent drift between `handlePreviewProxyRequest` and `previewProxyFallback`.
- Rejected: patch only one callsite, because `/api/*` checkout flows can route through fallback and would still fail.

### ASSUMPTIONS
1. The checkout parse failure is caused by dropped POST body in sidecar proxy (browser direct path works, IDE preview path fails).
2. Forwarding body only for non-`GET`/`HEAD` methods is the safest default and preserves HTTP semantics.
3. No changes are needed in generated app checkout API route for this task.
→ Proceeding with these.

### Risk areas
- Request body streams are single-use; helper must only attach stream once per forwarded request.
- Over-forwarding headers could leak auth/host details; keep explicit minimal header allowlist.

### Verification
- `pnpm --filter @bfloat/sidecar test`
- Manual IDE preview checkout smoke test (`POST /api/checkout` should parse JSON and return success/expected Stripe response).

# Task 2026-03-02_011_web-navigation-problem (checkout redirect follow-up)

## Phase 2 Plan

### Files to modify
- `app/components/preview/Preview.tsx`

### Order of operations and why
1. Add a secure preview `postMessage` handler for external URL open requests from the sandboxed iframe.
2. Open external links through the existing desktop bridge (`window.conveyor.window.webOpenUrl`) with browser fallback.
3. Keep origin/source checks strict so only the active preview iframe can trigger the behavior.
4. Run targeted lint for touched file.

### Approach chosen (and alternatives rejected)
- Chosen: explicit `postMessage` bridge for external URLs because Stripe checkout pages cannot be embedded in iframes reliably.
- Rejected: forcing top-navigation from iframe, because that risks navigating the IDE shell itself away from the app UI.

### ASSUMPTIONS
1. Checkout session creation is successful and the remaining failure is iframe-hosted redirect behavior.
2. Opening checkout in the system browser is the safest UX in desktop IDE context.
→ Proceeding with these.

### Risk areas
- Message handling can be abused if origin/source checks are weak (kept strict in implementation).

### Verification
- `pnpm eslint app/components/preview/Preview.tsx`
- Manual Stripe checkout trigger in IDE preview should open external checkout URL.

### Files to modify
- `packages/sidecar/src/routes/preview-proxy.ts`
- `app/components/preview/Preview.tsx`
- `packages/sidecar/src/server.ts`

### Order of operations and why
1. Adjust preview-proxy upstream URL resolution so mounted-root requests (`/preview-proxy` or `/preview-proxy/`) preserve target pathname/query from `?target=...` instead of always fetching `/`.
2. Extend injected preview script to emit route-change postMessage events (`bfloat-preview-route`) on load/history changes so host UI can track in-app navigation.
3. Update Tauri preview message handling in `Preview.tsx` to consume route-change events and update URL bar display without forcing iframe reloads.
4. Add a pre-auth `/api/*` proxy bypass in sidecar server for unknown app API routes while preview proxy is active, so proxied web apps can call `/api/*` endpoints without sidecar auth interception.
5. Run targeted lint/build checks for touched files.
6. Self-review diff and commit.

### Approach chosen (and alternatives rejected)
- Chosen: keep existing proxy architecture and add route-preserving + route-observability behavior.
- Rejected: forcing iframe remount or rewriting app links, because that is more invasive and risks regressions in SPA navigation state.

### ASSUMPTIONS
1. The generated app navigation bug is IDE preview/proxy behavior, not app route code (`href="/pricing"` is already correct).
2. Updating URL display state should not mutate `currentUrl` for Tauri web preview, to avoid unnecessary proxy reload loops.
3. Preserving target path for proxy-root requests closes a mismatch where upstream root HTML could be served while URL is normalized to nested paths.
→ Proceeding with these.

### Risk areas
- Route postMessage handling must remain backward-compatible with existing preview error messages.
- Path/query merge logic must not break asset/subrequest proxying.
- API bypass logic must avoid hijacking sidecar-owned `/api/*` routes.

### Verification
- `pnpm eslint app/components/preview/Preview.tsx packages/sidecar/src/routes/preview-proxy.ts`
- `pnpm --filter bfloat-sidecar build`
- `git diff` review for scoped changes.

# Task 2026-03-02_011_web-navigation-problem (hardening pass)

## Phase 2 Plan

### Files to modify
- `packages/sidecar/src/routes/preview-proxy.ts`
- `packages/sidecar/src/routes/preview-proxy.test.ts`
- `packages/sidecar/src/server.ts`
- `app/components/preview/Preview.tsx`

### Order of operations and why
1. Centralize and harden preview target validation (localhost + protocol) in preview-proxy route helpers so HTTP and WS target handling use the same guard.
2. Add unit tests for target parsing and upstream URL construction to prevent regressions in route normalization and query propagation.
3. Apply shared preview target validation to `/preview-proxy/ws` upgrade path and reject invalid remote/non-http targets early.
4. Harden iframe message handling in preview UI by validating source window and origin, and scope route-sync handling to web preview only.
5. Run focused sidecar route tests plus sidecar build verification.

### ASSUMPTIONS
1. Route/error events should only be accepted from the active preview iframe and sidecar origin.
2. Preview proxy target URL should remain limited to localhost over http/https for both HTTP and WS routing.
→ Proceeding with these.

### Verification
- `bun test packages/sidecar/src/routes/preview-proxy.test.ts`
- `pnpm --filter ./packages/sidecar build`
- `git diff` review for hardening scope.
