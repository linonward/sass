import { createLeadService } from "@/core/acquisition/leads/service";
import {
  sourceFromHeaders,
  readCookie,
  SOURCE_CHOICE_COOKIE,
} from "@/core/acquisition/tokens";
import { betterAuth, type User } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, emailOTP, oneTap } from "better-auth/plugins";
import { z } from "zod";

import {
  adminAccess,
  shouldPromoteToAdmin,
  withAdminRole,
} from "@/core/admin/roles";
import { createRegistrationAttribution } from "@/core/acquisition/registration";
import { createReferralBinding } from "@/core/acquisition/referrals/binding";
import { createReferralService } from "@/core/acquisition/referrals/service";
import { createAttributionStore } from "@/core/acquisition/store";
import { db } from "@/core/db";
import * as schema from "@/core/db/schema";
import { sendEmail } from "@/core/email";
import { notificationOutbox } from "@/core/email/queue";
import { env } from "@/core/env";
import { routing } from "@/core/i18n/routing";
import { runAfterResponse } from "@/core/lib/after-response";
import { trackEvents } from "@/core/observability/events";
import { logger } from "@/core/observability/logger";
import { trackServer } from "@/core/observability/track-server";

import siteConfig from "../../../site.config";
import { cooldownIdentifier, otpResendCooldown } from "./cooldown";
import { googleCredentials, resolveAuthBaseURL } from "./env";
import { EMAIL_SEND_FAILED } from "./errors";
import { identifySessionUser } from "./identify";
import { resolveRequestLocale } from "./locale";
import { otpEmail } from "./otp-email";
import { revokeSessionsOnEmailChange } from "./session-invalidation";

const otp = siteConfig.auth.emailOtp;
const google = googleCredentials(process.env);
// First admins: signing in with one of these emails grants the admin role automatically (see
// src/core/admin/roles.ts).
const adminEmails = siteConfig.features.admin ? (env.ADMIN_EMAILS ?? []) : [];

const registerAttribution = createRegistrationAttribution({
  enabled: siteConfig.acquisition.attribution.enabled,
  secret: env.BETTER_AUTH_SECRET,
  freeze: createAttributionStore(db).freeze,
  warn: (event, fields) => logger.warn(event, fields),
});
// A referral is only bound when the account is first created; existing accounts never reach this
// point again, so they can't be bound retroactively.
const bindReferral = createReferralBinding({
  enabled: siteConfig.acquisition.referrals.enabled,
  secret: env.BETTER_AUTH_SECRET,
  bind: createReferralService(db).bind,
  warn: (event, fields) => logger.warn(event, fields),
});

