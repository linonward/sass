import type { NextConfig } from "next";
import { withContentCollections } from "@content-collections/next";
import createNextIntlPlugin from "next-intl/plugin";

// 在 dev / build 启动时校验 site.config.ts 与环境变量，出错立即失败。
import "./site.config";
import "./src/core/env";

const withNextIntl = createNextIntlPlugin("./src/core/i18n/request.ts");

const nextConfig: NextConfig = {/* config options here */};

// withContentCollections 返回 Promise，必须放在最外层。它在 dev / build 时生成 content/blog 的文章数据。
export default withContentCollections(withNextIntl(nextConfig));
