import { notFound } from "next/navigation";

import {
  BlogIndex,
  blogIndexMetadata,
  blogPageParams,
} from "@/core/blog/pages";
import { parsePageParam } from "@/core/blog/posts";

type Props = PageProps<"/[locale]/blog/page/[page]">;

export function generateStaticParams({
  params,
}: {
  params: { locale: string };
}) {
  return blogPageParams(params.locale);
}

export async function generateMetadata({ params }: Props) {
  const { locale, page } = await params;
  const number = parsePageParam(page);
  return number ? blogIndexMetadata(locale, number) : {};
}

export default async function BlogPaginatedPage({ params }: Props) {
  const { locale, page } = await params;
  const number = parsePageParam(page) ?? notFound();
  return <BlogIndex locale={locale} page={number} />;
}
