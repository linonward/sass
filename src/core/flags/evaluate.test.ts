import { describe, expect, test } from "vitest";

import type { UserFlagDefinition } from "@/core/config/schema";

import {
  flagBucket,
  flagDefinitions,
  flagsEnabled,
  isEnabled,
  isEnabledFor,
  resolveFlags,
  type UserFlagsConfig,
} from "./evaluate";

/** 定义一个 flag，只写关心的字段。 */
function flag(over: Partial<UserFlagDefinition> = {}): UserFlagDefinition {
  return {
    description: "test flag",
    enabled: true,
    rollout: 100,
    adminOnly: false,
    ...over,
  };
}

function config(
  definitions: Record<string, UserFlagDefinition>,
  enabled = true,
): UserFlagsConfig {
  return { enabled, definitions };
}

const anon = { userId: null };
const user = { userId: "user-1" };
const admin = { userId: "user-1", isAdmin: true };

describe("flagBucket", () => {
  test("sha256(userId + flagName) 前 8 位 hex 映射到 [0, 1)", () => {
    // 钉住算法：8 位 hex = 32 位，除以 2^32。写死值是为了防止改算法时静默换桶。
    expect(flagBucket("user-1", "beta-dashboard")).toBeCloseTo(0.1336929298, 9);
    expect(flagBucket("user-2", "beta-dashboard")).toBeCloseTo(0.6656078573, 9);
    expect(flagBucket("user-1", "beta-preview")).toBeCloseTo(0.452236033, 9);
    for (const [id, name] of [
      ["user-1", "a"],
      ["user-2", "a"],
      ["", "a"],
      ["user-1", "b"],
    ] as const) {
      const bucket = flagBucket(id, name);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(1);
    }
  });

  test("同一个 user + flag 永远是同一个桶", () => {
    expect(flagBucket("user-1", "beta-dashboard")).toBe(
      flagBucket("user-1", "beta-dashboard"),
    );
  });

  test("大面积用户上分桶是均匀的：rollout 50 大约放一半人进来", () => {
    // 钉住的是「约一半」这个说法：hash 固定，所以这条不会飘。
    const ids = Array.from({ length: 400 }, (_, i) => `user-${i}`);
    const inside = ids.filter(
      (id) => flagBucket(id, "beta-dashboard") < 0.5,
    ).length;
    expect(inside).toBeGreaterThan(400 * 0.4);
    expect(inside).toBeLessThan(400 * 0.6);
  });
});

