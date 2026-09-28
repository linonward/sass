// @vitest-environment node
import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { EMAIL_SEND_FAILED, RESEND_COOLDOWN } from "./errors";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

/**
 * 这两个码是客户端和服务端共用的词汇表：服务端在 APIError 的 body.code 里抛出，
 * sign-in-form.tsx 按 code 分支决定提示语和倒计时。改名字等于改协议，两边必须一起改。
 */
test("错误码是大写下划线常量，客户端按它 switch", () => {
  for (const code of [RESEND_COOLDOWN, EMAIL_SEND_FAILED]) {
    expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
  }
});

test("两个错误码互不相同（撞码会走错提示分支）", () => {
  expect(RESEND_COOLDOWN).not.toBe(EMAIL_SEND_FAILED);
  expect(new Set([RESEND_COOLDOWN, EMAIL_SEND_FAILED]).size).toBe(2);
});

/**
 * 和 one-tap 那条一样守的是打包体积和分层：sign-in-form.tsx 是客户端组件，
 * 一旦 errors.ts 引了服务端模块（env / db / logger），整条依赖链就会进浏览器包。
 */
test("errors.ts 是叶子模块：没有任何 import", () => {
  expect(read("./errors.ts")).not.toMatch(/^\s*import\s/m);
});
