## Task 2026-03-09_000_local-storage-usage

PLAN:
- Update shared generated-agent guidance in `packages/sidecar/src/services/agent-instructions.ts` so the AsyncStorage replacement text explicitly describes `expo-sqlite/localStorage/install` as an Expo shim, not browser `window.localStorage`.
- Mirror that clarification in `lib/launch/system-prompt.ts` so session-time instructions match generated `AGENTS.md`.
- Tighten Expo/mobile skill guidance in `resources/skills/add-revenuecat/SKILL.md`, `resources/skills/convex/auth/SKILL.md`, and `resources/skills/upgrading-expo/SKILL.md` so agents do not suggest browser storage APIs or speculative `crossDomainClient()` removal.
- Keep this task instruction-only; do not change runtime templates unless a reproduced bug requires it.
- Verify by searching the touched sources for the new guardrail text and running the smallest relevant lint/check command covering the touched TypeScript files.

ASSUMPTIONS:
1. The applicable repo instructions are `/Users/v1b3m/Dev/bfloat/bfloat-ide/AGENTS.md` plus companion docs in `commander/`.
2. Existing Convex Expo guidance and template remain the current source of truth that `crossDomainClient()` is required, so this task should prevent contradictory troubleshooting rather than change runtime code.
3. `resources/skills/upgrading-expo/SKILL.md` is in scope because its deprecated-package wording can reinforce the same `localStorage` confusion.
→ Proceeding with these.

RISKS:
- Wording changes could accidentally discourage the valid Expo shim path if they overstate the prohibition.
- Prompt/skill drift would leave the agent with conflicting instructions, so all touched surfaces must stay aligned.

VERIFICATION:
- `rg -n "window\\.localStorage|sessionStorage|crossDomainClient\\(\\)|expo-sqlite/localStorage/install" ...`
- Focused lint/check covering `packages/sidecar/src/services/agent-instructions.ts` and `lib/launch/system-prompt.ts`
- `git diff` review for instruction-only scope

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

## Follow-up adjustment
- Fixed message-origin validation in `Preview.tsx` to compare `event.origin` against the active iframe `src` origin (sidecar), not `window.location.origin` (IDE shell).
- Reason: preview iframe is intentionally cross-origin (`http://127.0.0.1:<sidecar-port>`), so prior check dropped all legitimate iframe messages including external checkout open requests.

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

# Task 2026-03-03_007_blocked-package-installs

## Phase 2 Plan

### Files to modify
- `packages/sidecar/src/services/agent-session.ts`
- `packages/sidecar/src/services/agent-session.test.ts`

### Order of operations and why
1. Update deprecated-package block handling in `runStream` so it does not emit a session-level fatal `error` frame.
2. Emit a synthetic failed tool result (for the blocked Bash tool call) and end the turn cleanly with `done` + `stream_end`.
3. Keep scaffold and dev-server guards unchanged (they are unrelated to this task scope).
4. Update tests to assert non-fatal behavior for deprecated package blocks.
5. Run targeted sidecar tests for `agent-session` and self-review diff.

### Approach chosen (and alternatives rejected)
- Chosen: treat deprecated package blocking as a tool-level failure, not a session failure.
- Rejected: removing the block entirely, which would allow banned packages to install.
- Rejected: broad refactor of guard architecture, which is outside this task scope.

### ASSUMPTIONS
1. Ending the current turn as completed/interrupted (instead of error) satisfies "not a death sentence" for agent sessions.
2. A synthetic `tool_result` with `isError: true` will let the chat UI resolve the running tool state instead of appearing abruptly terminated.
3. It is acceptable for this blocked command to end the current turn while still allowing the next user turn.
→ Proceeding with these.

### Risk areas
- If consumers rely specifically on `error` frames for blocked installs, behavior will change.
- If provider emits additional events after the synthetic blocked result path, early return remains intentional to preserve blocking.

### Verification
- `bun test packages/sidecar/src/services/agent-session.test.ts`
- `git diff` review for scoped changes only.

## TASK PLAN: 2026-03-03_009_convex-auth

ASSUMPTIONS:
1. The intended Convex + Auth flow should auto-trigger `/convex-auth` only after Convex bootstrap artifacts exist.
2. `projectFiles.onFileChange` is currently not reliable (bridge stub), so detection cannot depend only on `workbenchStore.files` being live-updated.
3. A bounded polling fallback (refreshing project tree for a short window) is acceptable to unblock this flow without implementing full realtime subscriptions in this task.
→ Proceeding with these.

