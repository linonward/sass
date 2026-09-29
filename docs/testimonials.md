# Landing 用户故事配置

在 `site.config.ts` 的 `landing.sections` 中加入 `testimonials`，建议放在 features 与 delivery 之间。移除该 ID 或将 `landing.testimonials.items` 设为空数组即可关闭；卡片按 items 顺序向下、再向右阅读，窄屏保持相同顺序。

默认六项均为示例文案，`example: true` 会逐条显示「示例评价」，区块也会提示非真实用户评价。图片是既有产品摄影，不是客户成果。替换成获得授权的真实文案与素材后逐条删除 example。没有真实内容时可清空 items，不用编造人数或评分。

```ts
// site.config.ts → landing
// 卡片的作者名称、素材和原始出处在这里；正文与身份介绍按 key 查 messages。
testimonials: {
  items: [
    { key: "focus", type: "quote", author: { name: "Your customer" } },
    {
      key: "launch",
      type: "image",
      author: { name: "Your customer", avatar: "/testimonials/avatar.webp" },
      media: { src: "/testimonials/product.webp", width: 1200, height: 800 },
      sourceUrl: "https://example.com/original-feedback",
    },
    {
      key: "story",
      type: "video",
      author: { name: "Your customer" },
      media: {
        src: "/testimonials/story.mp4",
        poster: "/testimonials/story.webp",
        width: 720,
        height: 1280,
        captions: [
          { src: "/testimonials/story.en.vtt", srcLang: "en", label: "English" },
        ],
      },
    },
  ],
},
```

素材先放进 `public/testimonials/` 再填写路径，宽高填写实际尺寸。图片默认按 16:10 裁切，视频保留配置比例；视频使用浏览器原生播放/暂停/音量/字幕控件，支持键盘操作，不自动播放、不预加载视频正文。每个视频至少配置一个 WebVTT 字幕文件。这里只接受本站素材路径，不接受第三方 iframe。出处链接必须为 HTTPS。

在 `messages/en.json` 与 `messages/zh.json` 的 `Landing.testimonials.items` 为每个 key 添加：

```json
{
  "launch": {
    "quote": "用户的原话，<highlight>重点句</highlight>。",
    "role": "身份 / 产品名称",
    "imageAlt": "截图中可见的产品及内容"
  }
}
```

`quote` 与 `role` 每项必填；`imageAlt` 仅图片卡必填；高亮标签可省略。作者头像使用空 alt，避免与旁边姓名重复朗读。区块标题、说明、示例提示及视频可访问名称也在同一个翻译命名空间。新增语言时同步这些字段。
