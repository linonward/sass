import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Badge } from "./badge";

/**
 * `flat` 是两个语域的开关（见 docs/design.md §4.5）：
 * 营销面的语义徽章是一张贴纸，产品面是只有描边的平面。
 * 这里锁住的是「不传 flat 时营销页一个字节都没变」这条承诺。
 */
describe("Badge 的 flat 轴", () => {
  test("语义档默认带唇边（营销语域）", () => {
    render(<Badge variant="success">Paid</Badge>);
    expect(screen.getByText("Paid").className).toContain("sticker");
  });

  test("flat 去掉唇边，保留 1px 语义描边", () => {
    render(
      <Badge variant="success" flat>
        Paid
      </Badge>,
    );
    const className = screen.getByText("Paid").className;
    expect(className).not.toContain("sticker");
    expect(className).toContain("border-[var(--edge)]");
    expect(className).toContain("[--edge:var(--success-edge)]");
  });

  test("destructive-band 是平描边的语义档，不是半透明档", () => {
    render(
      <Badge variant="destructive-band" flat>
        Failed
      </Badge>,
    );
    const className = screen.getByText("Failed").className;
    expect(className).toContain("bg-destructive-band");
    expect(className).toContain("[--edge:var(--destructive-edge)]");
  });

  test("flat 对中性档没有副作用", () => {
    render(<Badge flat>Neutral</Badge>);
    expect(screen.getByText("Neutral").className).not.toContain("sticker");
  });
});
