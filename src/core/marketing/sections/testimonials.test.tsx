import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";

import { landingSchema } from "@/core/config/schema";
import { Landing } from "../landing";
import { Testimonials } from "./testimonials";
import en from "../../../../messages/en.json";
import zh from "../../../../messages/zh.json";
import siteConfig from "../../../../site.config";

const author = { name: "A creator" };
const video = {
  key: "focus",
  type: "video",
  author,
  media: {
    src: "/story.mp4",
    poster: "/poster.webp",
    width: 720,
    height: 1280,
    captions: [{ src: "/story.vtt", srcLang: "en", label: "English" }],
  },
};

describe("testimonial configuration and rendering", () => {
  test.each([
    { ...video, media: { ...video.media, captions: [] } },
    { ...video, media: { ...video.media, poster: undefined } },
    {
      ...video,
      media: { ...video.media, src: "//third-party.example/video.mp4" },
    },
    { key: "focus", type: "quote", author, sourceUrl: "javascript:alert(1)" },
    {
      key: "focus",
      type: "image",
      author,
      media: { src: "/a.webp", width: 0, height: 800 },
    },
  ])("rejects incomplete media and unsafe URLs", (item) => {
    expect(
      landingSchema.safeParse({ testimonials: { items: [item] } }).success,
    ).toBe(false);
  });

  test("rejects duplicate story keys", () => {
    expect(
      landingSchema.safeParse({ testimonials: { items: [video, video] } })
        .success,
    ).toBe(false);
  });

  test.each([
    ["en", en],
    ["zh", zh],
  ] as const)("renders all default copy in %s", (locale, messages) => {
    const { container, getByText } = render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <Testimonials items={siteConfig.landing.testimonials.items} />
      </NextIntlClientProvider>,
    );
    expect(container.querySelectorAll("article")).toHaveLength(6);
    expect(container.querySelectorAll("mark")).toHaveLength(6);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(getByText(messages.Landing.testimonials.exampleNotice)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Landing\.testimonials/);
  });

  test("real stories omit example claims; video is opt-in, captioned and accessible", () => {
    const { testimonials } = landingSchema.parse({
      testimonials: {
        items: [{ ...video, sourceUrl: "https://example.com/story" }],
      },
    });
    const { container, queryByText, getByRole } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <Testimonials items={testimonials.items} />
      </NextIntlClientProvider>,
    );
    expect(queryByText(en.Landing.testimonials.exampleNotice)).toBeNull();
    const media = container.querySelector("video")!;
    expect(media.getAttribute("preload")).toBe("none");
    expect(media.hasAttribute("autoplay")).toBe(false);
    expect(media.hasAttribute("controls")).toBe(true);
    expect(media.getAttribute("aria-label")).toBe(
      "Watch the story from A creator",
    );
    expect(media.querySelector("track")?.getAttribute("src")).toBe(
      "/story.vtt",
    );
    expect(
      getByRole("link", { name: en.Landing.testimonials.source }).getAttribute(
        "rel",
      ),
    ).toContain("noopener");
  });

  test("empty wall is removed before computing the next section's wave", () => {
    const config = {
      ...siteConfig,
      landing: {
        ...siteConfig.landing,
        sections: ["hero", "testimonials", "delivery"] as const,
        testimonials: { items: [] },
      },
    };
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <Landing
          config={{
            ...config,
            landing: {
              ...config.landing,
              sections: [...config.landing.sections],
            },
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector("#testimonials")).toBeNull();
    expect(container.querySelector("#delivery > [aria-hidden] ")).toBeNull();
  });
});
