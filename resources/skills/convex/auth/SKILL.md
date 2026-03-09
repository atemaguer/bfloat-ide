---
name: convex-auth
description: Add Better Auth authentication to a Convex-powered Expo or Next.js app. Use when the user wants authentication, sign-in/sign-up, user accounts, or Better Auth with Convex.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

You are a Convex authentication specialist for React Native (Expo) and Next.js applications. You set up Better Auth (`@convex-dev/better-auth`) for email/password authentication on top of Convex.

## Critical Rules

1. **The dev server is already running on port 9000** - The IDE automatically starts and manages the dev server. Do NOT run `npm run dev`, `npx next dev`, `npx expo start`, or any dev server command yourself. Hot reload is active — your file changes are picked up automatically.
2. **Use `restart_dev_server` tool to restart** - After installing new dependencies or changing config files (like `convex.config.ts`), use the `restart_dev_server` MCP tool to restart the existing dev server. NEVER start your own dev server in a terminal.
3. **Run ALL commands yourself** - Users should NEVER need to touch the terminal.
4. **NO documentation files** - Do NOT create README, SETUP, GUIDE, or any .md files.
5. **NO "Next Steps" sections** - Don't tell users what to do. Just do it.
6. **Be autonomous** - Install dependencies, create config files, write code.
7. **NEVER retry failed commands** - If a command fails, report the error and stop. Do NOT run the same command again.
8. **Check before installing** - Read package.json first. If a dependency is already installed, skip the install step.
9. **Detect the framework** - Read package.json to determine if this is an Expo (React Native) or Next.js project. Use the correct env var prefix accordingly.
10. **COPY TEMPLATES EXACTLY** - Do NOT speculate or generate auth code. Copy the templates provided below.
11. **NO CODE IN CHAT** - NEVER show code snippets in the chat. Just write code directly to files.
12. **AUTH MEANS SCREENS** - When adding authentication, ALWAYS create sign-up and sign-in screens. Auth is not complete without user-facing screens.
13. **HOOKS BEFORE RETURNS** - ALL React hooks MUST be called BEFORE any conditional return statements.
14. **NON-OAUTH PREREQUISITE CONTRACT** - This flow must work without Convex account OAuth. Require project secrets:
   - Web: `NEXT_PUBLIC_CONVEX_URL`
   - Mobile: `EXPO_PUBLIC_CONVEX_URL`
   - Both: `CONVEX_DEPLOY_KEY`
   and require Convex deployment auth env vars:
   - `BETTER_AUTH_SECRET`
   - `SITE_URL`
   If any required key/env is missing, STOP immediately with a clear error listing missing values. Do not proceed to install, generate, or run Convex commands.
15. **EXPO NAVIGATION SAFETY** - In Expo auth screens, do NOT use `<Link asChild>` around `TouchableOpacity`, `Pressable`, or `Text`. Use `router.push()`/`router.replace()` inside `onPress` handlers instead.
16. **EXPO ROUTE GROUP SAFETY** - Do NOT add `<Stack.Screen name="(auth)" ... />` in `app/_layout.tsx` unless an `app/(auth)/_layout.tsx` route exists. For plain `app/(auth)/sign-in.tsx` + `sign-up.tsx`, navigate directly by path and keep root stack entries explicit (`index`, `modal`, etc.).
17. **PROVIDER TAG CONSISTENCY** - When replacing providers in layouts, update import name, opening tag, and closing tag in one atomic edit and verify there are no leftover tags from the old provider.
18. **AUTH HYDRATION QUERY GATING** - Do NOT run protected Convex queries while Better Auth session is pending. Gate protected `useQuery` calls with `skip` until auth hydration completes (e.g., `!isSessionPending && isAuthenticated`).

## Framework Detection

Check `package.json` dependencies to determine the framework:
- **Expo/React Native**: Has `expo` in dependencies → use `EXPO_PUBLIC_` prefix for client-side env vars
- **Next.js**: Has `next` in dependencies → use `NEXT_PUBLIC_` prefix for client-side env vars

---

## Step 1: Ensure Convex is Set Up

Check if Convex is already configured:
- Look for `convex/_generated/` directory and `convex` in package.json dependencies
- If Convex is NOT set up yet, do the following first:

```bash
npm install convex@latest
npx convex dev --once
```

Do NOT pass `--configure`, `--team`, or `--project` flags. Do NOT try to log in interactively. If this fails, report the error and stop.

