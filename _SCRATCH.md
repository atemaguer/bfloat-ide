TASK: Replicate bfloat-workbench integration-banner skip flow in bfloat-ide

Files to modify:

- `app/components/chat/Chat.tsx`
- `app/components/chat/Messages.tsx`
- `app/components/chat/AssistantMessage.tsx`
- `app/components/chat/ConvexSetupBanner.tsx`
- `app/components/chat/FirebaseSetupBanner.tsx`
- `app/components/chat/StripeSetupBanner.tsx`
- `app/components/chat/RevenueCatSetupBanner.tsx`

Order of operations and why:

1. Add setup-prompt metadata plumbing in `Chat.tsx` so intercepted integration banners remember the original prompt and whether the frontend-design skill should be forced.
2. Add a `handleIntegrationSkip` path in `Chat.tsx` that removes the banner prompt from the originating assistant message and resubmits the saved prompt directly to the local agent.
3. Thread a new `onIntegrationSkip` callback through `Messages.tsx` and `AssistantMessage.tsx`, extracting setup metadata from banner sections.
4. Update each setup banner component to render a secondary `Skip` CTA that mirrors workbench behavior without changing existing connect/use semantics.
5. Run targeted verification on the affected frontend code, then review the diff and commit only these task changes.

Approach chosen:

- Port the existing workbench pattern closely instead of inventing a new local variant.
- Keep the change scoped to chat setup banners and their prompt interception flow.

Alternatives rejected:

- Adding a generic dismiss action that only hides the banner, because the requested behavior is to send the original message directly to the agent.
- Reworking broader integration prompt policy or banner styling, because those are orthogonal to this request.

ASSUMPTIONS:

1. The desired behavior is identical to `bfloat-workbench`: skip should bypass setup guidance for that intercepted message by resending the original prompt and removing the corresponding setup part from the assistant banner message.
2. Local `MessagePart` extensibility is sufficient for carrying `originalPrompt` and `forceFrontendDesignSkill` without changing the shared type definition.
3. The existing `localAgent.sendPrompt(...)` path is the correct equivalent to workbench's direct-send helper for skipped prompts in this repo.
   → Proceeding with these.

Risk areas:

- Accidentally leaving the banner visible after skip because the wrong assistant message/part is filtered.
- Re-sending the skipped prompt with the wrong frontend-design forcing behavior for first-session prompts.
- Starting the skip flow while chat is already streaming and creating duplicate sends.

Verification:

- Run `bun x tsc -p tsconfig.web.json --noEmit` and check whether the touched files remain type-safe.
- Re-read `git diff` for only the intended banner/skip flow changes.
