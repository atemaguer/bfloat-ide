import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";

const convexSiteUrl =
  process.env.EXPO_PUBLIC_CONVEX_SITE_URL ??
  process.env.EXPO_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site");

if (!convexSiteUrl) {
  throw new Error("Missing EXPO_PUBLIC_CONVEX_SITE_URL or EXPO_PUBLIC_CONVEX_URL");
}

export const authClient = createAuthClient({
  baseURL: convexSiteUrl,
  plugins: [
    expoClient({
      scheme: "myapp",
      storagePrefix: "myapp",
      storage: SecureStore,
    }),
    convexClient(),
    crossDomainClient(),
  ],
});
