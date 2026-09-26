// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import en from "../../../messages/en.json";
import siteConfig from "../../../site.config";
import { renderEmail, sendEmail } from "./send";
import { readLatestEmail, waitForEmail } from "./testing";
import { createTransport, type OutgoingEmail } from "./transports";

// 模拟多语言站点，第二门语言的文案由 en.json 伪翻译而来。
vi.mock("@/core/i18n/routing", () => ({
  routing: { locales: ["en", "de"], defaultLocale: "en" },
}));

function pseudo(value: unknown): unknown {
  if (typeof value === "string") return `[de] ${value}`;
  return Object.fromEntries(
    Object.entries(value as object).map(([k, v]) => [k, pseudo(v)]),
  );
}

vi.mock("./translator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./translator")>();
  return {
    ...actual,
    loadMessages: async (locale: string) =>
      locale === "de"
        ? pseudo(en)
        : locale === "en"
          ? en
          : actual.loadMessages(locale),
  };
});

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn(function (this: { emails: unknown }, key: string) {
    this.emails = { send: (args: unknown) => send(key, args) };
  }),
}));

// 邮件模板把站点名、品牌色和站点地址内联进 HTML，直接渲染真实配置的话买家改
// site.config.ts 的 name / brand / domain 就得跑 `pnpm test -u`。
// 这里换成固定值，快照只锁模板结构（颜色仍是十六进制，和真实渲染一致），
// 断言需要写站点名时也用这份固定值。真实配置到这层常量的映射由下面
// 「品牌信息取自 site.config.ts」一条守着。
const brand = vi.hoisted(() => ({
  name: "Fixture",
  siteUrl: "https://example.com",
  primary: "#334155",
  onPrimary: "#ffffff",
  logoUrl: null,
  text: "#171717",
  muted: "#737373",
  border: "#e5e5e5",
  background: "#f5f5f5",
}));

vi.mock("./brand", () => ({ emailBrand: brand }));

const signIn = {
  to: "ada@example.com",
  template: "sign-in-code",
  props: { code: "123456", expiresInMinutes: 5 },
} as const;

describe("renderEmail", () => {
  test("品牌信息取自 site.config.ts", async () => {
    const { emailBrand } =
      await vi.importActual<typeof import("./brand")>("./brand");
    expect(emailBrand.name).toBe(siteConfig.name);
    expect(emailBrand.primary).toBe(siteConfig.brand.primaryColor);
    expect(emailBrand.siteUrl).toBe(`https://${siteConfig.domain}`);
  });

  test("生成 html、纯文本、主题和发件信息", async () => {
    const email = await renderEmail(signIn);
    const { fromName, fromAddress, replyTo } = siteConfig.email;
    expect(email.from).toBe(`${fromName} <${fromAddress}>`);
    expect(email.replyTo).toBe(replyTo);
    expect(email.to).toEqual(["ada@example.com"]);
    expect(email.subject).toBe(`Your ${brand.name} sign-in code`);
    expect(email.html).toContain("123456");
    expect(email.text).toContain("123456");
    expect(email.text).toContain("5 minutes");
    expect(email.html).not.toMatch(/oklch/);
  });

  test("模板跟随 locale 切换文案", async () => {
    const email = await renderEmail({ ...signIn, locale: "de" });
    expect(email.locale).toBe("de");
    expect(email.subject).toBe(`[de] Your ${brand.name} sign-in code`);
    expect(email.text).toContain("[de] Your sign-in code");
    expect(email.html).toContain('lang="de"');
  });

  test("未启用的语言会报错", async () => {
    await expect(renderEmail({ ...signIn, locale: "fr" })).rejects.toThrow(
      /Unsupported email locale "fr"/,
    );
  });

  test("welcome 没有名字时使用通用称呼", async () => {
    const email = await renderEmail({
      to: "a@b.co",
      template: "welcome",
      props: {},
    });
    expect(email.text).toContain("Hi there,");
  });

  test.each([
    ["sign-in-code", signIn.props],
    ["welcome", { name: "Ada" }],
    [
      "payment-succeeded",
      {
        planName: "Pro",
        kind: "subscription",
        amount: 1900,
        currency: "USD",
        paidAt: "2026-09-25T12:00:00.000Z",
        renewsAt: "2026-10-25T12:00:00.000Z",
        credits: 2000,
        manageUrl: "https://example.com/billing",
      },
    ],
    [
      "payment-failed",
      {
        planName: "Pro",
        amount: 1900,
        currency: "USD",
        manageUrl: "https://example.com/billing",
      },
    ],
    [
      "subscription-canceled",
      {
        planName: "Pro",
        endsAt: "2026-10-25T12:00:00.000Z",
        manageUrl: "https://example.com/billing",
      },
    ],
    [
      "credits-low",
      {
        balance: 80,
        threshold: 100,
        topUpUrl: "https://example.com/pricing",
      },
    ],
  ] as const)("%s 模板渲染快照", async (template, props) => {
    const email = await renderEmail({ to: "a@b.co", template, props } as never);
    expect(email.html).toMatchSnapshot("html");
    expect(email.text).toMatchSnapshot("text");
  });
});

