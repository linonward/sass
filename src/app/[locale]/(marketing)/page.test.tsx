import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, test } from "vitest";

import messages from "../../../../messages/en.json";
import Home from "./page";

test("home page renders the hero title and primary CTA", () => {
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
    within(document.querySelector("#hero") as HTMLElement).getByRole("link", {
      name: messages.Landing.hero.primaryCta,
    }),
  ).toBeDefined();
});
