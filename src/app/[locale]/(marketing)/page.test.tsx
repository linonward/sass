import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, test } from "vitest";

import messages from "../../../../messages/en.json";
import siteConfig from "../../../../site.config";
import Home from "./page";

test("首页渲染站点名称和 CTA 文案", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Home />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole("heading", { level: 1, name: siteConfig.name }),
  ).toBeDefined();
  expect(screen.getByRole("link", { name: messages.Home.cta })).toBeDefined();
});
