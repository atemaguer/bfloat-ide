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
