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
