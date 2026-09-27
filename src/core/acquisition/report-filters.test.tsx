import { describe, expect, test } from "vitest";

import { NO_SOURCE_BUCKET } from "./report";
import { sourceLabel } from "./report-filters";

describe("sourceLabel", () => {
  const labels = { unknown: "No attribution", direct: "Direct" };

  test("合成桶显示成文案里的名字，快照里的取值原样显示", () => {
    expect(sourceLabel(NO_SOURCE_BUCKET, labels)).toBe("No attribution");
    expect(sourceLabel("direct", labels)).toBe("Direct");
    expect(sourceLabel("news.ycombinator.com", labels)).toBe(
      "news.ycombinator.com",
    );
    // 真的把 utm_source 填成 unknown 的流量：字面量照原样显示，和合成桶区分开。
    expect(sourceLabel("unknown", labels)).toBe("unknown");
  });
});
