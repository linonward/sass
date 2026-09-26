import { ChevronLeft, ChevronRight, Rss } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import Image from "next/image";

import { Link } from "@/core/i18n/navigation";
import { bandBg } from "@/core/marketing/sections/band";
import { Wave } from "@/core/marketing/sections/wave";
import { localizedPath } from "@/core/seo/urls";
import { buttonVariants } from "@/core/ui/button";

import {
  feedPath,
  pagePath,
  postPath,
  tagPath,
  type Post,
  type PostPage,
} from "./posts";

export function PostDate({ date }: { date: string }) {
  const format = useFormatter();
  return (
    <time dateTime={date}>
      {format.dateTime(new Date(`${date}T00:00:00Z`), {
        dateStyle: "long",
        timeZone: "UTC",
      })}
    </time>
  );
}

export function DraftBadge() {
  const t = useTranslations("Blog");
  return (
    <span className="rounded-md border border-dashed px-1.5 py-0.5 text-xs font-medium">
      {t("draft")}
    </span>
  );
}

export function TagLinks({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag}>
          {/* 标签是贴着卡片的独立小物件，所以用贴纸而不是纯底色块。 */}
          <Link
            href={tagPath(tag)}
            className="bg-muted text-muted-foreground hover:text-primary-text sticker rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors"
          >
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PostCard({ post }: { post: Post }) {
  return (
    <article className="bg-card sticker group flex flex-1 flex-col overflow-hidden rounded-xl">
      {post.cover && (
        // 封面顶到卡片边缘，圆角交给卡片的 overflow-hidden 裁。
        <div className="bg-muted relative aspect-[1200/630] border-b">
          <Image
            src={post.cover}
            alt=""
            fill
            sizes="(min-width: 1024px) 352px, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-6">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <PostDate date={post.date} />
          {post.draft && <DraftBadge />}
        </div>
        <h2 className="heading-display text-xl">
          <Link
            href={postPath(post.slug)}
            className="group-hover:text-primary-text transition-colors"
          >
            {post.title}
          </Link>
        </h2>
        <p className="text-muted-foreground line-clamp-3 text-pretty">
          {post.description}
        </p>
        {/* mt-auto 把标签压到卡片底边，同一行里正文长短不一时卡片仍对齐。 */}
        <div className="mt-auto pt-1">
          <TagLinks tags={post.tags} />
        </div>
      </div>
    </article>
  );
}

function Pagination({
  basePath,
  page,
  totalPages,
}: {
  basePath: string;
  page: number;
  totalPages: number;
}) {
  const t = useTranslations("Blog");
  if (totalPages <= 1) return null;
  // 营销面的按钮是 44px 的，翻页也是要点的东西，跟着走。
  const link = buttonVariants({ variant: "outline", size: "marketing" });

  return (
    <nav
      aria-label={t("pagination")}
      className="mt-12 flex items-center justify-between gap-4 border-t pt-8"
    >
      {page > 1 ? (
        <Link href={pagePath(basePath, page - 1)} className={link} rel="prev">
          <ChevronLeft />
          {t("newer")}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground text-sm">
        {t("pageOf", { page, total: totalPages })}
      </span>
      {page < totalPages ? (
        <Link href={pagePath(basePath, page + 1)} className={link} rel="next">
          {t("older")}
          <ChevronRight />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export type PostListProps = {
  title: string;
  description: string;
  /** 分页的基础路径：/blog 或 /blog/tags/<tag>。 */
  basePath: string;
  data: PostPage;
};

/**
 * 博客列表页和标签页共用的布局：页头色带、文章网格、分页。
 *
 * 走营销面的语域（`docs/design.md` §4.5）：页头压在浅色带上，波浪过渡到画布，
 * 文章是贴纸卡片。它自带色带所以不套 `(marketing)/layout.tsx` 里的任何容器。
 */
export function PostList({
  title,
  description,
  basePath,
  data,
}: PostListProps) {
  const t = useTranslations("Blog");
  const locale = useLocale();

  return (
    <>
      <section className={bandBg.tint}>
        <div className="container-marketing py-14 sm:py-20">
          <header className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <h1 className="heading-display text-4xl sm:text-5xl">{title}</h1>
              <p className="text-muted-foreground mt-4 text-lg text-pretty">
                {description}
              </p>
            </div>
            {/* RSS 是 route handler，用普通链接，不走客户端路由。 */}
            <a
              href={localizedPath(locale, feedPath)}
              className={buttonVariants({
                variant: "outline",
                size: "marketing",
              })}
            >
              <Rss />
              {t("rss")}
            </a>
          </header>
        </div>
      </section>
      <section className={bandBg.canvas}>
        <Wave from="tint" />
        <div className="container-marketing pt-8 pb-14 sm:pt-10 sm:pb-20">
          {data.posts.length === 0 ? (
            <p className="bg-card sticker text-muted-foreground rounded-xl p-12 text-center">
              {t("empty")}
            </p>
          ) : (
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">
              {data.posts.map((post) => (
                <li key={post.slug} className="flex">
                  <PostCard post={post} />
                </li>
              ))}
            </ul>
          )}
          <Pagination
            basePath={basePath}
            page={data.page}
            totalPages={data.totalPages}
          />
        </div>
      </section>
    </>
  );
}
