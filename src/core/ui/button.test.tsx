import { describe, expect, test } from "vitest";

import { buttonVariants } from "./button";

/**
 * `buttonVariants()` goes straight into `className` on links styled as buttons,
 * with no `cn()` around it. The base's `border-transparent` and a variant's
 * `border-border` have equal specificity, so both surviving in the string left
 * the outline border transparent in light mode.
 */
describe("buttonVariants", () => {
  const classes = (value: string) => value.split(/\s+/);

  test("outline drops the base border-transparent", () => {
    const outline = classes(buttonVariants({ variant: "outline" }));
    expect(outline).toContain("border-border");
    expect(outline).not.toContain("border-transparent");
  });

  test("a tone's sticker border replaces the variant border", () => {
    const toned = classes(
      buttonVariants({ variant: "outline", tone: "primary" }),
    );
    expect(toned).toContain("border-[var(--edge)]");
    expect(toned).not.toContain("border-border");
    expect(toned).not.toContain("border-transparent");
  });

  test("variants without their own border keep the transparent one", () => {
    expect(classes(buttonVariants({ variant: "ghost" }))).toContain(
      "border-transparent",
    );
  });
});
