import { readdirSync } from "node:fs";
import path from "node:path";

import { defineCollection, defineConfig } from "@content-collections/core";
import { compileMDX } from "@content-collections/mdx";
import { z } from "zod";

// 文章路径 content/blog/<locale>/<slug>.mdx：目录名是语言，文件名是 URL 里的 slug。
const localePattern = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// 与 /blog 下的固定路由重名的 slug 访问不到。
const reservedSlugs = new Set(["page", "tags"]);

const directory = "content/blog";

/**
 * content-collections 在注册日志之前就解析了首批文件，frontmatter 写错（例如值里有未加引号的 ": "）
 * 的文章会被静默丢弃。这里核对磁盘上的文件是否都进了集合，缺了就让构建失败。
 * 开发环境只打印错误：watch 模式下改动的文件出错时本身会报错，不必中断 dev server。
 */
function assertAllFilesBuilt(documents: { _meta: { filePath: string } }[]) {
  const built = new Set(documents.map((doc) => doc._meta.filePath));
  const missing = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) =>
      readdirSync(path.join(directory, dir.name))
        .filter((file) => file.endsWith(".mdx"))
        .map((file) => `${dir.name}/${file}`),
    )
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
    // 列表页摘要、meta description 和 RSS 描述。
    description: z.string().trim().min(1),
    // 发布日期，例如 2026-01-31。
    date: z.iso.date(),
    // 小写 kebab-case，直接用作 /blog/tags/<tag> 的路径。
    tags: z
      .array(
        z
          .string()
          .regex(slugPattern, 'must be lowercase kebab-case such as "product"'),
      )
      .default([]),
    // public/ 下的图片，例如 /blog/hello-world.png。只用于页面展示，分享图由代码生成。
    cover: z
      .string()
      .regex(/^\/(?!\/)/, 'must be a path under public/ such as "/blog/a.png"')
      .optional(),
    // 草稿只在开发环境可见，生产构建里访问返回 404。
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
  onSuccess: (documents) => assertAllFilesBuilt(documents),
});

export default defineConfig({
  content: [posts],
});
