import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

export const { handler, isAuthenticated, preloadAuthQuery, fetchAuthQuery } =
  convexBetterAuthNextJs();
