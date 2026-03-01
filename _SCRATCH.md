# Task 2026-03-01_008_broken-screenshots

## Phase 2 Plan

### Files to modify
- `app/components/preview/Preview.tsx`
- `packages/desktop/src/conveyor-bridge.ts`
- `packages/sidecar/src/services/screenshot.ts`
- `packages/sidecar/src/services/screenshot-mcp.ts`

### Order of operations and why
1. Extend screenshot bridge request options (width/height/mobile/deviceScaleFactor) so UI can request explicit viewport emulation.
2. Update screenshot capture service to accept and apply viewport mode (`mobile` vs `web`) while preserving current defaults for web captures.
3. Update Preview screenshot action to pass mobile-frame dimensions for mobile app captures and web dimensions for web captures.
4. Update screenshot MCP tool to infer app type from runtime metadata (`cwd`) and choose correct viewport defaults when capturing without explicit dimensions.
5. Run targeted type-check/lint/tests for changed packages, then review and commit.

### Approach chosen (and alternatives rejected)
- Chosen: Add explicit, backward-compatible capture options and infer defaults from runtime app type for MCP.
- Rejected: Hardcoding a single mobile viewport globally in capture service, because it would regress web behavior and ignore explicit caller intent.

### Assumptions
1. `workbench` runtime metadata (`appType`) is reliably published often enough for MCP screenshot calls to infer current mode.
2. For mobile UI button captures, using the rendered phone-frame dimensions is preferred over a fixed handset size.
3. Existing callers that omit new options should continue using current web-like defaults.

### Risk areas
- Incorrect viewport options could alter screenshot output unexpectedly for existing web paths.
- App-type inference can be stale if runtime metadata has not been published yet; fallback must remain safe.

### Verification
- Typecheck/lint for touched code paths.
- Validate that mobile capture requests set `mobile: true` + mobile-sized viewport.
- Validate web capture requests remain non-mobile with web-sized viewport.
- Validate MCP tool chooses mobile defaults when runtime `appType` is `mobile` and web defaults otherwise.
