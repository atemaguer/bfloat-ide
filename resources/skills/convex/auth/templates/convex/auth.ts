import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth } from "better-auth/minimal";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    throw new Error("Missing SITE_URL in Convex environment");
  }

  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: ["*"],
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  });
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.getAuthUser(ctx),
});
