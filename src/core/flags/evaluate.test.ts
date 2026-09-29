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

/** Defines a flag with only the fields the test cares about. */
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
  test("maps the first 8 hex digits of sha256(userId + flagName) to [0, 1)", () => {
    // Pins the algorithm: 8 hex digits = 32 bits, divided by 2^32. The values are hard-coded so an
    // algorithm change can't silently reshuffle buckets.
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

  test("the same user + flag is always the same bucket", () => {
    expect(flagBucket("user-1", "beta-dashboard")).toBe(
      flagBucket("user-1", "beta-dashboard"),
    );
  });

  test("bucketing is uniform across many users: rollout 50 lets in about half", () => {
    // Pins the "about half" claim: the hash is fixed, so this can't flake.
    const ids = Array.from({ length: 400 }, (_, i) => `user-${i}`);
    const inside = ids.filter(
      (id) => flagBucket(id, "beta-dashboard") < 0.5,
    ).length;
    expect(inside).toBeGreaterThan(400 * 0.4);
    expect(inside).toBeLessThan(400 * 0.6);
  });
});

describe("isEnabledFor", () => {
  test("with the master switch off, nobody gets it", () => {
    const off = config({ x: flag() }, false);
    expect(isEnabledFor(off, anon, "x")).toBe(false);
    expect(isEnabledFor(off, user, "x")).toBe(false);
    expect(isEnabledFor(off, admin, "x")).toBe(false);
  });

  test("an undefined flag is false", () => {
    expect(isEnabledFor(config({ x: flag() }), user, "typo")).toBe(false);
  });

  test("with the flag itself off, nobody gets it (even with the master switch on)", () => {
    const off = config({ x: flag({ enabled: false }) });
    expect(isEnabledFor(off, user, "x")).toBe(false);
    expect(isEnabledFor(off, admin, "x")).toBe(false);
  });

  test("rollout: 100 — visible to every signed-in user, hidden when signed out", () => {
    const all = config({ x: flag({ rollout: 100 }) });
    expect(isEnabledFor(all, user, "x")).toBe(true);
    expect(isEnabledFor(all, { userId: "user-2" }, "x")).toBe(true);
    expect(isEnabledFor(all, anon, "x")).toBe(false);
  });

  test("rollout: 50 — always visible to admins, bucketed for regular users, hidden when signed out", () => {
    const half = config({ "beta-dashboard": flag({ rollout: 50 }) });
    expect(isEnabledFor(half, admin, "beta-dashboard")).toBe(true);
    expect(isEnabledFor(half, anon, "beta-dashboard")).toBe(false);
    // Users inside the bucket get it (user-1's bucket = 0.13); users outside don't (user-2's bucket =
    // 0.67).
    expect(isEnabledFor(half, user, "beta-dashboard")).toBe(true);
    expect(isEnabledFor(half, { userId: "user-2" }, "beta-dashboard")).toBe(
      false,
    );
    expect(isEnabledFor(half, user, "beta-dashboard")).toBe(
      flagBucket("user-1", "beta-dashboard") < 0.5,
    );
  });

  test("rollout: 0 — nobody by default; adminOnly is what makes it admins-only", () => {
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
    "with rollout above 0, admins bypass the rollout (rollout: %i)",
    (rollout) => {
      expect(isEnabledFor(config({ x: flag({ rollout }) }), admin, "x")).toBe(
        true,
      );
    },
  );

  test("rollout: 0 is hard off, even for admins; admins-only requires adminOnly", () => {
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

  test("adminOnly is false for regular and signed-out users no matter how high the rollout", () => {
    const adminOnly = config({ x: flag({ rollout: 100, adminOnly: true }) });
    expect(isEnabledFor(adminOnly, user, "x")).toBe(false);
    expect(isEnabledFor(adminOnly, anon, "x")).toBe(false);
    expect(isEnabledFor(adminOnly, admin, "x")).toBe(true);
  });

  test("raising rollout only lets people in, never drops anyone", () => {
    const at20 = config({ "beta-dashboard": flag({ rollout: 20 }) });
    const at80 = config({ "beta-dashboard": flag({ rollout: 80 }) });
    const enabledAt = (defs: UserFlagsConfig, id: string) =>
      isEnabledFor(defs, { userId: id }, "beta-dashboard");

    // The sample has three kinds of users: in at 20%, in only at 80%, and out even at 80%.
    expect(enabledAt(at20, "user-1")).toBe(true);
    expect(enabledAt(at20, "user-2")).toBe(false);
    expect(enabledAt(at80, "user-2")).toBe(true);
    expect(enabledAt(at80, "user-4")).toBe(false);

    for (const id of ["user-1", "user-2", "user-3", "user-4", "user-5"]) {
      expect(enabledAt(at20, id) && !enabledAt(at80, id)).toBe(false);
    }
  });

  test("repeated evaluation of the same user + flag is consistent", () => {
    const half = config({ x: flag({ rollout: 50 }) });
    const first = isEnabledFor(half, user, "x");
    for (let i = 0; i < 5; i += 1) {
      expect(isEnabledFor(half, user, "x")).toBe(first);
    }
  });
});

describe("isEnabled", () => {
  // The demo site has userFlags.enabled false (see site.config.ts), so this is always false.
  test("always false with the factory config (master switch off)", () => {
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
  test("flagDefinitions lists names and definitions in config order", () => {
    const defs = flagDefinitions(
      config({
        b: flag({ description: "second" }),
        a: flag({ description: "first" }),
      }),
    );
    expect(defs.map((d) => d.name)).toEqual(["b", "a"]);
    expect(defs[0]!.definition.description).toBe("second");
  });

  test("resolveFlags returns an empty object with the master switch off (the client gets no keys)", () => {
    expect(resolveFlags(user, config({ x: flag() }, false))).toEqual({});
  });

  test("every definition has a value with the master switch on", () => {
    const values = resolveFlags(
      user,
      config({ x: flag({ rollout: 100 }), y: flag({ rollout: 0 }) }),
    );
    expect(values).toEqual({ x: true, y: false });
  });
});
