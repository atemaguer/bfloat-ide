# Task 2026-03-01_004_broken-images

## Phase 2 Plan

### Files to modify
- `packages/desktop/src/conveyor-bridge.ts`
- `app/components/chat/UserMessage.tsx`

### Order of operations and why
1. Update attachment write behavior in the desktop bridge first so new attachments are stored as actual binary image bytes.
2. Add read-time fallback in `UserMessage` so existing already-broken persisted attachments can still render after reopening projects.
3. Run verification and inspect `git diff` to ensure only task-scoped changes.
4. Stage hunk-by-hunk and commit.
5. Update Obsidian task note and move card to `Review`.

### Approach chosen
- Chosen:
  - Strip `data:*;base64,` prefix before saving attachments and call `/api/project-files/write/:projectId` with `{ encoding: "base64" }`.
  - In message rendering, detect legacy files where the on-disk content is itself a text data URL and use that data URL directly.
- Alternative considered and rejected:
  - Fix only `UserMessage` fallback: rejected because it does not prevent future broken saves.
  - Fix only `saveAttachment`: rejected because already-saved legacy files would remain broken.

### Assumptions
1. Attachment `data` passed to `saveAttachment` is usually a data URL (e.g., `data:image/png;base64,...`) and not arbitrary text.
2. `projectFiles.readFile()` for binary attachments returns base64 bytes of file contents, which allows detecting legacy text payloads by decoding.
3. A small utility in `UserMessage` for legacy decoding is acceptable within scope because the bug is explicitly about reopen/render behavior.

### Risk areas
- Incorrect base64 parsing could cause save failures for some attachment formats.
- Legacy detection must avoid false positives for valid binary image files.

### Verification
- Run lint/type checks on touched code paths if available.
- Confirm diff only affects attachment save/reload behavior.
- Ensure no unrelated files are modified.
