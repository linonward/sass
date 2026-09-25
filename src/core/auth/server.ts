import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";

import { db } from "@/core/db";
import * as schema from "@/core/db/schema";
import { sendEmail } from "@/core/email";
import { env } from "@/core/env";

import siteConfig from "../../../site.config";
import { cooldownIdentifier, otpResendCooldown } from "./cooldown";
import { googleCredentials, resolveAuthBaseURL } from "./env";
import { EMAIL_SEND_FAILED } from "./errors";
import { resolveRequestLocale } from "./locale";

const otp = siteConfig.auth.emailOtp;
const google = googleCredentials(process.env);

export const auth = betterAuth({
  appName: siteConfig.name,
  baseURL: resolveAuthBaseURL(process.env, siteConfig.domain),
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  socialProviders: google
    ? { google: { ...google, prompt: "select_account" } }
    : undefined,
  account: {
    // 同一邮箱先用验证码注册、再用 Google 登录时，进入同一个账户。
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },
  rateLimit: {
    // Better Auth 默认只在生产环境开启；计数存 Postgres，多实例共享。
    storage: "database",
    customRules: {
      "/sign-in/social": { window: 60, max: 10 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // 首次注册发欢迎邮件；发信失败不影响注册。
        after: async (user, ctx) => {
          try {
            await sendEmail({
              to: user.email,
              template: "welcome",
              props: { name: user.name || undefined },
              locale: resolveRequestLocale(
                ctx?.headers ?? ctx?.request?.headers,
              ),
            });
          } catch (error) {
            console.error("[auth] failed to send welcome email", error);
          }
        },
      },
    },
  },
  plugins: [
    otpResendCooldown({ seconds: otp.resendCooldown }),
    emailOTP({
      otpLength: otp.length,
      expiresIn: otp.expiresIn,
      allowedAttempts: otp.allowedAttempts,
      // 按 IP 限制发送频率；按邮箱的重发冷却由 otpResendCooldown 负责。
      rateLimit: { window: 60, max: 5 },
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp: code, type }, ctx) {
        if (type !== "sign-in") return;
        try {
          await sendEmail({
            to: email,
            template: "sign-in-code",
            props: { code, expiresInMinutes: Math.round(otp.expiresIn / 60) },
            locale: resolveRequestLocale(ctx?.headers ?? ctx?.request?.headers),
          });
        } catch (error) {
          console.error("[auth] failed to send sign-in code", error);
          // 没发出去就不计入冷却，让用户可以立即重试。
          await ctx?.context.internalAdapter
            .deleteVerificationByIdentifier(cooldownIdentifier(email))
            .catch(() => {});
          throw new APIError("BAD_GATEWAY", {
            code: EMAIL_SEND_FAILED,
            message: "Failed to send the sign-in code",
          });
        }
      },
    }),
    // 必须放在最后：让 Server Action 里调用的 auth 接口也能写 cookie。
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
