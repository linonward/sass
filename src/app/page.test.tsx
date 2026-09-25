import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import Home from "./page";

test("首页渲染一级标题", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { level: 1, name: "sass" })).toBeDefined();
});