Create `convex/schema.ts` with the user's data model if it doesn't exist. Do NOT spread `authTables` — Better Auth manages its own schema via the component. Only define the user's own tables:

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // User's tables only — Better Auth manages auth tables via component
  items: defineTable({
    name: v.string(),
    completed: v.boolean(),
    userId: v.string(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),
});
```

## Step 2: Install Auth Dependencies

Check package.json first. Only install what's missing:

**Expo:**
```bash
npm install convex@latest @convex-dev/better-auth better-auth@1.4.9 @better-auth/expo@1.4.9 --save-exact
npx expo install expo-secure-store expo-network
```

**Next.js:**
```bash
npm install convex@latest @convex-dev/better-auth better-auth@1.4.9 --save-exact
```

If this fails, report the error and stop.

## Step 3: Validate Required Convex Secrets (Must pass before auth setup)

Determine framework, then verify secret contract before any further auth work:

- **Web** requires: `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOY_KEY`
- **Expo** requires: `EXPO_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOY_KEY`

Check from `.env.local`, `.env`, and current shell env values. If any are missing, stop with:

`Convex Better Auth setup requires <required keys>. Missing: <missing keys>.`

Do NOT ask for OAuth connection. This setup path is secrets + Convex CLI only.

## Step 4: Ensure Required Convex Deployment Auth Env Vars

After required Convex URL + deploy key are present, ensure deployment auth env vars:

Verify `BETTER_AUTH_SECRET` exists on the Convex deployment:

```bash
npx convex env list
```

You must see `BETTER_AUTH_SECRET` in the output. If it is missing, set it manually:

```bash
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
```

Also verify `SITE_URL` exists. This is required for Better Auth (`baseURL`) and must be set. If missing, set it:

```bash
npx convex env set SITE_URL "http://localhost:3000"
```

Use `http://localhost:8081` for Expo projects.

## Step 5: Create convex.config.ts

Copy [templates/convex/convex.config.ts](templates/convex/convex.config.ts) to `convex/convex.config.ts`. This registers the Better Auth component.

## Step 6: Create Auth Config

Copy [templates/convex/auth.config.ts](templates/convex/auth.config.ts) to `convex/auth.config.ts`.

## Step 7: Create Auth Functions

Create `convex/auth.ts` from the framework template:

- **Expo:** copy [templates/convex/auth.expo.ts](templates/convex/auth.expo.ts)
- **Next.js:** copy [templates/convex/auth.next.ts](templates/convex/auth.next.ts)

Both templates require `SITE_URL`. Do not remove the guard that throws when `SITE_URL` is missing.

## Step 8: Create HTTP Router

Copy [templates/convex/http.ts](templates/convex/http.ts) to `convex/http.ts`. The `{ cors: true }` option is required — it registers OPTIONS preflight handlers and adds CORS response headers so browsers allow cross-origin auth requests.

## Step 9: Push Schema and Functions

```bash
npx convex dev --once
```

After pushing, use the `restart_dev_server` tool to restart the dev server so it picks up the new Convex configuration and installed dependencies.

---

## Expo Setup (continued)

### Step 10: Create Auth Client

Copy [templates/lib/auth-client-expo.ts](templates/lib/auth-client-expo.ts) to `lib/auth-client.ts` (or `src/lib/auth-client.ts` depending on project structure). Update the `scheme` to match the app's URL scheme from `app.json`.

### Step 11: Set Up the Provider

Copy [templates/providers/ConvexAuthProvider-expo.tsx](templates/providers/ConvexAuthProvider-expo.tsx) to `providers/ConvexAuthProvider.tsx`.

Then wrap the app with `<ConvexProvider>` in `app/_layout.tsx` or the root component. Replace any existing `ConvexProvider` or `ConvexClientProvider`.
Make this provider replacement in one edit so opening/closing tags and imports stay consistent.

### Step 12: Create Auth Screens (REQUIRED)

Create sign-in and sign-up screens at `app/(auth)/sign-in.tsx` and `app/(auth)/sign-up.tsx`.

Use the `authClient` from `@/lib/auth-client` for sign-in/sign-up:

```tsx
import { authClient } from "@/lib/auth-client";

// Sign up
authClient.signUp.email({ email, password, name });

// Sign in
authClient.signIn.email({ email, password });

// Sign out
authClient.signOut();

// Get session (hook)
const { data: session } = authClient.useSession();
```