Files to modify:
- `app/lib/integrations/convex.ts`
- `app/components/chat/Chat.tsx`

Order of operations:
1. Extend Convex bootstrap detection utilities so bootstrap can be detected from file paths/tree, not only loaded file contents.
2. Update chat Convex state/flow to use the stronger bootstrap signal (files + file tree).
3. Add a bounded fallback loop for pending Convex+Auth: when setup stream ends, force tree refresh checks until bootstrap is detected, then queue `/convex-auth`.
4. Verify formatting/type-safety with lint and focused checks.

Approach chosen:
- Keep existing UX/state machine and add robust detection + refresh fallback in-place.

Alternatives rejected:
- Implementing full `projectFiles.onFileChange` SSE subscriptions in this task (larger scope and sidecar/bridge protocol work).
- Triggering `/convex-auth` unconditionally after setup (could run auth before Convex is actually wired).

Risk areas:
- Duplicate auto-trigger of `/convex-auth`.
- Polling loop leaking after unmount or state change.
- Regressing existing `convex_only`/`auth_only` flows.

Verification:
- Run ESLint on changed files.
- Validate TypeScript compile (`tsc --noEmit`) for impacted code.
- Inspect diff to ensure only scoped changes.

## Task: 2026-03-03_002_unauthenticated-requests (follow-up: auth modal timeout UX)

ASSUMPTIONS:
1. `provider:auth-output` events may be absent in current sidecar flow, so modal progress cannot rely on SSE.
2. If auth flow shows no progress quickly, user should be directed to terminal CLI login instead of waiting in modal.
3. CLI fallback commands are `claude /login` (or `claude setup-token`) for Anthropic and `codex login` for OpenAI.
→ Proceeding with these.

PLAN:
1. Modify `app/components/integrations/ProviderAuthModal.tsx` to track whether auth progress output was received.
2. Add a short no-progress watchdog timer (15s) that fails fast with actionable CLI instructions when no output arrives.
3. Keep existing success path intact so immediate successful auth still completes normally.
4. Preserve existing overall timeout as safety net, but update timeout errors to include CLI fallback instructions.
5. Verify with TypeScript-aware sanity check by inspecting diff and ensuring no new imports/types are missing.

RISKS:
- False fail-fast if auth is valid but emits no progress output before completion.
- Different provider CLI versions may prefer `setup-token` vs `/login`; include both where relevant.

VERIFICATION:
- Open modal and simulate no output path: expect CLI instruction error within ~15s.
- Confirm success result still sets `status=success` and enables Done.

## Follow-up: frontend log bridge overflow from Chat.tsx

ASSUMPTIONS:
1. Repeated `console.log` calls in render/effects are the primary cause of `[frontend-log-bridge] queue overflow`.
2. Auth invalidation behavior should remain unchanged; only logging frequency should be reduced.
3. Keeping one occasional auth-warning log is useful for diagnosis, but repeated identical lines are noise.
→ Proceeding with targeted log reduction and auth log dedupe.

PLAN:
1. Remove render-time and high-frequency effect logs in `app/components/chat/Chat.tsx`.
2. Add cooldown-based dedupe around the Claude auth detection log in message stream handling.
3. Keep functional behavior unchanged (auth invalidation, session/pending prompt logic).
4. Run eslint for modified file.

RISKS:
- Reduced logs may hide debug context during development.

VERIFICATION:
- Confirm file compiles/lints.
- Reproduce auth-expired flow and verify no repeated log flood.

## Follow-up: allow updating existing secret keys from Add Secret modal

ASSUMPTIONS:
1. Secret writes are upserts in sidecar (`POST /api/secrets/:projectId`), so duplicate key saves are safe and expected.
2. Blocking duplicates in `SecretModal` is now incorrect UX after env sync merge continuation work.
3. Users may intentionally type an existing key while using Add Secret and expect overwrite.
→ Proceeding with frontend validation/UX alignment only.

PLAN:
1. Update `app/components/settings/sections/SecretModal.tsx` duplicate-key validation to allow existing keys.
2. Add UI hint when typed key already exists and will be updated.
3. Adjust title/description/button text in add mode to communicate add-or-update behavior.
4. Run eslint on modified file.

