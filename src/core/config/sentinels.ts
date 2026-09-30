import type { SiteConfig } from "./schema";

/** A config value still at its shipped placeholder, which would show if the site went live. */
export type PlaceholderIssue = {
  /** Field path in the config, e.g. `legal.companyName`. */
  path: string;
  /** The shipped value itself. */
  placeholder: string;
  /** How to fix it; shown in the message. */
  hint: string;
};

/**
 * The shipped placeholder values. If the buyer launches without changing them, the site shows
 * "Acme", example.com, an example.com sender address, and support@example.com as the contact
 * address on the legal pages (and as the Reply-To of every transactional email).
 *
 * `email.fromName` is not checked on its own: site.config.ts derives it from `name` (siteName), so
 * the "Acme" sender name goes away exactly when the `name` check passes. A buyer who gives it a
 * separate literal has already chosen a sender name on purpose.
 *
 * All of these fields can be overridden by environment variables (see the top of site.config.ts),
 * so a demo site doesn't have to commit real values to the repo — and they don't end up in the
 * package shipped to buyers.
 */
export function placeholderIssues(config: SiteConfig): PlaceholderIssue[] {
  const issues: PlaceholderIssue[] = [];
  const check = (
    path: string,
    value: string | undefined,
    placeholder: string,
    hint: string,
  ) => {
    if (value === placeholder) issues.push({ path, placeholder, hint });
  };

  check(
    "name",
    config.name,
    "Acme",
    "change it to your product name (or set SITE_NAME)",
  );
  check(
    "domain",
    config.domain,
    "example.com",
    "change it to your domain (or set SITE_DOMAIN)",
  );
  check(
    "legal.companyName",
    config.legal.companyName,
    "Acme Inc.",
    "change it to your company or personal name (or set SITE_LEGAL_NAME)",
  );
  check(
    "email.fromAddress",
    config.email.fromAddress,
    "noreply@example.com",
    "change it to your sender address (or set SITE_EMAIL_FROM)",
  );
  check(
    "legal.contactEmail",
    config.legal.contactEmail,
    "support@example.com",
    "change it to the address customers can reach you at (or set SITE_CONTACT_EMAIL)",
  );
  check(
    "email.replyTo",
    config.email.replyTo,
    "support@example.com",
    "change it to the address that should receive replies (or set SITE_CONTACT_EMAIL)",
  );

  return issues;
}

/**
 * Joins the sentinel results into a readable message (the production build error and the dev
 * warning use the same text).
 */
export function placeholderMessage(issues: PlaceholderIssue[]): string {
  return [
    "The site config still has shipped placeholder values; if you launch like this, visitors will only see Acme and example.com:",
    ...issues.map(
      (issue) =>
        `  - ${issue.path} is still "${issue.placeholder}": ${issue.hint}`,
    ),
    "(A demo site can override these with the environment variables above instead of committing real values to the repo.)",
  ].join("\n");
}

/**
 * How placeholders are handled: the production build fails outright, development prints a warning,
 * and test and other environments stay quiet — every test file imports site.config.ts, and there's
 * no need to flood the output there.
 *
 * The caller acts on the return value (throw / print); this module never touches console itself,
 * since direct console use isn't allowed in src/core.
 */
export function placeholderAction(
  issues: PlaceholderIssue[],
  nodeEnv: string | undefined,
): { throwMessage?: string; warnMessage?: string } {
  if (issues.length === 0) return {};
  const message = placeholderMessage(issues);
  if (nodeEnv === "production") return { throwMessage: message };
  if (nodeEnv === "development") return { warnMessage: message };
  return {};
}

const warnedFlag = "ONWARDKIT_PLACEHOLDER_WARNING_SHOWN";

/**
 * True the first time it's called, false after that. `next dev` evaluates site.config.ts in several
 * processes (it spawns workers) and again on every route compile, so without this the placeholder
 * warning repeats for every page you open. The flag is an environment variable because child
 * processes inherit the environment when they start, while module state and globalThis are
 * per-process.
 */
export function firstPlaceholderWarning(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env[warnedFlag]) return false;
  env[warnedFlag] = "1";
  return true;
}
