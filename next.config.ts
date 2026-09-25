import type { NextConfig } from "next";

// 在 dev / build 启动时校验 site.config.ts 与环境变量，出错立即失败。
import "./site.config";
import "./src/core/env";

const nextConfig: NextConfig = {/* config options here */};

export default nextConfig;