describe("isEnabledFor", () => {
  test("总开关关着时，谁都拿不到", () => {
    const off = config({ x: flag() }, false);
    expect(isEnabledFor(off, anon, "x")).toBe(false);
    expect(isEnabledFor(off, user, "x")).toBe(false);
    expect(isEnabledFor(off, admin, "x")).toBe(false);
  });

  test("没定义的 flag 是 false", () => {
    expect(isEnabledFor(config({ x: flag() }), user, "typo")).toBe(false);
  });

  test("单个 flag 关着时，谁也拿不到（总开关开着也一样）", () => {
    const off = config({ x: flag({ enabled: false }) });
    expect(isEnabledFor(off, user, "x")).toBe(false);
    expect(isEnabledFor(off, admin, "x")).toBe(false);
  });

  test("rollout: 100 —— 有账号的用户都可见，未登录不可见", () => {
    const all = config({ x: flag({ rollout: 100 }) });
    expect(isEnabledFor(all, user, "x")).toBe(true);
    expect(isEnabledFor(all, { userId: "user-2" }, "x")).toBe(true);
    expect(isEnabledFor(all, anon, "x")).toBe(false);
  });

  test("rollout: 50 —— admin 恒可见，普通用户按桶，未登录不可见", () => {
    const half = config({ "beta-dashboard": flag({ rollout: 50 }) });
    expect(isEnabledFor(half, admin, "beta-dashboard")).toBe(true);
    expect(isEnabledFor(half, anon, "beta-dashboard")).toBe(false);
    // 桶里的人在（user-1 的桶 = 0.13），桶外的人不在（user-2 的桶 = 0.67）。
    expect(isEnabledFor(half, user, "beta-dashboard")).toBe(true);
    expect(isEnabledFor(half, { userId: "user-2" }, "beta-dashboard")).toBe(
      false,
    );
    expect(isEnabledFor(half, user, "beta-dashboard")).toBe(
      flagBucket("user-1", "beta-dashboard") < 0.5,
    );
  });

  test("rollout: 0 —— 默认谁都不给，配 adminOnly 才是「只给 admin」", () => {
    const none = config({ x: flag({ rollout: 0 }) });
    expect(isEnabledFor(none, user, "x")).toBe(false);
    expect(isEnabledFor(none, anon, "x")).toBe(false);
    expect(isEnabledFor(none, admin, "x")).toBe(false);

    const adminOnly = config({ x: flag({ rollout: 0, adminOnly: true }) });
    expect(isEnabledFor(adminOnly, admin, "x")).toBe(true);
    expect(isEnabledFor(adminOnly, user, "x")).toBe(false);
    expect(isEnabledFor(adminOnly, anon, "x")).toBe(false);
  });

  test.each([1, 50, 99, 100])(
    "rollout 大于 0 时 admin 不受灰度限制（rollout: %i）",
    (rollout) => {
      expect(isEnabledFor(config({ x: flag({ rollout }) }), admin, "x")).toBe(
        true,
      );
    },
  );

  test("rollout: 0 是硬关闭，连 admin 也拿不到；只给 admin 要配 adminOnly", () => {
    expect(isEnabledFor(config({ x: flag({ rollout: 0 }) }), admin, "x")).toBe(
      false,
    );
    expect(
      isEnabledFor(
        config({ x: flag({ rollout: 0, adminOnly: true }) }),
        admin,
        "x",
      ),
    ).toBe(true);
  });

  test("adminOnly 对普通用户和未登录用户都是 false，rollout 多高都一样", () => {
    const adminOnly = config({ x: flag({ rollout: 100, adminOnly: true }) });
    expect(isEnabledFor(adminOnly, user, "x")).toBe(false);
    expect(isEnabledFor(adminOnly, anon, "x")).toBe(false);
    expect(isEnabledFor(adminOnly, admin, "x")).toBe(true);
  });

  test("rollout 调大只会放人进来，不会把人踢出去", () => {
    const at20 = config({ "beta-dashboard": flag({ rollout: 20 }) });
    const at80 = config({ "beta-dashboard": flag({ rollout: 80 }) });
    const enabledAt = (defs: UserFlagsConfig, id: string) =>
      isEnabledFor(defs, { userId: id }, "beta-dashboard");

    // 抽样里有三种人：20% 就进来、只在 80% 进来、80% 也没进来。
    expect(enabledAt(at20, "user-1")).toBe(true);
    expect(enabledAt(at20, "user-2")).toBe(false);
    expect(enabledAt(at80, "user-2")).toBe(true);
    expect(enabledAt(at80, "user-4")).toBe(false);

    for (const id of ["user-1", "user-2", "user-3", "user-4", "user-5"]) {
      expect(enabledAt(at20, id) && !enabledAt(at80, id)).toBe(false);
    }
  });

  test("同一个 user + flag 多次评估结果一致", () => {
    const half = config({ x: flag({ rollout: 50 }) });
    const first = isEnabledFor(half, user, "x");
    for (let i = 0; i < 5; i += 1) {
      expect(isEnabledFor(half, user, "x")).toBe(first);
    }
  });
});

describe("isEnabled", () => {
  // 演示站点的 userFlags.enabled 是 false（见 site.config.ts），所以这里恒 false。
  test("出厂配置（总开关关）下永远是 false", () => {
    expect(flagsEnabled()).toBe(false);
    for (const [id, options] of [
      [null, {}],
      ["user-1", {}],
      ["user-1", { isAdmin: true }],
    ] as const) {
      expect(isEnabled(id, "beta-dashboard", options)).toBe(false);
      expect(isEnabled(id, "beta-preview", options)).toBe(false);
    }
  });
});

describe("flagDefinitions / resolveFlags", () => {
  test("flagDefinitions 按配置里的顺序列出名字和定义", () => {
    const defs = flagDefinitions(
      config({
        b: flag({ description: "second" }),
        a: flag({ description: "first" }),
      }),
    );
    expect(defs.map((d) => d.name)).toEqual(["b", "a"]);
    expect(defs[0]!.definition.description).toBe("second");
  });

  test("总开关关着时 resolveFlags 返回空对象（客户端拿不到任何 key）", () => {
    expect(resolveFlags(user, config({ x: flag() }, false))).toEqual({});
  });

  test("总开关开着时每个定义都有一个值", () => {
    const values = resolveFlags(
      user,
      config({ x: flag({ rollout: 100 }), y: flag({ rollout: 0 }) }),
    );
    expect(values).toEqual({ x: true, y: false });
  });
});
