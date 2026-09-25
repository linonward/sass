import { betterAuth, type User } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, emailOTP } from "better-auth/plugins";
import { z } from "zod";

import {
  adminAccess,
  shouldPromoteToAdmin,
  withAdminRole,
} from "@/core/admin/roles";
import { db } from "@/core/db";
import * as schema from "@/core/db/schema";
import { sendEmail } from "@/core/email";
import { env } from "@/core/env";
import { routing } from "@/core/i18n/routing";
import { runAfterResponse } from "@/core/lib/after-response";

import siteConfig from "../../../site.config";
import { cooldownIdentifier, otpResendCooldown } from "./cooldown";
import { googleCredentials, resolveAuthBaseURL } from "./env";
import { EMAIL_SEND_FAILED } from "./errors";
import { resolveRequestLocale } from "./locale";

const otp = siteConfig.auth.emailOtp;
const google = googleCredentials(process.env);
// 首个管理员：用这些邮箱登录时自动获得 admin 角色（见 src/core/admin/roles.ts）。
const adminEmails = siteConfig.features.admin ? (env.ADMIN_EMAILS ?? []) : [];

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
      // 偏好语言：设置页里修改，事务邮件优先使用。只接受站点启用的语言。
      locale: {
        type: "string",
        required: false,
        input: true,
        validator: { input: z.enum(routing.locales as [string, ...string[]]) },
      },
    },
  },
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
    session: {
      create: {
        // 每次登录时检查是否要提升为 admin。session 已经建好，同一请求之后读到的就是新角色。
        after: async (session, ctx) => {
          if (adminEmails.length === 0 || !ctx) return;
          const adapter = ctx.context.internalAdapter;
          // internalAdapter 的类型不含插件字段；role 由 admin 插件添加。
          const user = (await adapter.findUserById(session.userId)) as
            (User & { role?: string | null }) | null;
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
        // 首次注册发欢迎邮件，放到响应之后发，不拖慢首次登录；发信失败不影响注册。
        after: async (user, ctx) => {
          const locale = resolveRequestLocale(
            ctx?.headers ?? ctx?.request?.headers,
          );
          await runAfterResponse(async () => {
            try {
              await sendEmail({
                to: user.email,
                template: "welcome",
                props: { name: user.name || undefined },
                locale,
              });
            } catch (error) {
              console.error("[auth] failed to send welcome email", error);
            }
          });
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
    // 用户角色和封禁（后台 /admin 用）。插件一直启用，表结构不随 features.admin 变化；
    // 被封禁的用户无法登录，封禁时已有的 session 全部失效。
    admin({
      ...adminAccess,
      bannedUserMessage: "This account has been suspended.",
    }),
    // 必须放在最后：让 Server Action 里调用的 auth 接口也能写 cookie。
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
