import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Badge } from "./badge";

/**
 * `flat` switches between the two registers (see docs/design.md §4.5): a semantic badge on a
 * marketing surface is a sticker; on a product surface it is flat, outline only. This locks the
 * promise that "without flat, marketing pages don't change by a single byte".
 */
describe("Badge flat axis", () => {
  test("semantic tiers have a lip by default (marketing register)", () => {
    render(<Badge variant="success">Paid</Badge>);
    expect(screen.getByText("Paid").className).toContain("sticker");
  });

  test("flat removes the lip and keeps the 1px semantic outline", () => {
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

  test("destructive-band is a flat-outlined semantic tier, not the translucent tier", () => {
    render(
      <Badge variant="destructive-band" flat>
        Failed
      </Badge>,
    );
    const className = screen.getByText("Failed").className;
    expect(className).toContain("bg-destructive-band");
    expect(className).toContain("[--edge:var(--destructive-edge)]");
  });

  test("flat has no side effects on neutral tiers", () => {
    render(<Badge flat>Neutral</Badge>);
    expect(screen.getByText("Neutral").className).not.toContain("sticker");
  });
});
