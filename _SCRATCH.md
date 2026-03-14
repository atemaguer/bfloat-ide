TASK: Stop showing transient error toasts while chat is actively streaming

Files to modify:
- `app/components/workbench/Workbench.tsx`
- `app/components/chat/Chat.tsx`

Order of operations and why:
1. Inspect the existing preview-error path in `Workbench` and the chat send/start error paths in `Chat` so the streaming suppression is applied only where transient live-edit errors surface.
2. Update those handlers to avoid calling `showErrorToast(...)` while chat streaming is active, but keep existing inline/persistent error state where it still informs the user without implying a broken app.
3. Verify the affected branches still surface errors once streaming is no longer active and that no unrelated toast behavior changes.

Approach chosen:
- Minimal targeted suppression at the UI call sites that currently emit noisy streaming-time error toasts.
- Preserve existing error state updates (`setError`, prompt-error banners) so the app still records failures without interruptive toast spam during active generation.

Alternatives rejected:
- Disabling all error toasts globally, because non-streaming failures should still surface clearly.
- Changing the shared toast component, because the issue is timing/conditions rather than toast presentation.

ASSUMPTIONS:
1. "Stop showing error toasts as the chat is streaming" applies to transient preview/runtime errors generated while the agent is actively making changes, not to all app-wide errors.
2. Keeping inline error state during streaming is acceptable because the user specifically called out toast noise, not all error visibility.
3. If a send/start call fails before or after active streaming, the toast should still appear because that is a real action failure rather than an expected transient edit state.
→ Proceeding with these.

Risk areas:
- Suppressing a toast in a path that represents a true terminal failure instead of a transient live-edit error.
- Leaving a duplicate non-toast error surface visible in a way that still feels noisy.

Verification:
- Run a targeted TypeScript check for the affected frontend code.
- Re-read the final diff and confirm only streaming-gated toast calls changed.
