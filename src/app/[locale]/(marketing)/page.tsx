import { Landing } from "@/core/marketing/landing";

import siteConfig from "../../../../site.config";

export default function Home() {
  return <Landing config={siteConfig} />;
}
