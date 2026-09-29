import { describe, expect, test } from "vitest";

import { parsePage } from "./pagination";

describe("parsePage", () => {
  test("accepts positive integers only", () => {
    expect(parsePage("3")).toBe(3);
    for (const value of [undefined, "", "0", "-1", "1.5", "abc", ["2"]]) {
      expect(parsePage(value)).toBe(1);
    }
  });
});
