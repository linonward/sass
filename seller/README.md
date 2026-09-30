# seller/：OnwardKit 售卖站首页

这个目录只给 OnwardKit 官方售卖站用，**不随发行包交付**（`scripts/release-package.sh` 的 `exclude_paths` 排除了它）。

买家拿到的默认首页是 `site.config.ts` 的 `landing` / `nav` 和 `messages/*.json` 的 `Landing.*`：一个虚构的 AI 商品图工具 Acme。售卖站在部署环境里设：

```
SITE_OVERLAY_DIR=seller
SITE_DESCRIPTION=The starter kit for your AI business.
```

加载逻辑在 `src/core/config/overlay.ts`：

- `site.json` 的 `landing`、`nav` 整段替换 `site.config.ts` 的同名配置，用同一个 schema 校验，写错启动即报错。
- `messages/<locale>.json` 深合并到 `messages/<locale>.json` 上，只写要覆盖的 key。

改售卖站首页文案或区块，只改这里，不要改 `site.config.ts` / `messages/` 的默认值。本地预览：`SITE_OVERLAY_DIR=seller pnpm dev`。
