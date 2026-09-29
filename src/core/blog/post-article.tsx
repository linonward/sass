import { MDXContent } from "@content-collections/mdx/react";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";

import { Link } from "@/core/i18n/navigation";
import { JsonLd } from "@/core/seo/json-ld";

import { postJsonLd } from "./json-ld";
import { blogPath, type Post } from "./posts";
import { DraftBadge, PostDate, TagLinks } from "./post-list";

/** Post page: header, cover, MDX body (typeset with @tailwindcss/typography), and BlogPosting structured data. */
export function PostArticle({ post }: { post: Post }) {
  const t = useTranslations("Blog");

  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:py-20">
      <JsonLd data={postJsonLd(post, post.locale)} />
      <Link
        href={blogPath}
        className="text-muted-foreground hover:text-primary-text inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>
      <header className="mt-8 space-y-4 border-b pb-8">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <PostDate date={post.date} />
          {post.draft && <DraftBadge />}
        </div>
        <h1 className="heading-display text-3xl sm:text-4xl">{post.title}</h1>
        <p className="text-muted-foreground text-lg text-pretty">
          {post.description}
        </p>
        <TagLinks tags={post.tags} />
      </header>
      {post.cover && (
        <div className="bg-muted relative mt-8 aspect-[1200/630] overflow-hidden rounded-xl border">
          <Image
            src={post.cover}
            alt=""
            fill
            priority
            sizes="(min-width: 768px) 720px, 100vw"
            className="object-cover"
          />
        </div>
      )}
      {/* By default typography wraps inline code in backticks and gives blockquotes quotes and
          italics; we remove those and render inline code as a tinted block. Headings use the
          display face: body and headings are distinguished by typeface contrast, not bold. */}
      <div className="prose prose-neutral dark:prose-invert prose-a:text-primary-text prose-a:underline-offset-4 prose-headings:font-display prose-headings:font-semibold prose-headings:tracking-tight prose-headings:scroll-mt-20 prose-pre:border prose-code:before:content-none prose-code:after:content-none prose-blockquote:font-normal prose-blockquote:not-italic [&_:not(pre)>code]:bg-muted mt-10 max-w-none [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-medium [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none">
        <MDXContent code={post.mdx} />
      </div>
    </article>
  );
}
