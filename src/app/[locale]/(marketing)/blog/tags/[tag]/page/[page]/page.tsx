import { notFound } from "next/navigation";

import { TagIndex, tagMetadata, tagPageParams } from "@/core/blog/pages";
import { parsePageParam } from "@/core/blog/posts";

type Props = PageProps<"/[locale]/blog/tags/[tag]/page/[page]">;

export function generateStaticParams({
  params,
}: {
  params: { locale: string; tag: string };
}) {
  return tagPageParams(params.locale, params.tag);
}

export async function generateMetadata({ params }: Props) {
  const { locale, tag, page } = await params;
  const number = parsePageParam(page);
  return number ? tagMetadata(locale, tag, number) : {};
}

export default async function BlogTagPaginatedPage({ params }: Props) {
  const { locale, tag, page } = await params;
  const number = parsePageParam(page) ?? notFound();
  return <TagIndex locale={locale} tag={tag} page={number} />;
}
