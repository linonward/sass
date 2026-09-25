// 提交信息用 Conventional Commits（见 docs/workflow.md），由 .husky/commit-msg 检查。
// 例如：feat(i18n): add locale switcher、fix: 修复登录跳转。合并提交（Merge ...）会被跳过。
export default {
  extends: ["@commitlint/config-conventional"],
};