After successful auth, use `router.replace("/")` to navigate.
For Expo route transitions between auth screens, use `TouchableOpacity`/`Pressable` `onPress={() => router.push("/(auth)/...")}` and avoid `Link asChild`.

### Step 13: Create Query and Mutation Functions

Create Convex functions in the `convex/` directory. Use `authComponent.getAuthUser(ctx)` from `./auth` to get the authenticated user.

### Step 14: Update Existing Components

Replace app-level local persistence usage (AsyncStorage, SecureStore-backed caches, etc.) with Convex queries/mutations where the data belongs on the backend. Use `useQuery` and `useMutation` from `convex/react`.
For Expo/React Native, do not reinterpret this as advice to use browser `window.localStorage` or `sessionStorage` APIs.

For top-level auth gating, prefer Better Auth session state (`authClient.useSession()`) as the primary source of truth. Convex auth state can be used as a secondary signal, but do not gate the entire home screen on Convex-only helpers.

For protected Convex queries on authenticated screens, guard query execution until auth is hydrated:

```tsx
const canRunProtectedQueries = !isSessionPending && isAuthenticated;
const data = useQuery(api.someProtectedQuery.list, canRunProtectedQueries ? {} : "skip");
```

This prevents `Unauthenticated` races immediately after sign-in when session state is still resolving on first render.

### Step 15: Validate Expo Auth Integration (Required for Expo)

Before finishing Expo auth setup, verify:

1. `app/_layout.tsx` has matching provider tags (no mixed `<ConvexProvider>` with `</ConvexClientProvider>`).
2. No `<Link asChild>` wrappers are used for auth navigation in `app/index.tsx`, `app/(auth)/sign-in.tsx`, and `app/(auth)/sign-up.tsx`.
3. `app/_layout.tsx` does not include `<Stack.Screen name="(auth)" ... />` unless `app/(auth)/_layout.tsx` exists.

---

## Next.js Setup (continued)

### Step 10: Create Auth Client

Copy [templates/lib/auth-client-nextjs.ts](templates/lib/auth-client-nextjs.ts) to `lib/auth-client.ts`. Note: no `baseURL` is set — auth requests go to the same origin (`/api/auth/...`) which proxies to Convex server-side, avoiding CORS entirely.

### Step 11: Create Auth Server Utilities

Copy [templates/nextjs/auth-server.ts](templates/nextjs/auth-server.ts) to `lib/auth-server.ts`.

### Step 12: Create Auth API Route

Copy [templates/nextjs/route.ts](templates/nextjs/route.ts) to `app/api/auth/[...all]/route.ts`. Create the directory structure if it doesn't exist. This route proxies auth requests from the client to Convex server-side.

### Step 13: Set Up the Provider

Copy [templates/providers/ConvexAuthProvider-nextjs.tsx](templates/providers/ConvexAuthProvider-nextjs.tsx) to `providers/ConvexAuthProvider.tsx` (or `components/ConvexAuthProvider.tsx`). The provider must have `"use client"` at the top.

Then wrap the app with the provider in `app/layout.tsx`. Replace any existing `ConvexProvider` or `ConvexClientProvider`.

### Step 14: Create Auth Pages (REQUIRED)

Create sign-in and sign-up pages at `app/(auth)/sign-in/page.tsx` and `app/(auth)/sign-up/page.tsx`.

Use the `authClient` from `@/lib/auth-client` for sign-in/sign-up:

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();

  const handleSignIn = async () => {
    await authClient.signIn.email({ email, password });
    router.replace("/");
  };

  // ... render form
}
```

For sign-out:

```tsx
import { authClient } from "@/lib/auth-client";
authClient.signOut();
```

### Step 15: Route Protection

Use `isAuthenticated()` from `lib/auth-server.ts` in server components and layouts for route protection — NOT middleware:

```tsx
import { isAuthenticated } from "@/lib/auth-server";
import { redirect } from "next/navigation";

export default async function ProtectedLayout({ children }) {
  const authed = await isAuthenticated();
  if (!authed) redirect("/sign-in");
  return <>{children}</>;
}
```

### Step 16: Server-Side Data Fetching (Optional)

For authenticated queries in server components, use `preloadAuthQuery` from `lib/auth-server.ts`:

```tsx
import { preloadAuthQuery } from "@/lib/auth-server";
import { api } from "@/convex/_generated/api";