describe("账单邮件模板", () => {
  test("主题、金额和日期随语言切换", async () => {
    const props = {
      planName: "Pro",
      kind: "one_time",
      amount: 19900,
      currency: "USD",
      paidAt: "2026-09-25T12:00:00.000Z",
      manageUrl: "https://example.com/billing",
    } as const;
    const en = await renderEmail({
      to: "a@b.co",
      template: "payment-succeeded",
      props,
    });
    expect(en.subject).toBe(`Payment received for Pro · ${brand.name}`);
    expect(en.text).toContain("$199.00");
    expect(en.text).toContain("September 25, 2026");
    // 一次性购买没有续费日期
    expect(en.text).not.toContain("Renews on");

    const de = await renderEmail({
      to: "a@b.co",
      template: "payment-succeeded",
      props,
      locale: "de",
    });
    expect(de.subject.startsWith("[de] ")).toBe(true);
    expect(de.html).toContain('lang="de"');
    // 德语的日期格式
    expect(de.text).toContain("25. September 2026");
  });

  test("可选字段缺失时对应的行不显示", async () => {
    const email = await renderEmail({
      to: "a@b.co",
      template: "payment-failed",
      props: { manageUrl: "https://example.com/billing" },
    });
    expect(email.text).toContain("couldn't process your latest payment");
    expect(email.text).not.toContain("Amount");
  });
});

describe("发送方式", () => {
  let email: OutgoingEmail;
  beforeEach(async () => {
    email = await renderEmail(signIn);
    send.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("console：打印收件人、主题和纯文本正文", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { id } = await createTransport("console")(email);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain("To:       ada@example.com");
    expect(output).toContain(`Subject:  ${email.subject}`);
    expect(output).toContain("123456");
  });

  test("file：同一毫秒内连续写入，文件名顺序仍与发送顺序一致", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "emails-"));
    try {
      const transport = createTransport("file", { outboxDir: dir });
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        const code = String(i).padStart(6, "0");
        ids.push(
          (await transport({ ...email, props: { ...email.props, code } })).id,
        );
      }
      const files = (await readdir(dir)).sort();
      const order = await Promise.all(
        files.map(
          async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")).id,
        ),
      );
      expect(order).toEqual(ids);
      const latest = await readLatestEmail({ to: "ada@example.com" }, dir);
      expect(latest?.props.code).toBe("000049");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("file：写入 JSON，readLatestEmail / waitForEmail 能读到", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "emails-"));
    try {
      const transport = createTransport("file", { outboxDir: dir });
      const before = new Date();
      await transport({ ...email, to: ["old@example.com"] });
      const { id } = await transport(email);

      const files = await readdir(dir);
      expect(files).toHaveLength(2);
      const stored = JSON.parse(
        await readFile(path.join(dir, files.sort()[1]), "utf8"),
      );
      expect(stored).toMatchObject({
        id,
        to: ["ada@example.com"],
        subject: email.subject,
        template: "sign-in-code",
        locale: "en",
        props: { code: "123456", expiresInMinutes: 5 },
      });
      expect(new Date(stored.sentAt).getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );

      const latest = await readLatestEmail(
        { to: "ada@example.com", template: "sign-in-code" },
        dir,
      );
      expect(latest?.props.code).toBe("123456");
      expect(
        await readLatestEmail({ to: "nobody@example.com" }, dir),
      ).toBeUndefined();
      expect(
        (await waitForEmail({ to: "old@example.com" }, { dir })).id,
      ).not.toBe(id);
      await expect(
        waitForEmail(
          { to: "nobody@example.com" },
          { dir, timeout: 50, interval: 10 },
        ),
      ).rejects.toThrow(/No email matching/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("resend：把渲染结果交给 SDK", async () => {
    send.mockResolvedValue({ data: { id: "email_1" }, error: null });
    const { id } = await createTransport("resend", { resendApiKey: "re_test" })(
      email,
    );
    expect(id).toBe("email_1");
    expect(send).toHaveBeenCalledWith("re_test", {
      from: email.from,
      to: ["ada@example.com"],
      replyTo: email.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: [{ name: "template", value: "sign-in-code" }],
    });
  });

  test("resend：SDK 返回错误时抛出", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "bad from" },
    });
    await expect(
      createTransport("resend", { resendApiKey: "re_test" })(email),
    ).rejects.toThrow(/Resend failed to send "sign-in-code": bad from/);
  });

  test("resend：缺少 key 时报错", () => {
    expect(() => createTransport("resend")).toThrow(/RESEND_API_KEY/);
  });

  test("sendEmail 按 EMAIL_TRANSPORT 选择发送方式", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "console");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendEmail(signIn);
    expect(log.mock.calls.flat().join("\n")).toContain("123456");
    expect(send).not.toHaveBeenCalled();
  });
});
