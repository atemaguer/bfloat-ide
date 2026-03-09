# Task 2026-03-09_002_firebase-integration

## Phase 2 Plan

### Files to modify
- `_SCRATCH.md`
- `app/types/integrations.ts`
- `app/types/project.ts`
- `app/lib/integrations/credentials.ts`
- `app/components/chat/Chat.tsx`
- `app/components/integrations/FirebaseIntegration.tsx`
- `app/components/chat/FirebaseSetupBanner.tsx`
- Obsidian task note `2026-03-09_002_firebase-integration`
- Obsidian board `BOARDS/IDE Tasks`

### Order of operations and why
1. Add Firebase to the shared integration registry and persisted project integration typing so UI and project state agree.
2. Align the Firebase secret contract with the chosen local-first scope so connection state and settings modal match what the IDE can actually verify.
3. Wire chat `Use` and keyword interception to the canonical `/add-firebase` flow, reusing the existing pending prompt pipeline instead of adding a new path.
4. Tighten Firebase UI copy where it still implies account/OAuth style connection instead of manual credential setup.
5. Run targeted verification, review the diff, commit, then update the task note and move the card from `In Progress` to `Review`.

### Approach chosen (and alternatives rejected)
- Chosen: implement the local-first/manual-credentials Firebase parity described in the task note, using `/add-firebase` as the only setup command.
- Rejected: backend provisioning, OAuth/bootstrap work, or adding command aliases, because none of that exists in the current IDE architecture and it would expand scope materially.

### Assumptions
1. The current branch state is authoritative; the older 2026-03-04 handoff note is historical only.
2. “Connected” for Firebase should mean full client config secrets are present for the current app type: `API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, and `APP_ID`.
3. The IDE should support Firebase on both web and mobile in this pass, but only through manual secret entry plus `/add-firebase`.

### Risk areas
- Type drift between `Project.integrations`, the integration registry, and chat menu filtering.
- Re-intercepting `/add-firebase` would block the setup flow and regress usability.
- Copy that overstates Firebase support could imply provisioning/OAuth behavior the IDE does not provide.

### Verification
- Run targeted checks against the touched files and any available lint/type tooling that covers them.
- Manually inspect the final diff to ensure only Firebase-local changes are included.
- Confirm the task note handoff records the exact scope, limitations, and verification steps.
