import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, test } from "vitest";

import messages from "../../../../messages/en.json";
import Home from "./page";

test("首页渲染 Hero 标题和主 CTA", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Home />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole("heading", {
      level: 1,
      name: messages.Landing.hero.title,
    }),
  ).toBeDefined();
  expect(
    screen.getByRole("link", { name: messages.Landing.hero.primaryCta }),
  ).toBeDefined();
});
