# Task 2026-03-01_007_expanded-images

## Phase 2 Plan

### Files to modify
- `app/components/chat/UserMessage.tsx`
- `app/components/chat/styles.css`

### Order of operations and why
1. Extend `UserMessage` to track the selected image and render an expanded image overlay when clicked.
2. Add close interactions (backdrop click, close button, Escape key) for modal-like behavior.
3. Add scoped CSS classes for image hover affordance and expanded-view backdrop/layout.
4. Run lint on touched files and review diff for task-only changes.
5. Stage by hunk, commit with task-scoped message, update task note, and move board card to `Review`.

### Approach chosen (and alternative rejected)
- Chosen: Implement a lightweight local overlay in `UserMessage` using component state and CSS classes, so it works for both inline and persisted image attachments without changing shared dialog primitives.
- Rejected: Reusing the global `Dialog` component because it adds extra structure/styling constraints and would require additional wrapper logic for image-specific layout.

### Assumptions
1. The expanded view should apply to user message image attachments only (this task scope), not all images across the app.
2. The modal can render in-place with `position: fixed` and high `z-index`, without portal usage, and still satisfy backdrop/modal acceptance criteria.
3. Existing message rendering behavior (including attachment loading fallback from prior task) must remain unchanged.

### Risk areas
- Overlay layering/z-index conflicts with existing app UI.
- Click handling could accidentally close immediately if event propagation is not contained.

### Verification
- `npx eslint app/components/chat/UserMessage.tsx app/components/chat/styles.css`
- Manual logic review: clicking thumbnail opens expanded image; backdrop/click-close button/Escape closes.
- `git diff` inspection to ensure only task-scoped changes.
