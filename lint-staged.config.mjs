// Before each commit, only staged files are checked (.husky/pre-commit).
// The two globs don't overlap, so ESLint and Prettier never edit the same file in parallel.
const code = "*.{js,mjs,cjs,ts,tsx,mts,cts}";

// Assigned first, then exported, same as eslint.config.mjs / commitlint.config.mjs.
const config = {
  [code]: ["eslint --fix --no-warn-ignored", "prettier --write"],
  [`!(${code})`]: "prettier --write --ignore-unknown",
};

export default config;