RISKS:
- Users might overwrite a key unintentionally; mitigate with clear inline hint.

VERIFICATION:
- In Add Secret modal, enter an existing key and new value; save should succeed and update key.
- Existing edit flow should remain unchanged.

# UI Parity Merge Review (2026-03-06)

## Scope reviewed
- Merge commit: `23d1133` (`Merge pull request #14 from atemaguer/task/2026-03-04_003_ui-visual-parity`)
- Files changed:
  - `app/components/window/Titlebar.tsx`
  - `app/components/window/titlebar.css`
  - `app/components/ai-elements/web-preview.tsx`
  - `app/components/ui/tooltip.tsx`
  - `app/components/payments/PaymentsOverview.tsx`
  - `app/components/workbench/Workbench.tsx`

## What changed
1. Titlebar/workbench visual alignment:
   - Added divider-aligned tab rail with dynamic positioning (`ResizeObserver` + layout measurements).
   - Split tabs into primary strip + separate publish button section.
   - Removed copy-project-id action from project titlebar actions.
2. Preview toolbar parity:
   - Reduced toolbar/nav height and icon button sizing to match chat session tab proportions.
3. Tooltip parity:
   - Restyled tooltip visuals globally to match workbench styling (larger rounded tooltip, dark/light fill updates, increased side offset).
4. Payments parity + behavior:
   - Reworked Payments tab into a connect/connected hero view.
   - Wired connected-state to detected secrets presence via `detectIntegrationSecretsPresence` in `Workbench`.

## Findings
1. High: `node` app type can show inconsistent payments integration UX/state.
   - `Workbench` computes `isConnected` using normalized app type (`node` -> `web`).
   - `PaymentsOverview` still infers web/mobile from raw `project.appType` and treats `node` as mobile.
   - Impact: for `node` projects, UI text/button can point to RevenueCat while connected-state is evaluated from Stripe secrets.
2. Medium: tab ordering mismatch between titlebar visuals and content transition logic.
   - Titlebar tab order now starts with Preview then Editor.
   - Workbench slide-order array still uses Editor then Preview.
   - Impact: directional slide animation between Preview/Editor can feel opposite to visual tab order.

## Review limits
- Static code review only; no runtime validation or test execution performed in this pass.

# Task: Git-connected Sync Button + Git Settings Section (2026-03-06)

ASSUMPTIONS:
1. In this IDE, “git connected” should be represented by a non-empty `project.sourceUrl` (same signal used in bfloat-workbench titlebar).
2. For this task, connecting Git means saving a user-provided repository URL to project metadata (`sourceUrl`), not provisioning managed GitHub remotes.
3. Existing push behavior (sync button -> `projectStore.commitAndPush`) remains unchanged and out-of-scope for deeper git remote initialization work.
→ Proceeding with these.

## Phase 2 Plan

### Files to modify
- `app/components/window/Titlebar.tsx`
- `app/components/project/ProjectSettings.tsx`

### Order of operations and why
1. Add `isGitConnected` derivation in titlebar from current project metadata and conditionally render sync button only when connected.
2. Add Git section UI in Project Settings with repository URL input, status text, and connect/disconnect actions.
3. Persist Git URL changes via `localProjectsStore.update(project.id, { sourceUrl })` and update live workbench project metadata so titlebar reacts immediately.
4. Reuse existing settings card styling and button components to minimize visual risk.
5. Verify via typecheck/lint on touched files and inspect diff for scope.

### Approach chosen (and alternatives rejected)
- Chosen: metadata-driven connect/disconnect (URL stored as `sourceUrl`) matching current local-first architecture.
- Rejected: implementing new sidecar git-remote mutation endpoints in this task; larger backend scope not required for requested UI behavior.

### Risk areas
- URL validation too strict could reject valid git URLs (e.g., SSH format); we should accept common HTTPS and SSH-style git URLs.
- If workbench current project metadata is not updated live, titlebar sync icon visibility might lag until reload.

### Verification
- `pnpm eslint app/components/window/Titlebar.tsx app/components/project/ProjectSettings.tsx`
- Manual diff review for only requested behavior changes.

# Task: iOS deploy owner/account regression follow-up (2026-03-06)