export const auth = betterAuth({
  appName: siteConfig.name,
  baseURL: resolveAuthBaseURL(process.env, siteConfig.domain),
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  socialProviders: google
    ? { google: { ...google, prompt: "select_account" } }
    : undefined,
  user: {
    additionalFields: {
      // Preferred locale: changed on the settings page and preferred for transactional emails. Only
      // locales enabled on the site are accepted.
      locale: {
        type: "string",
        required: false,
        input: true,
        validator: { input: z.enum(routing.locales as [string, ...string[]]) },
      },
      // Whether first-run onboarding (/onboarding) is done. Only server actions can write it
      // (input: false), so the client can't declare itself done; after sign-in this decides whether
      // to redirect to /onboarding automatically.
      onboardingCompleted: {
        type: "boolean",
        required: false,
        input: false,
        defaultValue: false,
      },
    },
  },
  account: {
    // Signing up with a verification code and later signing in with Google on the same email lands
    // in the same account.
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  rateLimit: {
    // Better Auth enables this only in production by default; counters live in Postgres and are
    // shared across instances.
    storage: "database",
    customRules: {
      "/sign-in/social": { window: 60, max: 10 },
      // The One Tap callback endpoint can be hit without signing in, and every call fetches
      // Google's JWKS live for signature verification (better-auth neither caches it nor offers an
      // override), so rate limit by IP to keep it from being abused as a free verification service.
      "/one-tap/callback": { window: 60, max: 10 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // On every sign-in, check whether to promote the user to admin. The session already exists,
        // so later reads in the same request see the new role.
        after: async (session, ctx) => {
          if (
            !ctx ||
            (adminEmails.length === 0 && !siteConfig.acquisition.leads.enabled)
          )
            return;
          const adapter = ctx.context.internalAdapter;
          // internalAdapter's types don't include plugin fields; role is added by the admin plugin.
          const user = (await adapter.findUserById(session.userId)) as
            (User & { role?: string | null }) | null;
          if (user && siteConfig.acquisition.leads.enabled) {
            try {
              await createLeadService(db).linkRegistration(
                user,
                siteConfig.acquisition.attribution.enabled &&
                  !sourceFromHeaders(
                    ctx.headers ?? ctx.request?.headers,
                    env.BETTER_AUTH_SECRET,
                  ) &&
                  readCookie(
                    ctx.headers ?? ctx.request?.headers,
                    SOURCE_CHOICE_COOKIE,
                  ) !== "declined",
              );
            } catch {
              logger.warn("leads.registration_link_failed", {
                userId: user.id,
              });
            }
          }
          if (user && shouldPromoteToAdmin(user, adminEmails)) {
            await adapter.updateUser(user.id, {
              role: withAdminRole(user.role),
            });
          }
        },
      },
    },
    user: {
      create: {
        // Send a welcome email on first sign-up, after the response so it doesn't slow down the
        // first sign-in; a failed send doesn't affect the sign-up.
        after: async (user, ctx) => {
          const headers = ctx?.headers ?? ctx?.request?.headers;
          await registerAttribution(
            user.id,
            headers,
            ctx
              ? (name, value, options) => ctx.setCookie(name, value, options)
              : undefined,
          );
          // A failed referral binding or an invalid link doesn't affect the sign-up itself.
          await bindReferral(user.id, headers);
          if (siteConfig.acquisition.leads.enabled) {
            try {
              await createLeadService(db).linkRegistration(
                user,
                siteConfig.acquisition.attribution.enabled &&
                  !sourceFromHeaders(headers, env.BETTER_AUTH_SECRET) &&
                  readCookie(headers, SOURCE_CHOICE_COOKIE) !== "declined",
              );
            } catch {
              logger.warn("leads.registration_link_failed", {
                userId: user.id,
              });
            }
          }
          const locale = resolveRequestLocale(headers);
          await runAfterResponse(async () => {
            try {
              await sendEmail({
                to: user.email,
                template: "welcome",
                props: { name: user.name || undefined },
                locale,
              });
            } catch (error) {
              logger.error("auth.welcome_email_failed", {
                error,
                userId: user.id,
              });
            }
          });
          // Sign-up conversion event (when observability.analytics is on), with the visitor's
          // request headers for source attribution.
          await runAfterResponse(() =>
            trackServer(trackEvents.signUp, undefined, { headers }),
          );
        },
      },
    },
  },
  plugins: [
    identifySessionUser(),
    otpResendCooldown({ seconds: otp.resendCooldown }),
    emailOTP({
      otpLength: otp.length,
      expiresIn: otp.expiresIn,
      allowedAttempts: otp.allowedAttempts,
      // Rate limit sends by IP; the per-email resend cooldown is handled by otpResendCooldown.
      rateLimit: { window: 60, max: 5 },
      storeOTP: "hashed",
      // Change email: both flags come from site.config.ts (see the comments there). With
      // verifyCurrentEmail on, this plugin adds two endpoints, request-email-change and
      // change-email; after a successful change, revokeSessionsOnEmailChange revokes all of the
      // user's sessions.
      changeEmail: siteConfig.auth.changeEmail,
      async sendVerificationOTP({ email, otp: code, type }, ctx) {
        const content = otpEmail({
          type,
          code,
          expiresInMinutes: Math.round(otp.expiresIn / 60),
        });
        // Only sign-in codes and the two change-email codes are sent; other types send nothing.
        if (!content) return;
        // Write to the outbox first (the code is stored encrypted and voided on expiry, and an
        // older unsent code for the same email is superseded), then send immediately. If the
        // immediate send fails, the row stays: once the service recovers, the recovery sweep
        // resends it within its validity window. The user still sees a clear "try again later /
        // sign in with Google", and requesting again replaces the old code with a new one. A failed
        // enqueue (database unavailable) gets the same message rather than a 500.
        let outcome: string = "enqueue_failed";
        try {
          const id = await notificationOutbox.enqueue(db, {
            kind: content.template,
            key: `${type}:${email.toLowerCase()}`,
            to: email,
            template: content.template,
            props: content.props,
            locale: resolveRequestLocale(ctx?.headers ?? ctx?.request?.headers),
            sensitive: true,
            expiresAt: new Date(Date.now() + otp.expiresIn * 1000),
            supersede: true,
          });
          outcome = await notificationOutbox.deliver(id);
        } catch (error) {
          logger.error("auth.otp_enqueue_failed", { error, type });
        }
        if (outcome !== "sent") {
          // retry: the row stays and is resent within its validity window once the service
          // recovers; enqueue_failed: not even the enqueue succeeded.
          logger.error("auth.otp_email_failed", { type, outcome });
          // Nothing was sent, so don't count it toward the cooldown; let the user retry right away.
          await ctx?.context.internalAdapter
            .deleteVerificationByIdentifier(cooldownIdentifier(email))
            .catch(() => {});
          throw new APIError("BAD_GATEWAY", {
            code: EMAIL_SEND_FAILED,
            message: "Failed to send the code",
          });
        }
      },
    }),
    // User roles and bans (used by the /admin area). The plugin is always on so the schema doesn't
    // change with features.admin; banned users can't sign in, and all their existing sessions are
    // revoked when the ban happens.
    admin({
      ...adminAccess,
      bannedUserMessage: "This account has been suspended.",
    }),
    // Google One Tap: the account prompt on the sign-in page (triggered by
    // `src/core/auth/one-tap.ts`). Not registered when credentials are incomplete (local, CI,
    // Vercel previews); the sign-in page then doesn't load the GIS script either, since both sides
    // use the same check. clientId is the same value as socialProviders.google; passing it
    // explicitly gives the ID token verification audience a single source.
    ...(google ? [oneTap({ clientId: google.clientId })] : []),
    // Revoke all of the user's sessions after a successful email change (placed after emailOTP;
    // it only borrows that plugin's endpoint path).
    revokeSessionsOnEmailChange(),
    // Must come last: lets auth APIs called from Server Actions write cookies too.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
