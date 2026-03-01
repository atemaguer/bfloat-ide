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