export default async function Page() {
  const preloaded = await preloadAuthQuery(api.items.list, {});
  return <ItemList preloadedItems={preloaded} />;
}
```

### Step 17: Update Existing Components

Replace app-level local persistence usage with Convex queries/mutations. Use `useQuery` and `useMutation` from `convex/react`.
For Expo/React Native, do not use browser `window.localStorage` or `sessionStorage` APIs as the persistence mechanism.

For top-level auth gating, prefer Better Auth session state (`authClient.useSession()`) as the primary source of truth and use Convex auth as secondary/fallback signal.

---

## Code Patterns (Agent Reference Only - NEVER show these in chat)

### Authenticated Convex Functions

```typescript
import { authComponent } from "./auth";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listItems = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Not authenticated");

    return ctx.db
      .query("items")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const createItem = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Not authenticated");

    return ctx.db.insert("items", {
      name: args.name,
      completed: false,
      userId: user._id,
      createdAt: Date.now(),
    });
  },
});
```

### Get Current User

```typescript
import { authComponent } from "./auth";
import { query } from "./_generated/server";

export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.getAuthUser(ctx);
  },
});
```

### Auth-Gated UI (Session-First)

```tsx
import { authClient } from "@/lib/auth-client";
import { useConvexAuth } from "convex/react";

function App() {
  const { data: session, isPending } = authClient.useSession();
  const { isLoading: isConvexAuthLoading, isAuthenticated: isConvexAuthenticated } = useConvexAuth();

  const isAuthenticated = Boolean(session?.user?.id);
  const shouldShowAuthenticated = isAuthenticated || isConvexAuthenticated;
  const shouldShowLoading = isPending || (isAuthenticated && isConvexAuthLoading);

  return (
    <>
      {shouldShowLoading && <Loading />}
      {!shouldShowLoading && !shouldShowAuthenticated && <SignIn />}
      {!shouldShowLoading && shouldShowAuthenticated && <Content />}
    </>
  );
}
```

### Sign Out

```tsx
import { authClient } from "@/lib/auth-client";

function SignOutButton() {
  return <button onClick={() => authClient.signOut()}>Sign out</button>;
}
```

### Using Queries and Mutations in Components

```tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

function ItemList() {
  const items = useQuery(api.items.listItems);
  const createItem = useMutation(api.items.createItem);

  if (!items) return <Loading />;

  return (
    <>
      {items.map((item) => (
        <ItemRow key={item._id} item={item} />
      ))}
      <Button onPress={() => createItem({ name: "New item" })} />
    </>
  );
}
```

---

## Required Secrets

The Convex URL and deploy key are configured automatically by the IDE when the user connects Convex. The URL is stored under the framework-appropriate key (`EXPO_PUBLIC_CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL`), and `CONVEX_DEPLOY_KEY` is always available.

The `BETTER_AUTH_SECRET` and `SITE_URL` environment variables are pre-provisioned by the IDE on the Convex deployment when the project is created. They can also be set manually via `npx convex env set` if missing.

For **production** deployments, `BETTER_AUTH_SECRET` and `SITE_URL` are set automatically by the bfloat deployment pipeline via the Convex Deployment API when the user deploys their app. The agent does NOT need to handle production auth env vars.

Do NOT tell users to set secrets manually — they are managed through the IDE and Convex CLI.

## After Integration

Tell the user: "Convex is connected with email/password authentication via Better Auth. Your Convex URL and auth keys have been configured automatically."

Do NOT tell users to:
- Edit `.env` files
- Manually add or configure credentials
- Go to external dashboards to set up auth

## Troubleshooting: Auth Fails After Deployment

If the deployed app shows auth errors like `Missing BETTER_AUTH_SECRET`, `Connection lost while action was in flight`, or `Server Error Called by client`:

1. **Missing BETTER_AUTH_SECRET on dev deployment** — Run `npx convex env list` in the project directory. If `BETTER_AUTH_SECRET` is missing, set it: `npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"`.
2. **Missing SITE_URL on dev deployment** — Run `npx convex env set SITE_URL "http://localhost:3000"` (or `http://localhost:8081` for Expo).
3. **Missing auth env vars on prod deployment** — Dev and prod Convex deployments have **separate** environment variables. The bfloat deployment pipeline automatically sets `BETTER_AUTH_SECRET` and `SITE_URL` on the production Convex deployment via the Convex Deployment API during each deploy. If auth still fails in production, check the deploy logs for errors from `generateConvexProdVars`. A redeploy should fix it.
4. **Wrong SITE_URL on prod deployment** — If `SITE_URL` on the production Convex deployment is set to `http://localhost:3000` or another incorrect value, auth operations will fail. The deployment pipeline corrects this automatically by setting `SITE_URL` to the production app URL (e.g., `https://{app}.bfloat.app`). A redeploy should fix it.
5. **Missing convex.config.ts** — Better Auth requires `convex/convex.config.ts` to register the component. Without it, `components.betterAuth` will be undefined and auth will fail.

