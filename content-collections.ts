import { readdirSync } from "node:fs";
import path from "node:path";

import { defineCollection, defineConfig } from "@content-collections/core";
import { compileMDX } from "@content-collections/mdx";
import { z } from "zod";

import {
  changelogFrontmatterSchema,
  summarize,
} from "./src/core/changelog/frontmatter";

// Post path content/blog/<locale>/<slug>.mdx: the directory name is the locale, the file name is
// the slug in the URL.
const localePattern = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Slugs that collide with fixed routes under /blog would be unreachable.
const reservedSlugs = new Set(["page", "tags"]);

const directory = "content/blog";
const changelogDirectory = "content/changelog";

/**
 * content-collections parses the first batch of files before its logging is registered, so files
 * with broken frontmatter (for example an unquoted ": " in a value) are silently dropped. This
 * checks that every file on disk made it into the collection and fails the build if any is
 * missing. In development it only logs the error: in watch mode a changed file that fails reports
 * its own error, so there's no need to stop the dev server.
 *
 * `nested`: blog is split into per-locale directories (`<locale>/<slug>.mdx`), changelog is flat
 * (`<slug>.mdx`).
 */
function assertAllFilesBuilt(
  directory: string,
  documents: { _meta: { filePath: string } }[],
  { nested }: { nested: boolean },
) {
  const built = new Set(documents.map((doc) => doc._meta.filePath));
  const files = nested
    ? readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((dir) =>
          readdirSync(path.join(directory, dir.name)).map(
            (file) => `${dir.name}/${file}`,
          ),
        )
    : readdirSync(directory);
  const missing = files
    .filter((file) => file.endsWith(".mdx"))
    .filter((file) => !built.has(file));
  if (missing.length === 0) return;

  const message = `content-collections skipped ${missing.map((file) => `${directory}/${file}`).join(", ")}. Check the frontmatter: it must be valid YAML (quote values that contain ": ") and match the schema in content-collections.ts.`;
  if (process.env.NODE_ENV === "development") console.error(message);
  else throw new Error(message);
}

const posts = defineCollection({
  name: "posts",
  directory,
  include: "*/*.mdx",
  schema: z.object({
    title: z.string().trim().min(1),
    // Summary on the list page, meta description, and RSS description.
    description: z.string().trim().min(1),
    // Publication date, e.g. 2026-01-31.
    date: z.iso.date(),
    // Lowercase kebab-case, used directly as the /blog/tags/<tag> path.
    tags: z
      .array(
        z
          .string()
          .regex(slugPattern, 'must be lowercase kebab-case such as "product"'),
      )
      .default([]),
    // An image under public/, e.g. /blog/hello-world.png. Only shown on the page; the social share
    // image is generated in code.
    cover: z
      .string()
      .regex(/^\/(?!\/)/, 'must be a path under public/ such as "/blog/a.png"')
      .optional(),
    // Drafts are only visible in development; in production builds they return 404.
    draft: z.boolean().default(false),
    content: z.string(),
  }),
  transform: async (document, context) => {
    const { directory: locale, fileName } = document._meta;
    const slug = fileName.replace(/\.mdx$/, "");
    if (!localePattern.test(locale)) {
      throw new Error(`content/blog/${locale}: directory must be a locale`);
    }
    if (!slugPattern.test(slug) || reservedSlugs.has(slug)) {
      throw new Error(
        `content/blog/${locale}/${fileName}: file name must be a lowercase kebab-case slug other than ${[...reservedSlugs].join(", ")}`,
      );
    }
    const mdx = await compileMDX(context, document);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { content, ...rest } = document;
    return { ...rest, locale, slug, mdx };
  },
  onSuccess: (documents) =>
    assertAllFilesBuilt(directory, documents, { nested: true }),
});

// Entry path content/changelog/<slug>.mdx: the file name is the anchor on the page (and in RSS).
// Not split by locale: there's usually only one changelog, and the page chrome follows the current
// locale (the same tradeoff as the legal pages).
const changelog = defineCollection({
  name: "changelog",
  directory: changelogDirectory,
  include: "*.mdx",
  schema: changelogFrontmatterSchema,
  transform: async (document, context) => {
    const { fileName } = document._meta;
    const slug = fileName.replace(/\.mdx$/, "");
    if (!slugPattern.test(slug)) {
      throw new Error(
        `content/changelog/${fileName}: file name must be a lowercase kebab-case slug`,
      );
    }
    const mdx = await compileMDX(context, document);
    // The body isn't kept in the collection (the page uses the compiled mdx), but the description
    // fallback needs the raw body.
    const { content, ...rest } = document;
    return {
      ...rest,
      slug,
      description: document.description ?? summarize(content),
      mdx,
    };
  },
  onSuccess: (documents) =>
    assertAllFilesBuilt(changelogDirectory, documents, { nested: false }),
});

export default defineConfig({
  content: [posts, changelog],
});
