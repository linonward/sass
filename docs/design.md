# Visual system

Status: shipped (2026-09-26). Both registers are in place: the marketing surface, and the product surface/admin (§4.5). The marketing detail pages (blog cards, article pages, legal pages, 404) have also been brought into the same language. This isn't a style preference; it's part of the template: a buyer changes one color and the whole site changes with it.

## 1. Visual theme and mood

Marketing surface: a warm canvas with warm-ink text. Sections are **horizontal color bands** separated by waves, not cards floating in whitespace. Every surface is a **sticker**: a 1px outline plus a zero-blur hard lip, and the outline color and lip color are always the same value. Headings use a display face with some heft, body text uses a restrained sans-serif, and hierarchy comes from the contrast between the two, not from bold weights.

Product surface/admin: the same tokens, but surfaces are flat (no lip), a single canvas, and higher density. How the two registers divide the work is in §4.5.

It borrows the structural language of [creem.io](https://www.creem.io) (band rhythm, hard-edge depth, product collage) but not its brand identity: the palette is derived from one configured color, and the fonts, logo and copy are this template's own.

## 2. Palette and roles

**The whole site's colors are derived from one hex**: `brand.primaryColor` in `site.config.ts`. The derivation lives in `src/core/theme/brand-css.ts` and is injected into a `<style>` in the root layout.

| token                  | Derivation rule                                          | Result for `#4f46e5` | Use                                                           |
| ---------------------- | -------------------------------------------------------- | -------------------- | ------------------------------------------------------------- |
| `--primary`            | **The configured hex, unchanged**                        | `#4f46e5`            | Solid CTAs, emphasis                                          |
| `--primary-foreground` | Measures both text colors and picks the higher contrast  | `#fcf9f7`            | Text on `--primary`                                           |
| `--primary-edge`       | Same hue, `L = fill.L − 0.22`                            | `#21097c`            | Outline + hard lip                                            |
| `--primary-text`       | Same hue, `L = 0.50`, pushed to be legible on the canvas | `#4f54bc`            | Text and icons on light backgrounds                           |
| `--primary-band`       | Same hue, `L = 0.93`, chroma ≤ 0.05                      | `#e2e6ff`            | Full-band backgrounds                                         |
| `--background`         | Neutral, hue leaning toward the brand, chroma `0.006`    | `#f4f4f9`            | Canvas                                                        |
| `--chart-1`            | Same as `--primary`                                      | `#4f46e5`            | First chart series (the other four are fixed semantic colors) |
| `--band-tint`          | Same as above, `L = 0.921`                               |                      | Light band (one step darker than the canvas)                  |

The **hue of the neutral scale** (canvas / card / text / outline) **follows the brand**, with a chroma of only 0.006. It's barely visible, but the whole page quietly harmonizes with the brand color: a green brand gets a warmer base, an indigo brand a cooler one.

`--primary` keeps the original hex and isn't pastelized, for two reasons: the color the buyer entered should appear on their site exactly as entered, and a CTA needs a saturated color to stand up; light tints only handle large band areas. `e2e/ui-shell.spec.ts` asserts that the primary button's background is **exactly equal** to the configured value, which also locks this decision in.

**Semantic colors are fixed and don't follow the brand** (mint / amber / sky blue / red). Each semantic color has four tokens:

| token                                                  | Use                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `--success` / `--warning` / `--info` / `--destructive` | Mid tone: text, outlines, icons; legible on the canvas       |
| `--S-band`                                             | Pastel fill: large color blocks, badge backgrounds           |
| `--S-edge`                                             | Outline and lip for band surfaces                            |
| `--S-foreground`                                       | Text on a band (always warm ink; never white text on pastel) |

> `--destructive` is deliberately kept as a mid tone that "works as text" rather than a pastel: there are a dozen-plus `text-destructive` error messages across the repo, and a pastel would make them wash out completely. The pastel tier has its own name, `--destructive-band`.

**Dark mode**: canvas `L = 0.20`. Elevation comes from background lightness steps, not shadows (a dark shadow on a dark background is invisible). `--primary` is the same in both themes; the brand anchor doesn't change with the theme.

## 3. Typography

| Role        | Font                    | Variable         | Use                                        |
| ----------- | ----------------------- | ---------------- | ------------------------------------------ |
| Display     | **Bricolage Grotesque** | `--font-display` | h1 / h2 / section headings / price figures |
| Body and UI | Geist Sans              | `--font-sans`    | Everything else                            |
| Monospace   | Geist Mono              | `--font-mono`    | Terminal and checkout mocks                |

Why the heading font is Bricolage and not the reference site's Gasoek One: a template shouldn't borrow another brand's typographic identity; and Bricolage is a variable font (weights 200–800) that holds up at small sizes too (card titles and plan names use it), not a pure display face that only works for big headlines.

- H1 `clamp(2.25rem, 7vw, 4.25rem)`, weight 600, `line-height 0.98`, `tracking -0.02em`
- Section headings `.heading-display`, `text-3xl` → `sm:text-4xl`
- Prices and figures get `data-numeric` (`font-variant-numeric: tabular-nums`) so they don't jump when they update
- Headings `text-wrap: balance`, body `text-wrap: pretty`, body width ≤ 46–65ch
- **CJK**: Latin faces first, system CJK faces after; CJK runs get no negative tracking (tightening Chinese characters crowds the glyphs and looks like a rendering bug)

## 4. Component styles

### One color rule: `--edge`

One variable drives both the 1px outline and the zero-blur hard lip. Change `--edge` and you've recolored the whole surface.

```css
.sticker    { --edge: var(--border); border: 1px solid var(--edge); --tw-shadow: 0 2px 0 0 var(--edge); ... }
.sticker-lg { /* same as above, 4px lip, for large surfaces */ }
```

`--edge` must have a default. Without one it falls back to the `@property` `initial-value` (transparent): the lip isn't drawn and you can't tell — you just silently lose a layer of depth.

The lip is written into `--tw-shadow`, not a bare `box-shadow`: `focus-visible:ring-3` overwrites the entire `box-shadow` property, and only going through `--tw-shadow` survives focus.

### Components

| Component  | Variants                                                                               | States                                                                                     |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Button`   | 6 `variant`s × 9 `size`s (including 44px `marketing`) × 5 `tone`s                      | Hover sinks 1px and the lip shrinks to 1px; active sinks another 1px and the lip goes to 0 |
| `Card`     | 5 `tone`s → sticker; **no tone → `.panel` (flat product surface)**                     | Static, no hover lift                                                                      |
| `Badge`    | The original 6 + `band` / `success` / `warning` / `info` / `destructive-band` × `flat` | Marketing surface: pill + lip; `flat` removes the lip (for the product surface)            |
| `Input`    | Unchanged                                                                              | 8px radius, solid fill, focus ring                                                         |
| `Textarea` | Reuses `Input`'s class string                                                          | Same as above                                                                              |

`tone` must be declared **after** `variant` in `cva`: cva emits classes in the order of the variants' keys, and if tone came first, `variant="outline"`'s `border-border` would override the tone's outline.

`Badge`'s `flat` likewise must be declared after `variant`, and it relies on `compoundVariants` to add `sticker` to the semantic tiers: the default is `flat: false`, so marketing pages render byte-for-byte the same.

**`.panel` must be declared before `.sticker`**: both write `border: 1px solid var(...)`, and at the same layer and specificity source order decides. Put it after and it overrides the sticker's outline color with the neutral, leaving only the lip in the semantic color — completely silently.

## 4.5 Two registers

The same tokens, two surface languages. **The marketing surface persuades; the product surface gets work done.**

|            | Marketing surface                | Product surface / admin                                                                                                   |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Surface    | `.sticker` / `.sticker-lg`       | `.panel`: 1px outline, **zero lip**                                                                                       |
| Background | Horizontal bands + wave dividers | Single canvas; panels use `--card` (nearly the same as the canvas in light mode, raised by a lightness step in dark mode) |
| Headings   | display, clamp 2.25–4.25rem      | display, `text-2xl` / `sm:text-3xl` (`PageHeader`)                                                                        |
| Rhythm     | `py-14 sm:py-20`, via bands      | `py-6 sm:py-8`, via 1px lines and spacing                                                                                 |
| Container  | `.container-marketing` 80rem     | `max-w-5xl` (product pages) / `max-w-6xl` (admin data pages)                                                              |
| Tables     | Not used                         | No panel around them; they sit directly on the canvas, with uppercase small-caption headers and 1px lines between rows    |

**The lip invariant: `--edge` is the thickness of "a standalone object sitting on top of a surface."** A button is an object (it presses down); a pastel badge on a marketing page is an object (stuck onto the band). A panel is the surface itself, so it's flat. That's why the product surface has no lips anywhere: buttons get no `tone`, badges get `flat`. When you need a semantic-colored outline, apply `border-[var(--x-edge)]` directly as a utility; a flat outline doesn't count as an object.

**Status colors mark only exceptions.** In admin tables, normal states (`paid` / `active`) use a neutral fill, and only the ones that need a look get color: `warning` for partial refunds and past-due, `info` for refunded, `destructive-band` for failed and banned, `outline` for canceled/expired. Coloring every row green is the same as marking nothing.

**Tables don't get panels.** Panels are for "chunks of content" (StatTile, MetricSection, Card, empty states). A table inside a panel turns into same color on same color plus a pile of equally strong hairlines in dark mode, and at 375px you get double scrolling where "the panel doesn't scroll but the table does."

**The marketing detail pages follow the same system**: the blog list (light-band page header, a wave transition to the canvas, articles as sticker cards), article and legal pages (`max-w-3xl` body + display heading), 404 and error pages (display heading + 44px marketing CTA). Body links on these pages use `--primary-text`, not `--primary` — the latter keeps the configured hex, and on the canvas in dark mode it's only 2.88:1.

`src/app/[locale]/not-found.tsx` **renders `SiteHeader` / `SiteFooter` itself**: it lives under `[locale]/`, not in the `(marketing)` group, so it doesn't get that layout, and a 404 still needs site navigation. `error.tsx` is a client boundary and can't render server components, so only its CTA and heading belong to this register; it has no Header / Footer.

## 5. Layout

- Container `.container-marketing`: `max-width 80rem`, padding in three steps of 16 / 32 / 40px
- Vertical section spacing `py-14 sm:py-20` (tighter than the common 96–160px); separation comes from bands and waves, not whitespace
- Header `--header-height: 4.375rem`; sections derive their `scroll-mt` from it so anchor jumps aren't hidden under the header
- Grids: the home page features use three alternating image/text rows; the pricing page uses 2/3 columns depending on the number of plans; the FAQ has the heading on the left and the list on the right

## 6. Depth and elevation

**No blurred shadows, not a single one.** Depth has only two sources:

1. **Sticker surfaces**: a 1px outline + a same-color zero-blur lip (2px small, 4px large). Like a die-cut sticker.
2. **Background color steps**: canvas → card → popover, with a lightness difference of ≥4% between adjacent surfaces. The dark theme relies entirely on this, because a dark shadow on a dark background is invisible.

Derive nested radii as `outer = inner + padding`, so the two radii don't look arbitrary.

## 7. Do's and don'ts

- **Use warm ink on colored bands, not white text.** White text appears only on solid brand-color buttons (and `foregroundFor` decides that based on contrast).
- **Don't add blurred shadows.** Depth comes only from outlines and lips; if you need stronger elevation, thicken the lip or step the background back one level.
- **No gradients, no `backdrop-filter`.** The header is a solid fill; a glass effect would break the hard-edge layering logic.
- **Don't hard-code hex values in components.** Everything goes through tokens; add a token before adding a new color.
- **Keep the h1's accessible name complete.** The home page may use spans for color and line breaks to emphasize the last sentence, but `aria-label={title}` keeps the accessible name exactly equal to `Landing.hero.title`, and e2e locks this in.
- **Don't truncate prices or labels with ellipses.** Wrap long content or use a more compact format.
- **Tailwind class names must be literals.** The scanner reads the source text, so `` `[--edge:var(--${tone}-edge)]` `` yields a useless fragment and the style silently disappears.
- **Don't write bare curly braces in copy.** next-intl parses messages as ICU, so `streamText({ model })` is treated as a placeholder and errors. A test in `landing.test.tsx` guards this.

## 8. Responsive

- Breakpoints: `sm 640` / `md 768` / `lg 1024` / `xl 1280`
- Below `md` the header moves navigation into a drawer (`MobileNav`); below `sm` the header CTA is hidden (four controls in one row at 375px is too cramped)
- Feature grid spans apply only at `lg`; narrow screens fall back to one or two equal-width columns
- The hero collage overlaps via negative margins, **not absolute positioning**: absolute positioning is the most likely thing to push a horizontal scrollbar onto the page on narrow screens
- Waves are `h-10 sm:h-16`, and the SVG is drawn at 200% width and centered, so narrow screens don't squash the crests flat
- Touch targets ≥40px; `touch-action: manipulation` on `html` removes the double-tap zoom delay
- **No horizontal overflow at 375px is behavior locked by e2e** (tested in both light and dark)

## 9. Quick reference for agents

Colors (name: value, using the default indigo brand): `primary #4f46e5` · `primary-edge #21097c` · `primary-text #4f54bc` · `primary-band #e2e6ff` · `background #f4f4f9` · `band-tint` · `card #f8f9fd` · `foreground(muted) #191614` · `muted #ebecf2` · `border #d7d9de` · `success #2b7440` / band `#d4f1d8` · `warning #825b00` / band `#f8e5c7` · `info #0e6a9b` / band `#d2ecff` · `destructive #984742` / band `#ffdfdc` · `footer #1a1715`

Examples you can paste directly:

> Build a section on a `{primary-band}` band. The heading uses `.heading-display` at `text-4xl`, color `{foreground}`; the subtext is `text-lg`, color `{muted-foreground}`, width ≤46ch. The primary CTA uses `buttonVariants({ size: "marketing", tone: "primary" })`; the secondary CTA adds `variant: "outline"` and `bg-background`.

> Add a card: `bg-card sticker rounded-xl p-6`; `--edge` defaults to `--border`. To switch to a semantic color, add `[--edge:var(--info-edge)] border-[var(--edge)]`. The card title uses `.heading-display text-lg`.

> Add a semantic badge: `<Badge variant="info">`, which comes with `bg-info-band text-info` plus an outline and lip.

> Add a block of content on the product surface/admin: `panel p-6`, heading `.heading-display text-lg`. Panels have no lip; for a semantic-colored outline add `border-[var(--info-edge)]`. Status badges get `flat`: `<Badge variant="warning" flat>`.

> Product-surface page headers use `<PageHeader title description>` (`src/core/ui/page-header.tsx`). It doesn't import `Link`, because that would pull the server page into a client boundary — pass back links and right-side actions in as children.

## 10. Landing page product story

The shipped home page describes a made-up AI product-photo tool, so every section reads like a real product page rather than an ad for the template. The default order is hero → features → testimonials → pricing → faq → cta. The hero has the heading, "get started" (sign-in) and pricing links on the left, and on the right a native product preview labeled "Sample data"; product photography goes in `public/landing/`, and the images themselves contain no UI. The features use three alternating image/text rows (AI generation, payments and credits, usage history) to avoid a repetitive card grid.

Two optional sections sell a single plan: `delivery` (a purchase card for `landing.purchasePlan` next to the `landing.deliverables` list) and `timesaved` (`landing.timeSaved`). Hero and closing buttons: when there's a plan available to buy, the primary button is "Buy now · {price}" and jumps to the purchase card in the delivery section rather than going straight to checkout — the buyer sees the terms first; otherwise it is "get started", or `/demo` when `landing.demo` is on. The secondary button is a real showcase (`landing.showcaseUrl`, new tab), the demo, the delivery card or pricing, in that order. The "time saved" section uses a light band and a `sticker-lg` checklist card, with hours right-aligned in tabular figures, a 2px solid rule above the total row, and the conclusion in `--primary-text`. No countdowns, remaining-copies counters or struck-through original prices.

The new `.landing-frame` surface uses an outline with `--edge: var(--primary-edge)` and a 3px hard lip. The last sentence of the Chinese main heading uses `--primary-text`; the English heading may wrap naturally. On mobile it's a single column and the credits card returns to the document flow.

Light / dark / system theme, language switching and the home page brand-color preview are all kept. The preview calls the site-wide `brandCss` to generate both light and dark tokens, and removes the preview override once you leave the home page; the light/dark preference is still persisted by the existing theme component.

The testimonials section uses the brand light band and sticker cards, in 3 / 2 / 1 columns read top to bottom; cards support short quotes, images and native video. Empty lists are filtered out before adjacent bands are calculated. Sample testimonials are labeled one by one; product photography is illustrative only and isn't presented as evidence of user results.
