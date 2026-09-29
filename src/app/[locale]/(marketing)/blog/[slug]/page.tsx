import { PostPage, postMetadata, postParams } from "@/core/blog/pages";

type Props = PageProps<"/[locale]/blog/[slug]">;

// Prerender every post at build time. Any other slug (including drafts in production) gets a 404
// from notFound() in the page. We don't use dynamicParams = false: it logs a NoFallbackError on the
// server for every 404.

export function generateStaticParams({
  params,
}: {
  params: { locale: string };
}) {
  return postParams(params.locale);
}

export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  return postMetadata(locale, slug);
}

export default async function BlogPostPage({ params }: Props) {
  const { locale, slug } = await params;
  return <PostPage locale={locale} slug={slug} />;
}
