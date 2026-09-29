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
// 首个管理员：用这些邮箱登录时自动获得 admin 角色（见 src/core/admin/roles.ts）。
const adminEmails = siteConfig.features.admin ? (env.ADMIN_EMAILS ?? []) : [];

const registerAttribution = createRegistrationAttribution({
  enabled: siteConfig.acquisition.attribution.enabled,
  secret: env.BETTER_AUTH_SECRET,
  freeze: createAttributionStore(db).freeze,
  warn: (event, fields) => logger.warn(event, fields),
});
// 邀请关系只在首次创建账号时建立；已有账号不会再走到这里，也就无法补绑。
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
      // 偏好语言：设置页里修改，事务邮件优先使用。只接受站点启用的语言。
      locale: {
        type: "string",
        required: false,
        input: true,
        validator: { input: z.enum(routing.locales as [string, ...string[]]) },
      },
      // 首次运行引导（/onboarding）是否已完成。只有服务端动作能写（input: false），
      // 客户端不能自己声明已完成；登录后据此决定要不要自动跳转到 /onboarding。
      onboardingCompleted: {
        type: "boolean",
        required: false,
        input: false,
        defaultValue: false,
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
      // One Tap 的回调端点不用先登录就能打，且每次调用都要实时拉取 Google 的 JWKS 验签
      // （better-auth 没有缓存也没有覆盖入口），按 IP 限流兜住被当成免费验签服务刷。
      "/one-tap/callback": { window: 60, max: 10 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // 每次登录时检查是否要提升为 admin。session 已经建好，同一请求之后读到的就是新角色。
        after: async (session, ctx) => {
          if (
            !ctx ||
            (adminEmails.length === 0 && !siteConfig.acquisition.leads.enabled)
          )
            return;
          const adapter = ctx.context.internalAdapter;
          // internalAdapter 的类型不含插件字段；role 由 admin 插件添加。
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
        // 首次注册发欢迎邮件，放到响应之后发，不拖慢首次登录；发信失败不影响注册。
        after: async (user, ctx) => {
          const headers = ctx?.headers ?? ctx?.request?.headers;
          await registerAttribution(
            user.id,
            headers,
            ctx
              ? (name, value, options) => ctx.setCookie(name, value, options)
              : undefined,
          );
          // 邀请绑定失败或链接无效都不影响注册本身。
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
          // 注册转化事件（observability.analytics 开启时），带访客请求的 headers 用于来源统计。
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
      // 按 IP 限制发送频率；按邮箱的重发冷却由 otpResendCooldown 负责。
      rateLimit: { window: 60, max: 5 },
      storeOTP: "hashed",
      // 改邮箱：两个开关都来自 site.config.ts（见那里的注释）。verifyCurrentEmail 打开后
      // 这个插件会多出 request-email-change / change-email 两个端点；改成功后由
      // revokeSessionsOnEmailChange 作废该用户的全部 session。
      changeEmail: siteConfig.auth.changeEmail,
      async sendVerificationOTP({ email, otp: code, type }, ctx) {
        const content = otpEmail({
          type,
          code,
          expiresInMinutes: Math.round(otp.expiresIn / 60),
        });
        // 本站只发登录验证码和改邮箱流程的两个验证码，其它类型不发信。
        if (!content) return;
        // 先写进 outbox（验证码加密存放、到期作废，同一邮箱上一封没发出的旧码作废），再立即发。
        // 立即发没成功时这一行留着：服务恢复后恢复扫描会在有效期内补发；用户照样看到明确的
        // 「稍后重试 / 用 Google 登录」，重新请求时新码取代旧码。入队本身失败（数据库不可用）
        // 也走同一个提示，而不是一个 500。
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
          // retry：这一行留着，服务恢复后在有效期内补发；enqueue_failed：连入队都没成功。
          logger.error("auth.otp_email_failed", { type, outcome });
          // 没发出去就不计入冷却，让用户可以立即重试。
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
    // 用户角色和封禁（后台 /admin 用）。插件一直启用，表结构不随 features.admin 变化；
    // 被封禁的用户无法登录，封禁时已有的 session 全部失效。
    admin({
      ...adminAccess,
      bannedUserMessage: "This account has been suspended.",
    }),
    // Google One Tap：登录页弹出的账号提示（`src/core/auth/one-tap.ts` 触发）。凭据不全
    // （本地、CI、Vercel 预览）时不注册，那时登录页也不会加载 GIS 脚本，两边判断同源。
    // clientId 与 socialProviders.google 是同一个值；显式传一遍，让 ID token 验签的
    // audience 只有一个来源。
    ...(google ? [oneTap({ clientId: google.clientId })] : []),
    // 改邮箱成功后作废该用户的所有 session（放在 emailOTP 之后，只借它的端点路径）。
    revokeSessionsOnEmailChange(),
    // 必须放在最后：让 Server Action 里调用的 auth 接口也能写 cookie。
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
