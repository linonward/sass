#!/usr/bin/env node
/**
 * 检查站点域名的 TLS 证书还剩多少天到期，不足阈值时以非零退出码结束。
 *
 * 用法：node scripts/check-tls-expiry.mjs [--hosts a.example.com,b.example.com] [--days 30]
 *      SSL_CHECK_HOSTS=a.example.com SSL_CHECK_DAYS=30 node scripts/check-tls-expiry.mjs
 *
 * 默认检查 site.config.ts 里的 domain（可被 SITE_DOMAIN 环境变量覆盖，和站点运行时一致），
 * 阈值 30 天。.github/workflows/tls-expiry.yml 每天调用一次：剩余不足时开 issue，并让这次运行失败。
 */
import { readFile } from "node:fs/promises";
import { connect } from "node:tls";
import process from "node:process";

const DEFAULT_DAYS = 30;
const TIMEOUT_MS = 15_000;
const MS_PER_DAY = 86_400_000;
// site.config.ts 出厂的占位域名，检查它等于什么都没检查。
const PLACEHOLDER_DOMAIN = /(^|\.)example\.(com|org|net)$/;

const usage = `用法：node scripts/check-tls-expiry.mjs [选项]

选项：
  --hosts <a,b>   要检查的主机，逗号或空格分隔；默认取 site.config.ts 的 domain
  --days <n>      剩余不足多少天算告警，默认 ${DEFAULT_DAYS}
  -h, --help      显示这段说明

也可以直接用环境变量：SSL_CHECK_HOSTS、SSL_CHECK_DAYS（配置里的域名被 SITE_DOMAIN 覆盖时，这里也要设成同一个值）。`;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--hosts" || arg === "--days") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} 后面缺少值`);
      options[arg === "--hosts" ? "hosts" : "days"] = value;
      index += 1;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`未知参数：${arg}`);
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
 * 站点域名以 site.config.ts 为准（SITE_DOMAIN 覆盖时以它为准），
 * 找不到就报错而不是静默跳过检查。
 */
async function hostsFromConfig() {
  const overridden = splitHosts(process.env.SITE_DOMAIN);
  if (overridden.length > 0) return overridden;
  const configUrl = new URL("../site.config.ts", import.meta.url);
  const source = await readFile(configUrl, "utf8");
  const match = source.match(
    /^\s*domain:\s*(?:process\.env\.SITE_DOMAIN\s*\?\?\s*)?["']([^"']+)["']/m,
  );
  if (!match) {
    throw new Error(
      "在 site.config.ts 里找不到 domain，请用 --hosts、SSL_CHECK_HOSTS 或 SITE_DOMAIN 指定要检查的主机",
    );
  }
  if (PLACEHOLDER_DOMAIN.test(match[1])) {
    throw new Error(
      `site.config.ts 里的 domain 还是占位值（${match[1]}）。改成自己的域名，或用 SITE_DOMAIN / --hosts / SSL_CHECK_HOSTS 指定要检查的主机`,
    );
  }
  return [match[1]];
}

/** 连上去读证书，拿到的是 notAfter（形如 "Dec 24 07:59:16 2026 GMT"）。 */
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

    socket.setTimeout(TIMEOUT_MS, () => settle(new Error("连接超时")));
    socket.once("error", (error) => settle(error));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      if (!certificate?.valid_to) settle(new Error("没有拿到证书"));
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
  console.error(`--days 需要一个整数，收到的是：${rawDays}`);
  process.exit(2);
}

const requested = splitHosts(options.hosts ?? process.env.SSL_CHECK_HOSTS);
const hosts = requested.length > 0 ? requested : await hostsFromConfig();

console.log(`检查 ${hosts.length} 个主机的证书，剩余不足 ${days} 天时告警。`);

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
      console.log(`✅ ${host}：证书 ${expiresOn} 到期，剩余 ${remaining} 天`);
    } else {
      alerts += 1;
      console.log(`⚠️ ${host}：证书 ${expiresOn} 到期，只剩 ${remaining} 天`);
    }
  } catch (error) {
    alerts += 1;
    console.log(`❌ ${host}：检查失败——${error.message}`);
  }
}

if (alerts > 0) {
  console.log(`\n${alerts} 个主机需要处理：要么证书快到期了，要么连接不上。`);
  process.exit(1);
}

console.log("\n所有主机的证书都在有效期内。");