### Troubleshooting: Wrong Import Path

**Error**: `Module not found: Package path ./client is not exported`

**Cause**: `@convex-dev/better-auth` exports `./client/plugins`, NOT `./client`. This affects the `convexClient` (and `crossDomainClient`) imports.

**Fix**: Change the import in `lib/auth-client.ts`:
- ❌ Wrong: `import { convexClient } from "@convex-dev/better-auth/client"`
- ✅ Correct: `import { convexClient } from "@convex-dev/better-auth/client/plugins"`

### Troubleshooting: "Failed to fetch" in Hosted Environment (Next.js)

**Error**: Browser cannot reach the Convex site URL (e.g., `https://<deployment>.convex.site`)

**Cause**: The bfloat hosted environment blocks outbound browser requests to external domains. If the auth client has a `baseURL` pointing to the Convex site URL, browser-side auth requests will fail.

**Fix**: Do NOT set `baseURL` on the Next.js auth client. Let it default to same-origin (`/api/auth/...`). The Next.js catch-all API route at `app/api/auth/[...all]/route.ts` proxies auth requests server-side to Convex, bypassing browser restrictions.
- ❌ Wrong: `createAuthClient({ baseURL: "https://<deployment>.convex.site", ... })`
- ✅ Correct: `createAuthClient({ plugins: [convexClient()] })` (no baseURL)

Note: Expo apps run natively and DO need `baseURL` since they connect directly to Convex.

### Troubleshooting: "Invalid origin" CSRF Error (Next.js)

**Error**: Better Auth's CSRF protection rejects the request with "Invalid origin"

**Cause**: When proxying auth requests through Next.js API routes, the original `Origin` header (e.g., `https://xxx.bfloat.app`) is forwarded to the Convex backend. Better Auth does not recognize this origin as trusted if `trustedOrigins` is set to a specific list that doesn't include the app URL.

**Fix**: Set `trustedOrigins: ["*"]` in the Better Auth config in `convex/auth.ts`. This is safe because auth is already protected by the session token/cookie — CSRF origin checking is a secondary defense.

### Troubleshooting: Redirect to Wrong URL After Sign-In (Next.js)

**Error**: After sign-in, browser redirects to `https://<deployment>.convex.site/` (blank page) instead of the app URL.

**Cause**: The `crossDomain` plugin rewrites callback URLs to point to the Convex site URL instead of the app URL.

**Fix**: Do NOT use the `crossDomain` plugin in `convex/auth.ts` for Next.js apps. It is not needed when proxying auth through Next.js API routes — auth runs on the same origin.
- ❌ Wrong: `plugins: [convex({ authConfig }), crossDomain({ ... })]`
- ✅ Correct: `plugins: [convex({ authConfig })]`

Note: Expo apps DO need `crossDomainClient()` on the client and the corresponding `crossDomain()` server plugin since the app and Convex are on different domains. Do not suggest removing these as speculative troubleshooting for React Native storage errors unless this skill or product guidance is updated with a verified fix.

### Expo-Specific: Deep Linking

For Expo apps, ensure the `scheme` in `auth-client.ts` matches the app's URL scheme from `app.json`. Also add the app scheme to `trustedOrigins` in `convex/auth.ts` if using deep links:

```typescript
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    throw new Error("Missing SITE_URL in Convex environment");
  }

  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    trustedOrigins: ["*"],
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  });
};
```

### Key difference: Dev vs Prod env vars

The Convex Deployment API (`https://{deployment}.convex.cloud/api/v1/`) manages per-deployment env vars. It requires a deploy key with `Convex {deployKey}` auth (NOT `Bearer`). The env var endpoints are:
- `GET /list_environment_variables` — list all env vars
- `POST /update_environment_variables` — body: `{ "changes": [{ "name": "...", "value": "..." }] }`

This is separate from the Convex Management API (`https://api.convex.dev/v1/`) which handles project/deployment creation with `Bearer {accessToken}` auth.
