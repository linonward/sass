import { ChevronLeft, ChevronRight, Rss } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import Image from "next/image";

import { Link } from "@/core/i18n/navigation";
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
          <Link
            href={tagPath(tag)}
            className="bg-muted text-muted-foreground hover:text-primary rounded-md px-2 py-0.5 text-xs font-medium transition-colors"
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
    <article className="group relative flex flex-col gap-3">
      {post.cover && (
        <div className="bg-muted relative aspect-[1200/630] overflow-hidden rounded-xl border">
          <Image
            src={post.cover}
            alt=""
            fill
            sizes="(min-width: 1024px) 352px, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      )}
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <PostDate date={post.date} />
        {post.draft && <DraftBadge />}
      </div>
      <h2 className="text-xl font-semibold tracking-tight">
        <Link
          href={postPath(post.slug)}
          className="group-hover:text-primary transition-colors"
        >
          {post.title}
        </Link>
      </h2>
      <p className="text-muted-foreground line-clamp-3">{post.description}</p>
      <TagLinks tags={post.tags} />
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
  const link = buttonVariants({ variant: "outline" });

  return (
    <nav
      aria-label={t("pagination")}
      className="mt-12 flex items-center justify-between gap-4 border-t pt-6 text-sm"
    >
      {page > 1 ? (
        <Link href={pagePath(basePath, page - 1)} className={link} rel="prev">
          <ChevronLeft />
          {t("newer")}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
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

/** 博客列表页和标签页共用的布局：标题、文章网格、分页。 */
export function PostList({
  title,
  description,
  basePath,
  data,
}: PostListProps) {
  const t = useTranslations("Blog");
  const locale = useLocale();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-8">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="text-muted-foreground max-w-2xl">{description}</p>
        </div>
        {/* RSS 是 route handler，用普通链接，不走客户端路由。 */}
        <a
          href={localizedPath(locale, feedPath)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <Rss />
          {t("rss")}
        </a>
      </header>
      {data.posts.length === 0 ? (
        <p className="text-muted-foreground py-16 text-center">{t("empty")}</p>
      ) : (
        <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {data.posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      )}
      <Pagination
        basePath={basePath}
        page={data.page}
        totalPages={data.totalPages}
      />
    </div>
  );
}
