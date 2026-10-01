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

- `site.json` 的 `blog.noIndex: true`：博客还是模板自带的示例文章，售卖站上整块 noindex，并从 sitemap 和 llms.txt 里拿掉。有了真实文章后删掉这一项。

`messages/*.json` 里的 `Landing.pricing` 和 `Billing.pricing.metaDescription` 覆盖 `/pricing` 的文案。售卖站只上架 `lifetime`（生产环境 `SITE_HIDDEN_PLANS=free,pro`），所以 `features.credits2000` / `coreFeatures` / `lifetimeUpdates` 这三个 key 的文案改成了模板交付内容（源码、文档示例、一年更新）。key 名沿用 `site.config.ts` 里 lifetime 套餐的 features，不要按字面理解；以后放出 free / pro 时要一起改这几条。

改售卖站首页文案或区块，只改这里，不要改 `site.config.ts` / `messages/` 的默认值。本地预览：`SITE_OVERLAY_DIR=seller pnpm dev`。

## 环境变量

环境变量以飞书多维表格为准，同步脚本和用法都在 Claude Code skill [`.claude/skills/env-sync/`](../.claude/skills/env-sync/SKILL.md) 里（同样不随包）。
