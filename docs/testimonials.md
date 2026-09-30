# Configuring landing page testimonials

Add `testimonials` to `landing.sections` in `site.config.ts`; we recommend placing it between features and delivery. To turn it off, remove that ID or set `landing.testimonials.items` to an empty array. Cards read in `items` order, down and then across, and narrow screens keep the same order.

The six default items are all sample copy: `example: true` shows a "Sample quote" label on each card, and the section also notes that these are not real customer testimonials. The images are existing product photography, not customer results. After replacing them with authorized real copy and assets, remove `example` from each item. If you don't have real content, you can empty `items` — don't make up user counts or ratings.

```ts
// site.config.ts → landing
// Body text, author identity, and image alt text live in Landing.testimonials.items.<key> in
// messages. Put image/video assets and avatars in public/; a video must have a poster,
// dimensions, and captions.
testimonials: {
  items: [
    { key: "focus", type: "quote", author: { name: "Your customer" } },
    {
      key: "launch",
      type: "image",
      author: { name: "Your customer", avatar: "/testimonials/avatar.webp" },
      media: { src: "/testimonials/product.webp", width: 1200, height: 800 },
      sourceUrl: "https://example.com/original-feedback",
    },
    {
      key: "story",
      type: "video",
      author: { name: "Your customer" },
      media: {
        src: "/testimonials/story.mp4",
        poster: "/testimonials/story.webp",
        width: 720,
        height: 1280,
        captions: [
          { src: "/testimonials/story.en.vtt", srcLang: "en", label: "English" },
        ],
      },
    },
  ],
},
```

Put the assets in `public/testimonials/` before filling in the paths, and enter the actual width and height. Images are cropped to 16:10 by default; videos keep the configured aspect ratio. Videos use the browser's native play/pause/volume/captions controls, work with the keyboard, don't autoplay, and don't preload the video itself. Every video needs at least one WebVTT captions file. Only asset paths on your own site are accepted, not third-party iframes. Source links must be HTTPS.

In `messages/en.json` and `messages/zh.json`, add the following under `Landing.testimonials.items` for each key:

```json
{
  "launch": {
    "quote": "The customer's own words, <highlight>the key sentence</highlight>.",
    "role": "Role / product name",
    "imageAlt": "The product and content visible in the screenshot"
  }
}
```

`quote` and `role` are required for every item; `imageAlt` is required only for image cards; the highlight tag is optional. Author avatars use an empty alt so screen readers don't repeat the name next to them. The section title, description, sample notice, and the video's accessible name live in the same translation namespace. Update these fields when you add a language.