ASSUMPTIONS:
1. Sidecar filesystem routes are the source of truth, and desktop `filesystem.ts` should normalize those responses into the existing `success`-based contract used by app code.
2. The `eas whoami` parser should tolerate terminal noise and partial output, and failing to parse accounts should not break deploy flow.
3. The `.gitconfig` lock warning in logs is non-fatal noise from concurrent git access and should be ignored by account parsing.
-> Proceeding with these.

PLAN:
1. Patch `packages/desktop/src/api/filesystem.ts` to map sidecar response shapes (`ok`, raw content payloads, body-based delete) to app-facing `success` contracts.
2. Harden `app/utils/eas-accounts.ts` parsing by stripping shell prompt/echo noise and by accepting owner-only fallback when `Accounts:` is absent.
3. Keep existing runtime logs but remove obvious false-negative branches causing `Could not read app.json`.
4. Run focused lint/typecheck on touched files.
5. Self-review diff and report exact behavior changes.

RISKS:
- Over-normalizing FS responses could hide genuine sidecar failures if error mapping is too permissive.
- EAS output heuristics could misclassify malformed output as valid.

VERIFICATION:
- `pnpm eslint packages/desktop/src/api/filesystem.ts app/utils/eas-accounts.ts`
- Targeted typecheck if needed.

## Follow-up (2026-03-06): executeCommand capture bug
ASSUMPTIONS:
1. `terminal.executeCommand` in the desktop bridge can drop full output when command echo/output/marker arrive in one first chunk.
2. Fixing output capture in this bridge is the right layer and will unblock `fetchEasAccounts` parsing.
-> Proceeding.

PLAN:
1. Inspect current `executeCommand` websocket message handling in `packages/desktop/src/conveyor-bridge.ts`.
2. Remove brittle first-chunk discard logic and correctly handle both raw-string and `{type:"data"}` message shapes.
3. Keep marker-based exit parsing intact.
4. Run eslint/typecheck for touched files.

## Follow-up (2026-03-06): deploy modal stuck at prepare due missing SSE updates
ASSUMPTIONS:
1. Interactive build is starting successfully (buildId is returned) but SSE delivery to renderer is unreliable in this path.
2. Sidecar already has authoritative per-build state (output/progress/result), so polling that state is a safe fallback.
-> Proceeding.

PLAN:
1. Add sidecar deploy status endpoint to return build snapshot by buildId.
2. Add deploy bridge method to fetch that status.
3. Add polling fallback in `IOSDeployModals` interactive flow that updates logs/progress and completes/fails modal from polled status.
4. Keep existing SSE listeners; polling acts as resilience layer.

## Follow-up (2026-03-06): align interactive iOS deploy with bfloat-workbench PTY flow
ASSUMPTIONS:
1. The recurring `Input is required, but stdin is not readable` failure is caused by running EAS interactive prompts through `Bun.spawn` pipes instead of a PTY.
2. We can safely reuse sidecar `bun-pty` support (already used by terminal routes) inside deploy routes.
3. For interactive iOS deploy, `eas init` must run with `--non-interactive --force` and explicit project id when known to avoid config prompts before Apple login.
-> Proceeding.

PLAN:
1. Compare workbench deploy handler (`deploy-handler.ts`, `prompt-classifier.ts`, `pty-state-machine.ts`) with sidecar deploy route and port only the essential prompt handling behaviors.
2. Refactor `packages/sidecar/src/routes/deploy.ts` interactive execution to use `bun-pty` first (fallback to `Bun.spawn` only if PTY unavailable).
3. Add prompt classification/auto-response parity for interactive prompts:
   - auto-confirm yes/no and menu prompts,
   - emit `interactive_auth` events for 2FA,
   - preserve manual `submit-input` path.
4. Make `eas init` deterministic by passing `--id` when `extra.easProjectId` is provided to bypass "Configure this project?" interactive prompt.
5. Verify with sidecar typecheck/test target and review logs for prompt progression and absence of stdin-readability errors.

RISKS:
- PTY output parsing can be noisier than stream readers and may require stricter ANSI cleanup.
- Over-aggressive auto-confirmation could answer non-routine prompts incorrectly if regexes are too broad.

VERIFICATION:
- `bun test` in `packages/sidecar` (or targeted compile check if tests are not available).
- Manual log validation: interactive prompt events and PTY writes occur, and build no longer fails at unreadable stdin prompt.

