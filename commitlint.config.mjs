// 提交信息用 Conventional Commits，由 .husky/commit-msg 检查。
// 例如：feat(i18n): add locale switcher、fix: 修复登录跳转。合并提交（Merge ...）会被跳过。
//
// 先赋值再导出（同 eslint.config.mjs）：匿名默认导出会触发 next 预设里的
// import/no-anonymous-default-export —— 那条规则本意冲着 React 组件去，
// 但既然本仓库已有这个写法，跟齐比逐个文件豁免省事。
const config = {
  extends: ["@commitlint/config-conventional"],
};

export default config;
