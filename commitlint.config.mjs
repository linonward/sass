// Commit messages follow Conventional Commits, checked by .husky/commit-msg.
// For example: feat(i18n): add locale switcher, fix: correct sign-in redirect. Merge commits
// (Merge ...) are skipped.
//
// Assigned first, then exported (same as eslint.config.mjs): an anonymous default export trips
// import/no-anonymous-default-export from the next preset. That rule is really aimed at React
// components, but since the repo already uses this pattern, following it is simpler than
// exempting files one by one.
const config = {
  extends: ["@commitlint/config-conventional"],
};

export default config;