## Follow-up (2026-03-07): deploy log readability cleanup + offline replay validation
ASSUMPTIONS:
1. The worst readability issues come from repeated spinner/progress frames and chunk-boundary glueing, not from missing transport data.
2. We can safely normalize log presentation in the frontend store without changing deploy behavior.
3. Replaying `pg/deploy.logs` line-by-line through the same cleaner is sufficient to validate formatting improvements before another real deploy.
-> Proceeding.

PLAN:
1. Expand log normalization to collapse repeated lines, suppress known noisy warnings, and keep chunk boundaries stable.
2. Add overwrite-style handling for interactive prompt typing/progress patterns so partial prompt echoes do not flood output.
3. Keep all critical informational/error lines while reducing repetitive spinner noise.
4. Run lint on touched files.
5. Replay `pg/deploy.logs` with a local script that feeds the cleaner line-by-line and report before/after stats + sample output.

## 2026-03-07_git-connect-interactive-auth

ASSUMPTIONS:
1. The Git connect flow should only persist `sourceUrl` after successful remote validation.
2. Existing iOS interactive auth UX (prompt classification + guided inputs + fallback input) is the desired pattern to mirror for Git auth prompts.
3. We should not persist entered Git credentials/passphrases/OTP anywhere in app storage.
→ Proceeding with these.

PLAN:
1. Extend sidecar `project-files` routes with an interactive `git-connect` session lifecycle:
   - Start connect (init repo if missing, add/set `origin`, validate via `git ls-remote origin`).
   - Stream logs/auth prompt events over SSE.
   - Accept prompt input + cancellation.
   - Add prompt detection for HTTPS username/password, SSH passphrase, OTP, yes/no, and unknown fallback.
2. Update desktop bridge `projectFilesBridge` with typed connect-session methods and event streaming callbacks similar to deploy flow.
3. Update `ProjectSettings` Git card to run connect flow instead of metadata-only update:
   - Keep URL validation.
   - Show guided prompt UI for known prompt types, dedicated OTP input, and manual fallback input.
   - Persist `sourceUrl` only when connect succeeds.
4. Add/adjust TypeScript schema/types as needed for new API shapes.
5. Verify with targeted tests for sidecar route behavior and run relevant test command(s) for project-files route tests.

RISKS:
- Prompt regexes can miss real-world git prompts; unknown prompts must reliably fall back to manual input.
- Sidecar stream lifecycle cleanup (listener leaks / stale sessions) needs careful teardown paths.
- UI state race conditions if user retries connect rapidly.

VERIFICATION:
- Unit tests for sidecar git connect prompt detection and connect success/failure paths.
- Typecheck/build for affected packages.
- Manual sanity flow: connect URL with no auth prompt + failure path from invalid auth.

# Task 2026-03-09_001_diagnostics-banner

## Phase 2 Plan

### Files to modify
- `app/components/project/ProjectSettings.tsx`

### Order of operations and why
1. Remove the inline text color overrides from the Git diagnostics banner because they are defeating the existing dark-theme utilities.
2. Put the light/dark text classes on the banner container and heading so every diagnostics row, including optional SSH/probe rows, inherits readable colors consistently.
3. Keep the change scoped to this banner only and leave diagnostics behavior/copy untouched.
4. Run focused lint on the touched file and review the diff for scope.

### Approach chosen (and alternatives rejected)
- Chosen: the narrow banner fix recommended in the task note, using theme-aware utility classes instead of inline colors.
- Rejected: broader warning-banner normalization, because it is not required to resolve this defect and would expand scope.
- Rejected: theme-conditional inline colors, because that preserves the pattern that caused the regression.

### Assumptions
1. Manual verification is sufficient for this UI bug in the absence of existing component coverage.
2. Light-mode styling only needs to remain visually consistent/readable; exact pixel-for-pixel parity with the previous inline hex values is not required.
3. The list rows can inherit banner text color safely without per-item overrides.
→ Proceeding with these.

### Risk areas
- Optional nested rows could inherit the wrong color if a parent class is missing.
- Removing the inline colors could unintentionally soften light-mode contrast if the replacement utilities are too weak.

### Verification
- `pnpm exec eslint app/components/project/ProjectSettings.tsx`
- `git diff -- app/components/project/ProjectSettings.tsx _SCRATCH.md`
