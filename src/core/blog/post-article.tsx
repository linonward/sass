import { MDXContent } from "@content-collections/mdx/react";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";

import { Link } from "@/core/i18n/navigation";
import { JsonLd } from "@/core/seo/json-ld";

import { postJsonLd } from "./json-ld";
import { blogPath, type Post } from "./posts";
import { DraftBadge, PostDate, TagLinks } from "./post-list";

/** 文章页：标题区、封面、MDX 正文（@tailwindcss/typography 排版）和 BlogPosting 结构化数据。 */
export function PostArticle({ post }: { post: Post }) {
  const t = useTranslations("Blog");

  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <JsonLd data={postJsonLd(post, post.locale)} />
      <Link
        href={blogPath}
        className="text-muted-foreground hover:text-primary inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>
      <header className="mt-8 space-y-4 border-b pb-8">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <PostDate date={post.date} />
          {post.draft && <DraftBadge />}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {post.title}
        </h1>
        <p className="text-muted-foreground text-lg">{post.description}</p>
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
      {/* typography 默认给行内代码加反引号、给引用加引号和斜体，这里去掉，行内代码改成底色块。 */}
      <div className="prose prose-neutral dark:prose-invert prose-a:text-primary prose-a:underline-offset-4 prose-headings:tracking-tight prose-headings:scroll-mt-20 prose-pre:border prose-code:before:content-none prose-code:after:content-none prose-blockquote:font-normal prose-blockquote:not-italic [&_:not(pre)>code]:bg-muted mt-10 max-w-none [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-medium [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none">
        <MDXContent code={post.mdx} />
      </div>
    </article>
  );
}
