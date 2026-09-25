import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import siteConfig from "../../../site.config";
import Home from "./page";

test("首页渲染站点名称作为一级标题", () => {
  render(<Home />);
  expect(
    screen.getByRole("heading", { level: 1, name: siteConfig.name }),
  ).toBeDefined();
});
