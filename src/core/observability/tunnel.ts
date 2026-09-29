// Tunnel route for Sentry browser events (tunnelRoute in next.config.ts). The matcher in proxy.ts
// must skip it; otherwise it gets a locale prefix or a redirect to the sign-in page.
export const SENTRY_TUNNEL_ROUTE = "/monitoring";
