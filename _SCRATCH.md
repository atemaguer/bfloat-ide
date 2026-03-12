PLAN:
- Rewrite `README.md` into a self-contained operator/developer guide that covers setup, local development, local data storage, database/integrations/payments setup, deployment constraints, release/build basics, and license.
- Pull only from behavior that exists in the repo today so the README is accurate: local-first storage, Tauri + Bun sidecar architecture, project-scoped integration secrets, Expo/iOS deployment flow, and local Claude/Codex CLI auth.
- Remove or correct misleading claims, especially around API key requirements for Claude/Codex and generic “publish” promises that the app does not fully support.
- Verify the rewrite by reviewing the diff and checking for obvious command/path mismatches against package scripts and current docs.

APPROACH:
- Replace the current marketing-style README with a docs-first structure:
  - What the IDE is
  - Stack and architecture
  - Setup / prerequisites
  - Running locally
  - How auth/providers work
  - Local data and “database” model
  - Payments and database integrations
  - Deployment
  - Build/release basics
  - Repo layout
  - License
- Keep it concise but self-contained; prefer “what exists today” over aspirational docs.

ALTERNATIVES REJECTED:
- Appending more sections onto the existing README: rejected because the current file has outdated and contradictory setup/auth guidance.
- Splitting into multiple docs and linking out: rejected because the user explicitly wants the README to be the docs.

ASSUMPTIONS:
1. “Database” in the README should explain both the IDE’s own local-first storage and the supported app database integrations (Firebase and Convex), rather than inventing a central app database setup.
2. “Payments” should document the current Stripe and RevenueCat integration model via project secrets and setup flows, not claim a hosted payments backend managed by the IDE.
3. The README should state that Claude Code and Codex use locally installed/authenticated CLIs and do not require OpenAI/Anthropic API keys for normal IDE usage.

RISKS:
- The repo contains older docs (`DEV.md`, `DEVELOPER.md`, `RELEASE.md`) that may now overlap with the rewritten README; the README should still be internally consistent even if those remain.
- Deployment support is asymmetric today; the README must avoid overstating Android/web deployment capabilities.

VERIFY:
- Review the final `README.md` diff carefully for accuracy.
- Confirm referenced commands match current `package.json` / package scripts.
- Keep the scope to `README.md` only.
