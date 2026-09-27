import { ChangelogPage, changelogMetadata } from "@/core/changelog/pages";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/changelog">) {
  return changelogMetadata((await params).locale);
}

export default function Changelog() {
  return <ChangelogPage />;
}
