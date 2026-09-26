import { readFileSync } from "node:fs";

import { createAuthClient } from "better-auth/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { signInWithOneTap } from "./one-tap";

// 只把 createAuthClient 包一层壳，其余走真实实现：既能数它被调了几次（缓存），
// 又测的是真实的插件行为（怎么初始化 GIS、拿到 credential 后 POST 什么）。
vi.mock("better-auth/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/react")>();
  return { ...actual, createAuthClient: vi.fn(actual.createAuthClient) };
});

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

/** 把 GIS 换成假的 `window.google`：initialize 记下配置，prompt 立刻当成「用户点了头像」。 */
function stubGoogle(credential = "fake-id-token") {
  type Config = { callback?: (response: { credential: string }) => void };
  let config: Config = {};

  const prompt = vi.fn(() => {
    config.callback?.({ credential });
  });
  const initialize = vi.fn((next: Config) => {
    config = next;
  });

  (window as unknown as { google: unknown }).google = {
    accounts: { id: { initialize, prompt } },
  };
  // 让插件的懒加载直接返回，不真的插 <script>：jsdom 不加载外部脚本，会一直挂住。
  (window as { googleScriptInitialized?: boolean }).googleScriptInitialized =
    true;

  return { initialize, prompt };
}

function stubFetch(status = 400) {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ message: "invalid id token" }), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { google?: unknown }).google;
  delete (window as { googleScriptInitialized?: boolean })
    .googleScriptInitialized;
});

/**
 * 这条守的是打包体积：`one-tap.ts` 被登录页的客户端组件引用，只要 import 了
 * `./env`（zod + t3-env）或 `site.config.ts`，整个配置 schema 就会进客户端 bundle ——
 * 就是 T1001 修掉的那个 92 KB gzip。改坏了要等构建之后才看得出来，这里让它单测就红。
 */
describe("one-tap 是客户端叶子模块", () => {
  it("不 import env 和配置", () => {
    const source = read("./one-tap.ts");
    // 只匹配真正的 import 语句：注释里提到 env.ts 是说明原因，不该被判违规。
    expect(source).not.toMatch(/^\s*import\s[^;]*from\s+"\.\/env"/m);
    expect(source).not.toMatch(/^\s*import\s[^;]*site\.config/m);
    expect(source).not.toMatch(/^\s*import\s[^;]*from\s+"@\/core\/config/m);
  });
});

describe("signInWithOneTap", () => {
  it("用 auto_select=false、context=signin 初始化，并只弹一次提示", async () => {
    const { initialize, prompt } = stubGoogle();
    stubFetch();

    await signInWithOneTap({
      clientId: "client-init",
      callbackURL: "/en/dashboard",
      onError: vi.fn(),
    });

    expect(initialize).toHaveBeenCalledTimes(1);
    // 用 ?? [] 取值：CI 的类型检查比本地严（索引访问会带 undefined），两种设置下都成立。
    const [config] = initialize.mock.calls[0] ?? [];
    expect(config).toMatchObject({
      client_id: "client-init",
      // 登出后不能被 Google 会话静默送回登录态（本站登出走 Server Action，
      // 插件里那条 FedCM preventSilentAccess 钩子不会触发）。
      auto_select: false,
      context: "signin",
      ux_mode: "popup",
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("拿到 credential 后 POST 到 /api/auth/one-tap/callback，带上 idToken 和 callbackURL", async () => {
    stubGoogle("token-abc");
    const fetchMock = stubFetch();

    await signInWithOneTap({
      clientId: "client-post",
      callbackURL: "/en/dashboard",
      onError: vi.fn(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/api/auth/one-tap/callback");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      idToken: "token-abc",
      // callbackURL 必须一路传到服务端：插件靠它决定登录完跳哪儿，缺了会静默不跳转。
      callbackURL: "/en/dashboard",
    });
  });

  it("回调失败时把错误交给 onError（插件本身只是静默 return）", async () => {
    stubGoogle();
    stubFetch(400);
    const onError = vi.fn();

    await signInWithOneTap({
      clientId: "client-error",
      callbackURL: "/en/dashboard",
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("同一个 clientId 只建一次客户端", async () => {
    stubGoogle();
    stubFetch();
    const createClient = vi.mocked(createAuthClient);
    createClient.mockClear();

    await signInWithOneTap({
      clientId: "client-cached",
      callbackURL: "/en/dashboard",
      onError: vi.fn(),
    });
    await signInWithOneTap({
      clientId: "client-cached",
      callbackURL: "/en/dashboard",
      onError: vi.fn(),
    });

    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
