import siteConfig from "../../../site.config";

/**
 * Replaces the site domain inside a value with a fixed placeholder (`<domain>`), for snapshots.
 *
 * sitemap / robots / RSS output is full of absolute URLs, so snapshotting it directly would force
 * buyers to run `pnpm test -u` as soon as they change `domain`. Passed through this function, the
 * snapshot pins only structure and paths, and the domain follows the config. Assertions
 * (`toContain`, `toEqual`) don't need it: just interpolate `${siteConfig.domain}` there.
 */
export function withoutSiteDomain<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value).replaceAll(
      `https://${siteConfig.domain}`,
      "https://<domain>",
    ),
  );
}
