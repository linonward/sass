import { PostPage, postMetadata, postParams } from "@/core/blog/pages";

type Props = PageProps<"/[locale]/blog/[slug]">;

// 构建时预渲染全部文章。其他 slug（含生产环境的草稿）由页面里的 notFound() 返回 404。
// 不用 dynamicParams = false：它会让每个 404 在服务端日志里打一条 NoFallbackError。

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
