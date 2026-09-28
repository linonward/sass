// 提交前只检查暂存的文件（.husky/pre-commit）。
// 两组 glob 互不重叠，避免 ESLint 和 Prettier 并行改同一个文件。
const code = "*.{js,mjs,cjs,ts,tsx,mts,cts}";

// 先赋值再导出，同 eslint.config.mjs / commitlint.config.mjs。
const config = {
  [code]: ["eslint --fix --no-warn-ignored", "prettier --write"],
  [`!(${code})`]: "prettier --write --ignore-unknown",
};

export default config;
