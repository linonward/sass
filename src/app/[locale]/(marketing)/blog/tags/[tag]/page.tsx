import { TagIndex, tagMetadata, tagParams } from "@/core/blog/pages";

type Props = PageProps<"/[locale]/blog/tags/[tag]">;

export function generateStaticParams({
  params,
}: {
  params: { locale: string };
}) {
  return tagParams(params.locale);
}

export async function generateMetadata({ params }: Props) {
  const { locale, tag } = await params;
  return tagMetadata(locale, tag, 1);
}

export default async function BlogTagPage({ params }: Props) {
  const { locale, tag } = await params;
  return <TagIndex locale={locale} tag={tag} page={1} />;
}
