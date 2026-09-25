import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// 在 dev / build 启动时校验 site.config.ts 与环境变量，出错立即失败。
import "./site.config";
import "./src/core/env";

const withNextIntl = createNextIntlPlugin("./src/core/i18n/request.ts");

const nextConfig: NextConfig = {/* config options here */};

export default withNextIntl(nextConfig);
