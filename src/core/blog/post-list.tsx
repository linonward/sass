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
          {/* Tags are small standalone objects stuck onto the card, so they use the sticker style rather than a flat tinted block. */}
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
        // The cover runs to the card edge; the card's overflow-hidden clips the rounded corners.
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
        {/* mt-auto pushes tags to the card's bottom edge so cards in a row stay aligned when their text lengths differ. */}
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
  // Marketing-surface buttons are 44px; pagination is also a tap target, so it matches.
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
  /** Base path for pagination: /blog or /blog/tags/<tag>. */
  basePath: string;
  data: PostPage;
};

/**
 * Layout shared by the blog index and tag pages: header band, post grid, pagination.
 *
 * Uses the marketing-surface register (`docs/design.md` §4.5): the header sits on a light band
 * with a wave transition to the canvas, and posts are sticker cards. It brings its own band, so it
 * doesn't use any container from `(marketing)/layout.tsx`.
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
            {/* RSS is a route handler, so use a plain link rather than client-side routing. */}
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
