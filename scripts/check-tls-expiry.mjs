#!/usr/bin/env node
/**
 * Checks how many days are left before the site domain's TLS certificate expires, and exits non-zero
 * when it is below the threshold.
 *
 * Usage: node scripts/check-tls-expiry.mjs [--hosts a.example.com,b.example.com] [--days 30]
 *        SSL_CHECK_HOSTS=a.example.com SSL_CHECK_DAYS=30 node scripts/check-tls-expiry.mjs
 *
 * By default it checks the domain in site.config.ts (overridable with the SITE_DOMAIN env var, same
 * as the site runtime) with a 30-day threshold. .github/workflows/tls-expiry.yml runs it daily: when
 * too few days remain it opens an issue and fails the run.
 */
import { readFile } from "node:fs/promises";
import { connect } from "node:tls";
import process from "node:process";

const DEFAULT_DAYS = 30;
const TIMEOUT_MS = 15_000;
const MS_PER_DAY = 86_400_000;
// The placeholder domain site.config.ts ships with; checking it is the same as checking nothing.
const PLACEHOLDER_DOMAIN = /(^|\.)example\.(com|org|net)$/;

const usage = `Usage: node scripts/check-tls-expiry.mjs [options]

Options:
  --hosts <a,b>   hosts to check, comma- or space-separated; defaults to the domain in site.config.ts
  --days <n>      alert when fewer than this many days remain, default ${DEFAULT_DAYS}
  -h, --help      show this help

You can also use environment variables: SSL_CHECK_HOSTS, SSL_CHECK_DAYS (when SITE_DOMAIN overrides the configured domain, set this to the same value too).`;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--hosts" || arg === "--days") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} is missing a value`);
      options[arg === "--hosts" ? "hosts" : "days"] = value;
      index += 1;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function splitHosts(value) {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((host) => host.trim())
    .filter(Boolean);
}

/**
 * The site domain comes from site.config.ts (or SITE_DOMAIN when it overrides it); if none is found,
 * throw instead of silently skipping the check.
 */
async function hostsFromConfig() {
  const overridden = splitHosts(process.env.SITE_DOMAIN);
  if (overridden.length > 0) return overridden;
  const configUrl = new URL("../site.config.ts", import.meta.url);
  const source = await readFile(configUrl, "utf8");
  // The shipped form is `envOverride("SITE_DOMAIN") ?? placeholder literal`; also accept a buyer's
  // hand-written `domain: "their-domain"`.
  const domain =
    source.match(
      /^\s*domain:\s*(?:envOverride\(\s*["']SITE_DOMAIN["']\s*\)|process\.env\.SITE_DOMAIN)\s*\?\?\s*["']([^"']+)["']/m,
    )?.[1] ?? source.match(/^\s*domain:\s*["']([^"']+)["']/m)?.[1];
  if (!domain) {
    throw new Error(
      "No domain found in site.config.ts; specify the hosts to check with --hosts, SSL_CHECK_HOSTS or SITE_DOMAIN",
    );
  }
  if (PLACEHOLDER_DOMAIN.test(domain)) {
    throw new Error(
      `The domain in site.config.ts is still the placeholder (${domain}). Change it to your own domain, or specify the hosts to check with SITE_DOMAIN / --hosts / SSL_CHECK_HOSTS`,
    );
  }
  return [domain];
}

/** Connects and reads the certificate; returns notAfter (like "Dec 24 07:59:16 2026 GMT"). */
function readCertificate(host) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: 443, servername: host });
    let settled = false;
    const settle = (error, validTo) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(validTo);
    };

    socket.setTimeout(TIMEOUT_MS, () =>
      settle(new Error("connection timed out")),
    );
    socket.once("error", (error) => settle(error));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      if (!certificate?.valid_to) settle(new Error("no certificate received"));
      else settle(null, certificate.valid_to);
    });
  });
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n\n${usage}`);
  process.exit(2);
}

if (options.help) {
  console.log(usage);
  process.exit(0);
}

const rawDays = options.days ?? process.env.SSL_CHECK_DAYS;
const days =
  rawDays === undefined || rawDays === ""
    ? DEFAULT_DAYS
    : Number.parseInt(rawDays, 10);
if (!Number.isFinite(days)) {
  console.error(`--days needs an integer, got: ${rawDays}`);
  process.exit(2);
}

const requested = splitHosts(options.hosts ?? process.env.SSL_CHECK_HOSTS);
const hosts = requested.length > 0 ? requested : await hostsFromConfig();

console.log(
  `Checking certificates for ${hosts.length} host(s); alerting when fewer than ${days} days remain.`,
);

let alerts = 0;
for (const host of hosts) {
  try {
    const validTo = await readCertificate(host);
    const expiresAt = new Date(validTo);
    const remaining = Math.floor(
      (expiresAt.getTime() - Date.now()) / MS_PER_DAY,
    );
    const expiresOn = expiresAt.toISOString().slice(0, 10);
    if (remaining >= days) {
      console.log(
        `✅ ${host}: certificate expires ${expiresOn}, ${remaining} days left`,
      );
    } else {
      alerts += 1;
      console.log(
        `⚠️ ${host}: certificate expires ${expiresOn}, only ${remaining} days left`,
      );
    }
  } catch (error) {
    alerts += 1;
    console.log(`❌ ${host}: check failed — ${error.message}`);
  }
}

if (alerts > 0) {
  console.log(
    `\n${alerts} host(s) need attention: either the certificate is about to expire or the host is unreachable.`,
  );
  process.exit(1);
}

console.log("\nAll host certificates are within their validity window.");
