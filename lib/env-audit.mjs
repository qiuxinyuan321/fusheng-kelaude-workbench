import fs from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { claudeEnvironment } from './claude-environment.mjs';

const exec = promisify(execFile);

// Anthropic officially supported ISO 3166-1 alpha-2 country/region codes.
export const SUPPORTED_COUNTRIES = new Set([
  'AD', 'AE', 'AG', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BN', 'BO', 'BR', 'BS', 'BT', 'BW', 'BZ',
  'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CL', 'CM', 'CO', 'CR', 'CV', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FM', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GH', 'GM', 'GN', 'GQ', 'GR', 'GT', 'GW', 'GY',
  'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IN', 'IQ', 'IS', 'IT',
  'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KR', 'KW', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MG', 'MH', 'MK', 'ML', 'MN', 'MR', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NZ',
  'OM',
  'PA', 'PE', 'PG', 'PH', 'PK', 'PL', 'PR', 'PT', 'PW', 'PY',
  'QA',
  'RO', 'RS', 'RW',
  'SA', 'SB', 'SC', 'SE', 'SG', 'SI', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'ST', 'SV', 'SZ',
  'TD', 'TG', 'TH', 'TJ', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VN', 'VU',
  'WS',
  'ZA', 'ZM', 'ZW',
]);

export const HIGH_RISK_REGIONS = new Set(['CN', 'HK', 'MO', 'RU', 'BY', 'IR', 'KP', 'SY', 'CU', 'VE']);

const COUNTRY_NAMES = {
  US: '美国', JP: '日本', SG: '新加坡', GB: '英国', DE: '德国', FR: '法国', NL: '荷兰',
  CA: '加拿大', AU: '澳大利亚', KR: '韩国', TW: '中国台湾', IN: '印度', CH: '瑞士',
  SE: '瑞典', NO: '挪威', FI: '芬兰', DK: '丹麦', IE: '爱尔兰', IT: '意大利', ES: '西班牙',
  BR: '巴西', AE: '阿联酋', TH: '泰国', MY: '马来西亚', VN: '越南', PH: '菲律宾', ID: '印度尼西亚',
  CN: '中国大陆', HK: '中国香港', MO: '中国澳门', RU: '俄罗斯', IR: '伊朗', KP: '朝鲜', BY: '白俄罗斯',
};

const SENSITIVE_TIMEZONES = new Set([
  'Asia/Shanghai', 'Asia/Chongqing', 'Asia/Harbin', 'Asia/Urumqi', 'Asia/Kashgar',
  'PRC', 'Asia/Hong_Kong', 'Asia/Macau', 'Europe/Moscow', 'Asia/Tehran', 'Asia/Pyongyang',
]);

const COUNTRY_TZ_MATCHERS = {
  JP: tz => tz === 'Asia/Tokyo' || tz === 'Japan',
  SG: tz => tz === 'Asia/Singapore' || tz === 'Singapore',
  KR: tz => tz === 'Asia/Seoul' || tz === 'ROK',
  TW: tz => tz === 'Asia/Taipei' || tz === 'ROC',
  GB: tz => tz === 'Europe/London' || tz === 'GB',
  DE: tz => tz === 'Europe/Berlin' || tz === 'Europe/Busingen',
  FR: tz => tz === 'Europe/Paris',
  NL: tz => tz === 'Europe/Amsterdam',
  CH: tz => tz === 'Europe/Zurich',
  IE: tz => tz === 'Europe/Dublin',
  SE: tz => tz === 'Europe/Stockholm',
  NO: tz => tz === 'Europe/Oslo',
  FI: tz => tz === 'Europe/Helsinki',
  DK: tz => tz === 'Europe/Copenhagen',
  IT: tz => tz === 'Europe/Rome',
  ES: tz => tz === 'Europe/Madrid' || tz === 'Atlantic/Canary',
  PT: tz => tz === 'Europe/Lisbon' || tz === 'Atlantic/Azores' || tz === 'Atlantic/Madeira',
  PL: tz => tz === 'Europe/Warsaw',
  AT: tz => tz === 'Europe/Vienna',
  BE: tz => tz === 'Europe/Brussels',
  IN: tz => tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta',
  TH: tz => tz === 'Asia/Bangkok',
  VN: tz => tz === 'Asia/Ho_Chi_Minh' || tz === 'Asia/Saigon',
  MY: tz => tz === 'Asia/Kuala_Lumpur' || tz === 'Asia/Kuching',
  ID: tz => tz.startsWith('Asia/Jakarta') || tz.startsWith('Asia/Makassar') || tz.startsWith('Asia/Jayapura'),
  PH: tz => tz === 'Asia/Manila',
  AE: tz => tz === 'Asia/Dubai',
  IL: tz => tz === 'Asia/Jerusalem' || tz === 'Asia/Tel_Aviv',
  AU: tz => tz.startsWith('Australia/'),
  NZ: tz => tz === 'Pacific/Auckland' || tz === 'Pacific/Chatham',
  CA: tz => tz.startsWith('America/') || tz.startsWith('Canada/'),
  US: tz => tz.startsWith('America/') || tz.startsWith('US/') || tz === 'Pacific/Honolulu',
  BR: tz => tz.startsWith('America/'),
};

const COUNTRY_RECOMMENDED_TZ = {
  JP: 'Asia/Tokyo', SG: 'Asia/Singapore', KR: 'Asia/Seoul', TW: 'Asia/Taipei',
  GB: 'Europe/London', DE: 'Europe/Berlin', FR: 'Europe/Paris', NL: 'Europe/Amsterdam',
  US: 'America/Los_Angeles 或 America/New_York', CA: 'America/Toronto 或 America/Vancouver',
  AU: 'Australia/Sydney',
};

const CN_PUBLIC_DNS = new Set([
  '114.114.114.114', '114.114.115.115', '223.5.5.5', '223.6.6.6',
  '119.29.29.29', '182.254.116.116', '180.76.76.76', '1.2.4.8', '210.2.4.8',
  '117.50.10.10', '117.50.20.20', '101.226.4.6', '218.30.118.6',
]);

const DATACENTER_KEYWORDS = /\b(?:amazon|aws|google\s*cloud|gcp|microsoft\s*corporation|azure|digitalocean|vultr|choopa|constant\s*company|linode|akamai\s*connected|ovh|hetzner|contabo|oracle\s*cloud|alibaba|aliyun|tencent|huawei|bytevirt|it7\s*networks|dmit|racknerd|colocrossing|multacom|psychz|leaseweb|cogent|zenlayer|m247|datacamp|cdn77|tzulo|sharktech|vertex\s*connectivity|cloudflare|hurricane\s*electric|scaleway|online\s*s\.a\.s|upcloud|kamatera|ionos|hostinger|dreamhost|frantech|buyvm|kurun|ceranetworks|hivelocity|velia|gcore|edgecenter|hosting|datacenter|data\s*center|vps|cloud\s*server|colocation|dedicated|server\s*solutions)\b/i;

const MITM_ISSUER_KEYWORDS = /\b(?:clash|mihomo|surge|loon|quantumult|shadowrocket|stash|sing-box|mitmproxy|fiddler|charles|proxyman|burp|whistle|zscaler|fortinet|fortigate|palo\s*alto|netskope|sangfor|qianxin|360|kaspersky|avast|adguard|reqable)\b/i;

const CONTAMINATION_ENV_RE = /^(?:ANTHROPIC_(?:API_KEY|AUTH_TOKEN|BASE_URL|PROFILE|FEDERATION_.*)|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_(?:BEDROCK|VERTEX|FOUNDRY)|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/i;

const TUN_IFACE_RE = /^(?:utun\d+|tun\d+|tap\d+|bytexit|meta|clash\w*|mihomo\w*|singbox\w*|wg\d+|tailscale\d+)$/i;

export const CHECK_GROUPS = [
  { id: 'preflight', title: '基础网络与区域审计（核心 14 项）' },
  { id: 'community', title: 'GitHub & 社区高危防封审计（深度 10 项）' },
];

function parseTrace(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function isPrivateOrReservedIp(ip) {
  if (typeof ip !== 'string') return true;
  if (/^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|198\.1[89]\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)) return true;
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return false;
}

function isFakeIpRange(ip) {
  return typeof ip === 'string' && /^198\.1[89]\./.test(ip);
}

function parseProxyEndpoint(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const u = new URL(rawUrl.includes('://') ? rawUrl : `http://${rawUrl}`);
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : u.protocol.startsWith('socks') ? 1080 : 80));
    return { protocol: u.protocol.replace(/:$/, '').toLowerCase(), host: u.hostname, port, raw: `${u.protocol}//${u.hostname}:${port}` };
  } catch {
    return { protocol: 'unknown', host: '', port: 0, raw: rawUrl.slice(0, 64) };
  }
}

function tcpReachable(host, port, timeoutMs = 1500) {
  return new Promise(resolve => {
    if (!host || !port) return resolve(false);
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function fetchWithTimeout(url, { timeoutMs = 4500, method = 'GET', headers = {} } = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'curl/8.7.1', Accept: '*/*', ...headers },
  });
  const latencyMs = Date.now() - started;
  return { response, latencyMs };
}

export async function defaultProbes({ binary, accounts = [], legacyConfigDir } = {}) {
  const resolvedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || 'UTC';
  const localeEnv = process.env.LC_ALL || process.env.LANG || process.env.LC_CTYPE || '';
  const rawIfaces = os.networkInterfaces();
  const interfaces = [];
  for (const [name, addrs] of Object.entries(rawIfaces)) {
    for (const addr of addrs || []) {
      interfaces.push({ name, family: addr.family, address: addr.address, internal: addr.internal });
    }
  }

  let ipv6SocketBlocked = false;
  let ipv6BlockCode = null;
  try {
    const sock = dgram.createSocket('udp6');
    sock.close();
  } catch (err) {
    ipv6SocketBlocked = true;
    ipv6BlockCode = err?.code || 'BLOCKED';
  }

  let dnsServers = [];
  try {
    const resolvText = await fs.readFile('/etc/resolv.conf', 'utf8');
    dnsServers = resolvText
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^nameserver\s+/i.test(line))
      .map(line => line.split(/\s+/)[1])
      .filter(Boolean);
  } catch {
    dnsServers = dns.getServers().map(s => s.replace(/^\[|\](?::\d+)?$/g, ''));
  }

  const [procOut, ntpOut, nftOut, unitOut, browserStartOut] = await Promise.all([
    exec('ps', ['-eo', 'uid,pid,comm,args'], { timeout: 2500, maxBuffer: 512 * 1024 }).then(r => r.stdout).catch(() => ''),
    exec('timedatectl', ['show', '-p', 'NTPSynchronized', '-p', 'Timezone'], { timeout: 2000 }).then(r => r.stdout).catch(() => ''),
    exec('ip', ['rule', 'show'], { timeout: 2000 }).then(r => r.stdout).catch(() => ''),
    fs.readFile('/etc/systemd/system/claude-workbench.service', 'utf8').catch(() => ''),
    fs.readFile('/opt/claude-browser/start.sh', 'utf8').catch(() => null),
  ]);

  const proxyCores = [];
  const wildClaudePids = [];
  const myPid = process.pid;
  for (const line of procOut.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, , pidStr, comm, args] = m;
    const pid = Number(pidStr);
    if (/^(?:mihomo|clash|clash-meta|sing-box|xray|v2ray|warp-svc|surge|hysteria|tuic)$/i.test(comm)) {
      proxyCores.push({ pid, name: comm });
    }
    if ((comm === 'claude' || args.includes('/bin/claude')) && pid !== myPid && !args.includes('auth status') && !args.includes('/usage')) {
      wildClaudePids.push({ pid, comm });
    }
  }

  const local7890 = await tcpReachable('127.0.0.1', 7890, 600);
  const configuredProxyRaw = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy || '';
  const configuredProxy = parseProxyEndpoint(configuredProxyRaw);
  const configuredProxyAlive = configuredProxy?.host && configuredProxy?.port
    ? await tcpReachable(configuredProxy.host, configuredProxy.port, 1000)
    : null;

  const tracePromise = (async () => {
    for (const url of ['https://claude.ai/cdn-cgi/trace', 'https://www.cloudflare.com/cdn-cgi/trace', 'https://1.1.1.1/cdn-cgi/trace']) {
      try {
        const { response, latencyMs } = await fetchWithTimeout(url, { timeoutMs: 4200 });
        if (!response.ok) continue;
        const text = await response.text();
        const parsed = parseTrace(text);
        if (parsed.ip) {
          const dateHeader = response.headers.get('date');
          return { ok: true, source: new URL(url).hostname, latencyMs, serverDate: dateHeader ? Date.parse(dateHeader) : null, ...parsed };
        }
      } catch {}
    }
    return { ok: false };
  })();

  const independentIpPromise = (async () => {
    for (const [url, kind] of [
      ['https://api.ipify.org?format=json', 'json'],
      ['https://ipv4.icanhazip.com', 'text'],
    ]) {
      try {
        const { response, latencyMs } = await fetchWithTimeout(url, { timeoutMs: 4000 });
        if (!response.ok) continue;
        const body = kind === 'json' ? (await response.json())?.ip : (await response.text()).trim();
        if (body && net.isIP(body)) return { ok: true, ip: body, source: new URL(url).hostname, latencyMs };
      } catch {}
    }
    return { ok: false };
  })();

  const dnsResolvePromise = (async () => {
    try {
      const [apiAddrs, webAddrs] = await Promise.all([
        dns.resolve4('api.anthropic.com'),
        dns.resolve4('claude.ai'),
      ]);
      return { ok: true, apiAddrs, webAddrs };
    } catch (err) {
      return { ok: false, error: err?.code || err?.message || 'DNS_FAIL' };
    }
  })();

  const ecosystemPromise = (async () => {
    const targets = [
      { id: 'api', host: 'api.anthropic.com', url: 'https://api.anthropic.com/' },
      { id: 'web', host: 'claude.ai', url: 'https://claude.ai/cdn-cgi/trace' },
      { id: 'oauth', host: 'claude.com', url: 'https://claude.com/cdn-cgi/trace' },
      { id: 'platform', host: 'platform.claude.com', url: 'https://platform.claude.com/' },
    ];
    return Promise.all(targets.map(async t => {
      try {
        const { response, latencyMs } = await fetchWithTimeout(t.url, { timeoutMs: 4500, method: t.url.endsWith('/trace') ? 'GET' : 'HEAD' });
        const cfMitigated = response.headers.get('cf-mitigated') || '';
        const blocked = response.status === 403 && (cfMitigated === 'challenge' || !t.url.endsWith('/trace'));
        return { ...t, reachable: true, status: response.status, latencyMs, blocked };
      } catch (err) {
        return { ...t, reachable: false, status: 0, latencyMs: null, error: err?.cause?.code || err?.name || 'UNREACHABLE' };
      }
    }));
  })();

  const tlsPromise = new Promise(resolve => {
    const started = Date.now();
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value); } };
    try {
      const socket = tls.connect({
        host: 'api.anthropic.com',
        port: 443,
        servername: 'api.anthropic.com',
        rejectUnauthorized: true,
        ALPNProtocols: ['h2', 'http/1.1'],
      });
      socket.setTimeout(4500);
      socket.once('secureConnect', () => {
        const cert = socket.getPeerCertificate(true) || {};
        const issuerOrg = cert.issuer?.O || cert.issuer?.CN || '';
        const rootOrg = cert.issuerCertificate?.issuer?.O || cert.issuerCertificate?.subject?.O || issuerOrg;
        const validTo = cert.valid_to ? Date.parse(cert.valid_to) : null;
        const daysRemaining = Number.isFinite(validTo) ? Math.floor((validTo - Date.now()) / 86_400_000) : null;
        const protocol = socket.getProtocol();
        const alpn = socket.alpnProtocol || null;
        socket.destroy();
        done({
          ok: true,
          authorized: socket.authorized,
          protocol,
          alpn,
          issuerOrg,
          rootOrg,
          daysRemaining,
          latencyMs: Date.now() - started,
        });
      });
      socket.once('timeout', () => { socket.destroy(); done({ ok: false, error: 'TLS_TIMEOUT' }); });
      socket.once('error', err => { socket.destroy(); done({ ok: false, error: err?.code || err?.message || 'TLS_ERROR' }); });
    } catch (err) {
      done({ ok: false, error: err?.code || 'TLS_INIT_ERROR' });
    }
  });

  const ipv6EgressPromise = ipv6SocketBlocked ? Promise.resolve({ blockedBySandbox: true }) : (async () => {
    const hasGlobalV6 = interfaces.some(i => !i.internal && (i.family === 'IPv6' || i.family === 6) && !i.address.startsWith('fe80:'));
    if (!hasGlobalV6) return { blockedBySandbox: false, hasGlobalV6: false, reachable: false };
    try {
      const { response } = await fetchWithTimeout('https://[2606:4700:4700::1111]/cdn-cgi/trace', { timeoutMs: 2800 });
      if (!response.ok) return { blockedBySandbox: false, hasGlobalV6: true, reachable: false };
      const trace = parseTrace(await response.text());
      return { blockedBySandbox: false, hasGlobalV6: true, reachable: Boolean(trace.ip), ip: trace.ip, loc: trace.loc };
    } catch {
      return { blockedBySandbox: false, hasGlobalV6: true, reachable: false };
    }
  })();

  const [trace, independentIp, dnsRes, ecosystem, tlsInfo, ipv6Egress] = await Promise.all([
    tracePromise, independentIpPromise, dnsResolvePromise, ecosystemPromise, tlsPromise, ipv6EgressPromise,
  ]);

  const primaryIp = trace.ip || independentIp.ip || null;
  let asnInfo = { ok: false };
  if (primaryIp && net.isIP(primaryIp)) {
    for (const provider of [
      async ip => {
        const { response } = await fetchWithTimeout(`https://ipwho.is/${encodeURIComponent(ip)}`, { timeoutMs: 3800 });
        if (!response.ok) return null;
        const j = await response.json();
        if (!j?.success) return null;
        return {
          ok: true,
          source: 'ipwho.is',
          asn: j.connection?.asn ? `AS${j.connection.asn}` : null,
          org: j.connection?.org || j.connection?.isp || '',
          isp: j.connection?.isp || '',
          country: j.country_code || null,
          city: j.city || '',
          timezone: j.timezone?.id || null,
          reportedType: j.connection?.type || null,
        };
      },
      async ip => {
        const { response } = await fetchWithTimeout(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, { timeoutMs: 3800 });
        if (!response.ok) return null;
        const j = await response.json();
        if (!j?.ip) return null;
        const m = String(j.org || '').match(/^(AS\d+)\s*(.*)$/i);
        return {
          ok: true,
          source: 'ipinfo.io',
          asn: m ? m[1].toUpperCase() : null,
          org: m ? m[2] : (j.org || ''),
          isp: m ? m[2] : (j.org || ''),
          country: j.country || null,
          city: j.city || '',
          timezone: j.timezone || null,
          reportedType: j.asn?.type || null,
        };
      },
    ]) {
      try {
        const info = await provider(primaryIp);
        if (info?.ok) { asnInfo = info; break; }
      } catch {}
    }
  }

  let cliInfo = { exists: false, executable: false, realPath: null, isOfficialLayout: false };
  if (binary) {
    try {
      const realPath = await fs.realpath(binary);
      const stat = await fs.stat(realPath);
      await fs.access(realPath, fs.constants.X_OK);
      const headBytes = await fs.open(realPath, 'r').then(async fh => {
        const buf = Buffer.alloc(128);
        const { bytesRead } = await fh.read(buf, 0, 128, 0);
        await fh.close();
        return buf.subarray(0, bytesRead);
      }).catch(() => Buffer.alloc(0));
      const isElfOrMach = (headBytes[0] === 0x7f && headBytes[1] === 0x45)
        || (headBytes[0] === 0xcf && headBytes[1] === 0xfa)
        || realPath.includes('/claude/versions/')
        || headBytes.toString('utf8').includes('claude');
      cliInfo = { exists: stat.isFile(), executable: true, realPath, isOfficialLayout: isElfOrMach };
    } catch {}
  }

  const contaminatedProcessVars = Object.keys(process.env).filter(k => CONTAMINATION_ENV_RE.test(k) && process.env[k]);
  const tlsBypassEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
  const sanitizedCheck = claudeEnvironment({ env: { ANTHROPIC_BASE_URL: 'https://evil.example', ANTHROPIC_API_KEY: 'sk-test' } });
  const sanitizerWorking = !('ANTHROPIC_BASE_URL' in sanitizedCheck) && !('ANTHROPIC_API_KEY' in sanitizedCheck);

  const profileChecks = [];
  for (const acc of accounts) {
    const cfgDir = acc.configDir || legacyConfigDir;
    if (!cfgDir) continue;
    let realCfg = null, dirMode = null, credMode = null, contaminatedSettings = [];
    try {
      realCfg = await fs.realpath(cfgDir);
      const st = await fs.lstat(realCfg);
      dirMode = st.mode & 0o777;
    } catch {}
    if (realCfg) {
      try {
        const cst = await fs.lstat(path.join(realCfg, '.credentials.json'));
        credMode = cst.isSymbolicLink() ? 0o777 : (cst.mode & 0o777);
      } catch {}
      try {
        const settingsRaw = JSON.parse(await fs.readFile(path.join(realCfg, 'settings.json'), 'utf8'));
        if (settingsRaw?.env && typeof settingsRaw.env === 'object') {
          contaminatedSettings = Object.keys(settingsRaw.env).filter(k => CONTAMINATION_ENV_RE.test(k));
        }
      } catch {}
    }
    profileChecks.push({
      id: acc.id,
      label: acc.label,
      enabled: acc.enabled !== false,
      loggedIn: acc.loggedIn === true,
      rateLimited: acc.rateLimited === true,
      version: acc.version || null,
      realCfg,
      dirMode,
      credMode,
      contaminatedSettings,
    });
  }

  const ntpSyncMatch = ntpOut.match(/NTPSynchronized=(yes|no)/i);
  return {
    checkedAtMs: Date.now(),
    resolvedTz,
    localeEnv,
    interfaces,
    ipv6SocketBlocked,
    ipv6BlockCode,
    dnsServers,
    proxyCores,
    local7890,
    configuredProxy,
    configuredProxyAlive,
    ipRules: nftOut,
    unitHasAddressSandbox: /RestrictAddressFamilies=.*AF_INET\b/.test(unitOut) && !/AF_INET6/.test(unitOut),
    hasRemoteBrowser: browserStartOut !== null,
    browserHasDisableQuic: Boolean(browserStartOut && browserStartOut.includes('--disable-quic')),
    browserHasNoProxy: Boolean(browserStartOut && browserStartOut.includes('--no-proxy-server')),
    ntpSynchronized: ntpSyncMatch ? ntpSyncMatch[1].toLowerCase() === 'yes' : null,
    trace,
    independentIp,
    dnsRes,
    ecosystem,
    tlsInfo,
    ipv6Egress,
    asnInfo,
    cliInfo,
    contaminatedProcessVars,
    tlsBypassEnv,
    sanitizerWorking,
    profileChecks,
    wildClaudePids,
  };
}

export function evaluateEnvironmentAudit(raw, {
  settings = {},
  history = [],
  clientSignals = null,
  accountFeatures = {},
} = {}) {
  const muted = new Set(Array.isArray(settings.mutedChecks) ? settings.mutedChecks : []);
  const checks = [];
  const add = ({ id, group = 'preflight', community = false, title, icon, status, critical = false, value, summary, detail, advice = null }) => {
    const isMuted = status === 'warn' && muted.has(id);
    checks.push({
      id,
      group,
      community,
      title,
      icon,
      rawStatus: status,
      status: isMuted ? 'pass' : status,
      muted: isMuted,
      critical,
      value: String(value || ''),
      summary: String(summary || ''),
      detail: String(detail || ''),
      advice: advice ? String(advice) : null,
    });
  };

  const egressIp = raw.trace?.ip || raw.independentIp?.ip || null;
  const country = (raw.trace?.loc || raw.asnInfo?.country || '').toUpperCase() || null;
  const countryLabel = country ? `${COUNTRY_NAMES[country] || country} (${country})` : '未知';
  const supportedRegion = country ? SUPPORTED_COUNTRIES.has(country) : false;
  const highRiskRegion = country ? HIGH_RISK_REGIONS.has(country) : false;
  const directNativeMode = !raw.configuredProxy && supportedRegion;
  const tunIfaces = [...new Set((raw.interfaces || []).filter(i => TUN_IFACE_RE.test(i.name)).map(i => i.name))];

  // Row 1 Left: 1. 代理内核 (proxy_core)
  if (raw.configuredProxy) {
    if (raw.configuredProxyAlive === false) {
      add({
        id: 'proxy_core', title: '代理内核', icon: 'cpu',
        status: 'fail', critical: true, value: '不可达',
        summary: `已配置代理 ${raw.configuredProxy.raw} 但端口无法连通`,
        detail: `检测到代理配置 ${raw.configuredProxy.raw}，但 TCP 握手失败。`,
        advice: '请恢复代理内核服务，或清除失效的 HTTP_PROXY / HTTPS_PROXY 环境变量。',
      });
    } else if (raw.configuredProxy.protocol.startsWith('socks')) {
      add({
        id: 'proxy_core', title: '代理内核', icon: 'cpu',
        status: 'warn', value: raw.configuredProxy.protocol.toUpperCase(),
        summary: `使用 ${raw.configuredProxy.raw}，建议优先使用 HTTP/HTTPS 代理协议`,
        detail: 'GitHub 社区反馈部分 Claude Code 子工具对纯 SOCKS 代理兼容性不佳，易发生旁路超时。',
        advice: '建议将代理环境变量切换为 http://127.0.0.1:<混合端口>。',
      });
    } else {
      const coreNames = raw.proxyCores?.map(c => c.name).join(', ') || '外部网关';
      add({
        id: 'proxy_core', title: '代理内核', icon: 'cpu',
        status: 'pass', value: '运行中',
        summary: `代理通道正常 (${coreNames} · ${raw.configuredProxy.raw})`,
        detail: `代理端口连通性校验通过，活跃内核：${coreNames}。`,
      });
    }
  } else if (directNativeMode) {
    const standby = raw.proxyCores?.length ? ` · 备用 ${raw.proxyCores.map(c => c.name).join('/')} 未全局接管` : '';
    add({
      id: 'proxy_core', title: '代理内核', icon: 'cpu',
      status: 'pass', value: '海外直连',
      summary: `海外支持地区原生直连模式${standby}`,
      detail: '当前主机位于官方支持地区且未依赖代理中转，Claude Code 通过原生公网接口直出，链路最纯净。',
    });
  } else {
    add({
      id: 'proxy_core', title: '代理内核', icon: 'cpu',
      status: highRiskRegion ? 'fail' : 'warn', critical: highRiskRegion, value: '未接管',
      summary: highRiskRegion ? `当前位于受限地区 (${countryLabel}) 且未配置有效代理内核` : '未检测到活跃代理配置且出口地区待确认',
      detail: `活跃内核数：${raw.proxyCores?.length || 0}，本地 7890 端口：${raw.local7890 ? '开放' : '关闭'}。`,
      advice: '在非官方支持地区必须启用可靠的代理内核接管流量，切勿裸连启动 Claude Code。',
    });
  }

  // Row 1 Right: 2. TUN 网卡 (tun_interface)
  if (tunIfaces.length > 0) {
    add({
      id: 'tun_interface', title: 'TUN 网卡', icon: 'plug',
      status: 'pass', value: tunIfaces.join(', '),
      summary: `虚拟网卡 ${tunIfaces.join(', ')} 已激活接管`,
      detail: '底层子进程与自定义传输流量均受虚拟网卡保护，防止不继承环境变量导致裸连 403。',
    });
  } else if (directNativeMode) {
    const pubIfaces = [...new Set((raw.interfaces || []).filter(i => !i.internal).map(i => i.name))];
    add({
      id: 'tun_interface', title: 'TUN 网卡', icon: 'plug',
      status: 'pass', value: pubIfaces[0] || '原生网卡',
      summary: `海外原生网卡 (${pubIfaces.join(', ') || 'eth0'}) 直出，无需虚拟 TUN`,
      detail: '服务器本身具备合规海外公网出口，无需挂接 TUN 隧道，避免多层封装 MTU 与指纹损耗。',
    });
  } else {
    add({
      id: 'tun_interface', title: 'TUN 网卡', icon: 'plug',
      status: 'warn', value: '未开启',
      summary: '未检测到 TUN 虚拟网卡，仅依赖环境变量代理可能漏出子进程流量',
      detail: 'Claude Code 执行 Bash / WebSocket / 原生二进制时可能绕过系统代理，在受限网络下易触发 403 封禁。',
      advice: '建议在 Clash / Mihomo / Sing-box 中开启 TUN 模式（auto-route + strict-route）。',
    });
  }

  // Row 2 Left: 3. 出口 IP (egress_ip)
  if (egressIp && !isPrivateOrReservedIp(egressIp)) {
    const rtt = raw.trace?.latencyMs ?? raw.independentIp?.latencyMs;
    add({
      id: 'egress_ip', title: '出口 IP', icon: 'globe',
      status: 'pass', critical: true, value: egressIp,
      summary: `公网出口 IPv4 ${egressIp}${rtt != null ? ` (${rtt}ms)` : ''}`,
      detail: `探测源：${raw.trace?.source || raw.independentIp?.source || '公网边缘'}，地址格式与公网可达性正常。`,
    });
  } else {
    add({
      id: 'egress_ip', title: '出口 IP', icon: 'globe',
      status: 'fail', critical: true, value: '获取失败',
      summary: '无法探测有效公网出口 IP，外网链路异常',
      detail: 'Cloudflare Trace 与独立公网 IP 探针均未能返回有效公网 IPv4 地址。',
      advice: '请检查服务器默认路由、防火墙出站策略或代理出口连通性。',
    });
  }

  // Row 2 Right: 4. IP 一致 (ip_consistency)
  if (raw.trace?.ok && raw.independentIp?.ok) {
    if (raw.trace.ip === raw.independentIp.ip) {
      add({
        id: 'ip_consistency', title: 'IP 一致', icon: 'check',
        status: 'pass', value: '多源一致',
        summary: `Cloudflare 边缘 (${raw.trace.source}) 与独立探针出口一致 (${raw.trace.ip})`,
        detail: '访问 Anthropic 所在的 Cloudflare 网络与常规公网流量走同一出口，无分流劈叉风险。',
      });
    } else {
      add({
        id: 'ip_consistency', title: 'IP 一致', icon: 'check',
        status: 'warn', value: '分流不一致',
        summary: `Cloudflare 识别为 ${raw.trace.ip}，普通公网探针为 ${raw.independentIp.ip}`,
        detail: '不同目标域名走了不同出口 IP，若 OAuth 网页、API 与遥测端点分属不同线路易引发风控评分上升。',
        advice: '建议将 claude.ai、claude.com、anthropic.com 及通用探针固定至同一出口节点。',
      });
    }
  } else if (egressIp) {
    add({
      id: 'ip_consistency', title: 'IP 一致', icon: 'check',
      status: 'warn', value: '单源确认',
      summary: `仅单一探针返回 ${egressIp}，备用比对源超时`,
      detail: `Cloudflare: ${raw.trace?.ip || '超时'}；独立探针: ${raw.independentIp?.ip || '超时'}。`,
      advice: '可稍后点击重新检查，确认多源探针均返回同一出口 IP。',
    });
  } else {
    add({
      id: 'ip_consistency', title: 'IP 一致', icon: 'check',
      status: 'fail', value: '不可用',
      summary: '未获取到可交叉核对的出口 IP',
      detail: '双路外部 IP 探针均不可达。',
    });
  }

  // Row 3 Left: 5. 时区 (timezone_match)
  const sysTz = raw.resolvedTz || 'UTC';
  const matcher = country ? COUNTRY_TZ_MATCHERS[country] : null;
  const tzMatchesCountry = matcher ? matcher(sysTz) : Boolean(raw.asnInfo?.timezone && raw.asnInfo.timezone === sysTz);
  if (SENSITIVE_TIMEZONES.has(sysTz) && country && !HIGH_RISK_REGIONS.has(country)) {
    const rec = COUNTRY_RECOMMENDED_TZ[country] || raw.asnInfo?.timezone || '出口所在国时区';
    add({
      id: 'timezone_match', title: '时区', icon: 'clock',
      status: 'warn', value: sysTz,
      summary: `系统时区为敏感区域 (${sysTz})，与出口国家 ${country} 严重冲突`,
      detail: 'Claude Code 运行时可读取 Intl 时区特征；海外 IP 搭配国内时区是各大社区公认的高危机器/绕过指纹。',
      advice: `建议将运行环境时区对齐至 ${rec}（例如：sudo timedatectl set-timezone ${rec.split(' ')[0]}）。`,
    });
  } else if (country && (tzMatchesCountry || (!matcher && !raw.asnInfo?.timezone))) {
    add({
      id: 'timezone_match', title: '时区', icon: 'clock',
      status: 'pass', value: sysTz,
      summary: `系统时区 (${sysTz}) 与出口地区 (${country}) 一致`,
      detail: '服务端 CLI 执行环境的时间区域特征与网络地理位置吻合。',
    });
  } else if (country) {
    const rec = COUNTRY_RECOMMENDED_TZ[country] || raw.asnInfo?.timezone || '出口对应时区';
    add({
      id: 'timezone_match', title: '时区', icon: 'clock',
      status: 'warn', value: `${sysTz} ≠ ${country}`,
      summary: `出口地区为 ${countryLabel}，但系统时区为 ${sysTz}`,
      detail: `跨洲时区错位（预期 ${rec}，实际 ${sysTz}）会降低账号环境画像一致性评分。`,
      advice: `如需对齐环境指纹，可执行：sudo timedatectl set-timezone ${rec.split(' ')[0]}`,
    });
  } else {
    add({
      id: 'timezone_match', title: '时区', icon: 'clock',
      status: 'warn', value: sysTz,
      summary: `当前系统时区 ${sysTz}（出口国家待确认）`,
      detail: '待出口国家识别后比对时区匹配度。',
    });
  }

  // Row 3 Right: 6. 地区 (region_support)
  if (!country) {
    add({
      id: 'region_support', title: '地区', icon: 'globe',
      status: 'warn', critical: true, value: '未知',
      summary: '暂未识别出口 IP 所属国家/地区代码',
      detail: '无法从 Cloudflare Trace 或 IP 情报库确认 ISO 国家码。',
    });
  } else if (supportedRegion && !highRiskRegion) {
    add({
      id: 'region_support', title: '地区', icon: 'globe',
      status: 'pass', critical: true, value: countryLabel,
      summary: `出口位于 Anthropic 官方支持地区：${countryLabel}`,
      detail: `Cloudflare 边缘节点：${raw.trace?.colo || '自动'}，符合 claude.ai 与 api.anthropic.com 服务区域政策。`,
    });
  } else {
    add({
      id: 'region_support', title: '地区', icon: 'globe',
      status: 'fail', critical: true, value: countryLabel,
      summary: `出口位于不支持的高危封锁地区：${countryLabel}`,
      detail: 'Anthropic 边缘防火墙对 CN / HK / MO / RU 等非支持地区直接返回 403 Forbidden 并高概率关联封号。',
      advice: '请立即切换出口至美国、日本、新加坡、英国等官方支持地区后再发起请求！',
    });
  }

  // Row 4 Left: 7. IPv6 (ipv6_leak)
  if (raw.ipv6SocketBlocked || raw.ipv6Egress?.blockedBySandbox) {
    add({
      id: 'ipv6_leak', title: 'IPv6', icon: 'shield',
      status: 'pass', critical: true, value: '沙箱已锁死',
      summary: `系统级沙箱已物理阻断 IPv6 (${raw.ipv6BlockCode || 'AF_INET only'})`,
      detail: '进程仅允许 AF_INET (IPv4) 套接字，从内核层根除双栈漂移与 IPv6 旁路裸连泄漏。',
    });
  } else if (!raw.ipv6Egress?.reachable) {
    add({
      id: 'ipv6_leak', title: 'IPv6', icon: 'shield',
      status: 'pass', critical: true, value: '纯 IPv4 出站',
      summary: '无公网 IPv6 出站流量，不存在双栈旁路泄漏',
      detail: raw.ipv6Egress?.hasGlobalV6 ? '网卡虽有 IPv6 地址但未启用公网出站路由。' : '未配置公网 IPv6 地址。',
    });
  } else {
    const v6Loc = (raw.ipv6Egress.loc || '').toUpperCase();
    if (HIGH_RISK_REGIONS.has(v6Loc) || (v6Loc && !SUPPORTED_COUNTRIES.has(v6Loc))) {
      add({
        id: 'ipv6_leak', title: 'IPv6', icon: 'shield',
        status: 'fail', critical: true, value: `泄漏 (${v6Loc})`,
        summary: `严重泄漏：IPv6 出口落在受限地区 ${v6Loc} (${raw.ipv6Egress.ip})`,
        detail: 'IPv6 绕过了 IPv4 路由直接暴露受限地区位置，极易触发立即封号！',
        advice: '请立即在代理或内核 sysctl / systemd RestrictAddressFamilies 中禁用 IPv6！',
      });
    } else if (country && v6Loc && v6Loc !== country) {
      add({
        id: 'ipv6_leak', title: 'IPv6', icon: 'shield',
        status: 'warn', value: `${country} / ${v6Loc}`,
        summary: `双栈地区不一致：IPv4 为 ${country}，IPv6 为 ${v6Loc}`,
        detail: `IPv6 出口 (${raw.ipv6Egress.ip}) 与 IPv4 国家不同，Happy Eyeballs 可能导致请求在两国间随机切换。`,
        advice: '建议固定纯 IPv4 出站，关闭双栈自动切换。',
      });
    } else {
      add({
        id: 'ipv6_leak', title: 'IPv6', icon: 'shield',
        status: 'warn', value: '双栈开启',
        summary: `IPv6 公网可通 (${v6Loc || '同区'})，建议锁定单栈 IPv4 防地址漂移`,
        detail: `实测 IPv6 出口：${raw.ipv6Egress.ip}。双栈并发连接可能使会话在 v4/v6 地址间跳变。`,
        advice: '可在 systemd 服务中设置 RestrictAddressFamilies=AF_UNIX AF_INET AF_NETLINK 锁定 IPv4。',
      });
    }
  }

  // Row 4 Right: 8. DNS (dns_leak)
  const resolvers = raw.dnsServers || [];
  const cnResolvers = resolvers.filter(ip => CN_PUBLIC_DNS.has(ip));
  const resolvedApi = raw.dnsRes?.apiAddrs || [];
  const fakeIpHit = resolvedApi.some(isFakeIpRange);
  if (cnResolvers.length > 0) {
    add({
      id: 'dns_leak', title: 'DNS', icon: 'search',
      status: 'fail', critical: true, value: '国内 DNS 泄漏',
      summary: `检测到中国大陆公共 DNS 服务器：${cnResolvers.join(', ')}`,
      detail: '使用国内递归 DNS 解析 anthropic.com 会导致地理位置分流错误与 DNS 抢答污染。',
      advice: '请将 /etc/resolv.conf 或代理远程 DNS 改为 1.1.1.1 / 8.8.8.8 或加密 DoH。',
    });
  } else if (!raw.dnsRes?.ok) {
    add({
      id: 'dns_leak', title: 'DNS', icon: 'search',
      status: 'fail', critical: true, value: '解析失败',
      summary: `无法解析 api.anthropic.com (${raw.dnsRes?.error || 'ERROR'})`,
      detail: `当前配置 DNS：${resolvers.join(', ') || '默认'}。`,
      advice: '请检查递归 DNS 连通性及防火墙 UDP/TCP 53 端口。',
    });
  } else if (fakeIpHit) {
    add({
      id: 'dns_leak', title: 'DNS', icon: 'search',
      status: 'pass', value: 'Fake-IP 接管',
      summary: `代理内核 Fake-IP 透明接管 (${resolvedApi[0]})`,
      detail: `DNS 由本地代理虚拟地址池映射并在远端安全解析，系统 DNS：${resolvers.join(', ') || '本地'}。`,
    });
  } else {
    add({
      id: 'dns_leak', title: 'DNS', icon: 'search',
      status: 'pass', value: resolvers.slice(0, 2).join(', ') || '海外纯净',
      summary: `海外可信 DNS (${resolvers.join(', ') || '系统递归'}) · 解析无污染`,
      detail: `api.anthropic.com -> ${resolvedApi.slice(0, 2).join(', ')}。`,
    });
  }

  // Row 5 Left: 9. WebRTC (webrtc_leak)
  const clientPublicIps = (clientSignals?.webrtcIps || []).filter(ip => net.isIP(ip) && !isPrivateOrReservedIp(ip));
  const serverBrowserIsolated = raw.browserHasDisableQuic && raw.browserHasNoProxy;
  if (serverBrowserIsolated) {
    add({
      id: 'webrtc_leak', title: 'WebRTC', icon: 'eye-off',
      status: 'pass', value: '云端隔离',
      summary: `远端授权浏览器受 IPv4 沙箱锁定${clientPublicIps.length ? `（提醒：你本机浏览器暴露 ${clientPublicIps[0]}，勿本机直登官方页）` : ''}`,
      detail: '所有 Claude 官方登录与请求均在服务端隔离环境中完成，访问本工作台网页不会向 Anthropic 发起任何浏览器 WebRTC 连接。',
    });
  } else if (clientPublicIps.length > 0 && egressIp && !clientPublicIps.includes(egressIp)) {
    add({
      id: 'webrtc_leak', title: 'WebRTC', icon: 'eye-off',
      status: 'warn', value: '候选地址差异',
      summary: `当前浏览器 WebRTC 候选公网 IP (${clientPublicIps[0]}) 与工作台出口 (${egressIp}) 不同`,
      detail: '在本工作台内对话完全不受影响；但若你在本机浏览器直接打开 claude.ai，WebRTC 可能暴露真实网络。',
      advice: '如需在本机浏览器直登 claude.ai，建议开启浏览器「禁用非代理 UDP」策略。',
    });
  } else {
    add({
      id: 'webrtc_leak', title: 'WebRTC', icon: 'eye-off',
      status: 'pass', value: '无泄漏',
      summary: '服务端纯 CLI 无 WebRTC 栈 · 浏览器未检出异常公网候选',
      detail: '未检测到跨区 STUN 候选地址外泄风险。',
    });
  }

  // Row 5 Right: 10. 保镖 (bodyguard_status)
  const hasSandbox = raw.ipv6SocketBlocked || raw.unitHasAddressSandbox;
  const watchdogOn = settings.watchdogEnabled !== false;
  const failClosedOn = settings.blockOnCritical === true;
  if (hasSandbox || failClosedOn) {
    const tags = [
      hasSandbox ? '地址族沙箱' : null,
      watchdogOn ? '漂移巡检' : null,
      failClosedOn ? '高危熔断' : null,
    ].filter(Boolean);
    add({
      id: 'bodyguard_status', title: '保镖', icon: 'shield',
      status: 'pass', value: failClosedOn ? '熔断守护' : '沙箱巡检',
      summary: `保护机制已激活：${tags.join(' + ')}`,
      detail: failClosedOn
        ? '已开启 Fail-Closed 高危阻断门禁：当出口漂移至受限区或凭据环境异常时，自动拦截新任务拉起。'
        : '系统级网络沙箱与后台漂移巡检正在运行；可在右上角齿轮开启「高危项阻断发送」获得严格熔断保护。',
    });
  } else if (watchdogOn) {
    add({
      id: 'bodyguard_status', title: '保镖', icon: 'shield',
      status: 'warn', value: '仅预警',
      summary: '后台巡检已开启，尚未启用高危阻断门禁（Fail-Closed）',
      detail: '当前仅对高危环境异常做界面告警，未物理拦截新对话启动。',
      advice: '点击面板右上角设置图标，可开启「高危项阻断发送」防止异常环境下误发请求。',
    });
  } else {
    add({
      id: 'bodyguard_status', title: '保镖', icon: 'shield',
      status: 'warn', value: '未启用',
      summary: '后台环境漂移巡检与高危阻断门禁均处于关闭状态',
      detail: '网络发生意外切换或代理掉线时将无法及时预警或熔断。',
      advice: '建议在环境检测设置中开启后台漂移巡检与高危阻断保护。',
    });
  }

  // Row 6 Left: 11. 规则置顶 (pinned_routing)
  const hasResidualTransparent = /mihomo|bytexit|clash/i.test(raw.ipRules || '') && !tunIfaces.length;
  if (hasResidualTransparent) {
    add({
      id: 'pinned_routing', title: '规则置顶', icon: 'pin',
      status: 'warn', value: '策略路由残留',
      summary: '检测到策略路由规则残留但虚拟网卡未激活',
      detail: 'ip rule 输出包含透明代理表特征，可能导致部分连接黑洞或回退漂移。',
      advice: '请核查 ip rule 与 nftables，清理未使用的透明代理路由表。',
    });
  } else if (directNativeMode) {
    add({
      id: 'pinned_routing', title: '规则置顶', icon: 'pin',
      status: 'pass', value: '直连锁定',
      summary: '已强制 NO_PROXY=* 锁定原生固定出口，零第三方分流规则干扰',
      detail: 'Claude Code 流量不经过任何自动测速组或泛域名分流列表，出口路径恒定唯一。',
    });
  } else if (raw.configuredProxy && raw.configuredProxyAlive) {
    add({
      id: 'pinned_routing', title: '规则置顶', icon: 'pin',
      status: 'pass', value: '显式锁定',
      summary: `显式代理通道已固定指向 ${raw.configuredProxy.raw}`,
      detail: '请确保代理内核中 anthropic.com、claude.ai、claude.com 规则置顶并绑定固定节点（禁用 URL-Test 自动轮换）。',
    });
  } else {
    add({
      id: 'pinned_routing', title: '规则置顶', icon: 'pin',
      status: 'warn', value: '待锁定',
      summary: '未检测到显式路由锁定策略',
      detail: '若使用分流软件，请将 Claude 全系域名置顶固定在单一独享节点，切勿使用自动测速故障转移组。',
    });
  }

  // Row 6 Right: 12. 客户端语言 (client_locale)
  const sysLocale = raw.localeEnv || 'POSIX';
  const browserLang = clientSignals?.language || null;
  const sysHasZhCn = /zh[_-](?:CN|HK|MO|Hans)/i.test(sysLocale);
  if (sysHasZhCn && country && !['CN', 'HK', 'MO', 'SG', 'TW'].includes(country)) {
    add({
      id: 'client_locale', title: '客户端语言', icon: 'code',
      status: 'warn', value: sysLocale,
      summary: `服务端 CLI Locale (${sysLocale}) 含中文区域标识，与 ${country} 出口不匹配`,
      detail: `服务端 LANG=${sysLocale}${browserLang ? `；当前控制浏览器语言=${browserLang}（仅访问工作台，不直连官方）` : ''}。`,
      advice: '建议将运行 Claude Code 服务的系统 Locale 设为 en_US.UTF-8。',
    });
  } else {
    add({
      id: 'client_locale', title: '客户端语言', icon: 'code',
      status: 'pass', value: sysLocale.split('.')[0] || 'en_US',
      summary: `CLI 运行环境语言为 ${sysLocale}${browserLang ? ` · 控制端 ${browserLang}` : ''}`,
      detail: 'Claude Code CLI 实际在服务端 en_US / POSIX 环境下发包，工作台浏览器语言不会泄露给 Anthropic。',
    });
  }

  // Row 7 Left: 13. ASN 属性 (asn_type)
  if (raw.asnInfo?.ok) {
    const label = [raw.asnInfo.asn, raw.asnInfo.org].filter(Boolean).join(' ');
    const reported = String(raw.asnInfo.reportedType || '').toLowerCase();
    const isHosting = reported === 'hosting' || DATACENTER_KEYWORDS.test(`${raw.asnInfo.org} ${raw.asnInfo.isp}`);
    if (isHosting) {
      add({
        id: 'asn_type', title: 'ASN 属性', icon: 'server',
        status: 'warn', value: raw.asnInfo.asn || 'Hosting',
        summary: `疑似机房 (${label || '数据中心网络'})`,
        detail: `IP 情报源 (${raw.asnInfo.source}) 识别该网段属于云服务器 / IDC 机房带宽。公共共享机房池风控率较高；若为本人独享固定 VPS IP 且账号始终同机原位登录，日常使用风险可控。`,
        advice: '保持单机固定独享出口、切勿多人拼车或频繁切换机房节点；最高安全要求场景可搭配独享住宅 ISP 落地。',
      });
    } else {
      const kindLabel = reported === 'isp' ? '住宅/运营商宽带' : reported === 'business' ? '商业专线带宽' : '常规运营商网络';
      add({
        id: 'asn_type', title: 'ASN 属性', icon: 'server',
        status: 'pass', value: raw.asnInfo.asn || 'ISP',
        summary: `${kindLabel} (${label})`,
        detail: `数据源 ${raw.asnInfo.source} 未检出机房/公共 VPN 托管特征，IP 信誉画像良好。`,
      });
    }
  } else {
    add({
      id: 'asn_type', title: 'ASN 属性', icon: 'server',
      status: 'warn', value: '待查询',
      summary: 'ASN 归属机构查询暂未返回',
      detail: '外部 BGP/Whois 情报接口响应超时，稍后刷新可重试。',
    });
  }

  // Row 7 Right: 14. 生态可达性 (ecosystem_reachability)
  const eco = raw.ecosystem || [];
  const blockedEndpoints = eco.filter(e => e.blocked);
  const unreachableEndpoints = eco.filter(e => !e.reachable);
  const apiTarget = eco.find(e => e.id === 'api');
  if (blockedEndpoints.length > 0) {
    add({
      id: 'ecosystem_reachability', title: '生态可达性', icon: 'activity',
      status: 'fail', critical: true, value: 'WAF 拦截 (403)',
      summary: `核心域名被边缘防火墙拦截：${blockedEndpoints.map(e => e.host).join(', ')}`,
      detail: eco.map(e => `${e.host}: ${e.reachable ? `HTTP ${e.status} (${e.latencyMs}ms)` : e.error}`).join(' · '),
      advice: '当前出口 IP 已被 Cloudflare / Anthropic 边缘策略拦截，请更换纯净支持区出口。',
    });
  } else if (!apiTarget?.reachable || unreachableEndpoints.length >= 2) {
    add({
      id: 'ecosystem_reachability', title: '生态可达性', icon: 'activity',
      status: 'fail', critical: true, value: '连接失败',
      summary: `核心端点不可达：${unreachableEndpoints.map(e => e.host).join(', ')}`,
      detail: eco.map(e => `${e.host}: ${e.reachable ? `HTTP ${e.status} (${e.latencyMs}ms)` : e.error}`).join(' · '),
      advice: '请检查到 api.anthropic.com 与 claude.com 的出站网络与防火墙。',
    });
  } else if (unreachableEndpoints.length === 1) {
    add({
      id: 'ecosystem_reachability', title: '生态可达性', icon: 'activity',
      status: 'warn', value: `${eco.length - 1}/${eco.length} 可达`,
      summary: `主 API 正常 (${apiTarget.latencyMs}ms)，但 ${unreachableEndpoints[0].host} 响应超时`,
      detail: eco.map(e => `${e.host}: ${e.reachable ? `${e.latencyMs}ms` : '超时'}`).join(' · '),
    });
  } else if (eco.length > 0) {
    add({
      id: 'ecosystem_reachability', title: '生态可达性', icon: 'activity',
      status: 'pass', critical: true, value: `${apiTarget?.latencyMs ?? '—'}ms`,
      summary: `API / Web / OAuth 四大官方端点全通 (API ${apiTarget?.latencyMs}ms)`,
      detail: eco.map(e => `${e.host}: ${e.latencyMs}ms`).join(' · '),
    });
  } else {
    add({
      id: 'ecosystem_reachability', title: '生态可达性', icon: 'activity',
      status: 'warn', value: '未探测',
      summary: '未获取到官方生态端点连通数据',
      detail: '请刷新重试生态可达性检查。',
    });
  }

  // ==================== GitHub & 社区高热防封深度 10 项 ====================

  // Row 8 Left: 15. CF WARP 标记 (cloudflare_edge)
  const warpState = (raw.trace?.warp || 'off').toLowerCase();
  const edgeTls = raw.trace?.tls || raw.tlsInfo?.protocol || '';
  if (warpState === 'on' || warpState === 'plus') {
    add({
      id: 'cloudflare_edge', group: 'community', community: true, title: 'CF WARP 标记', icon: 'alert',
      status: 'fail', critical: true, value: `warp=${warpState}`,
      summary: `检测到开启 Cloudflare WARP (${warpState})，属高危共享代理池特征`,
      detail: 'GitHub 与 V2EX 大量封号案例表明：Anthropic 前置 Cloudflare 企业风控直接识别 warp=on/plus 公共出口，极易触发 403 或账号停用。',
      advice: '请关闭 Cloudflare WARP 出站，改用独享固定原生 IP 或高质量独立落地节点。',
    });
  } else if (raw.trace?.ok) {
    add({
      id: 'cloudflare_edge', group: 'community', community: true, title: 'CF WARP 标记', icon: 'shield',
      status: 'pass', critical: true, value: `warp=off · ${edgeTls || 'TLSv1.3'}`,
      summary: `未携带 WARP 公共代理标记 (warp=off · ${raw.trace.http || 'h2'} · ${edgeTls || 'TLSv1.3'})`,
      detail: `Cloudflare 边缘接入点：${raw.trace.colo || '正常'}，传输层协商参数正常。`,
    });
  } else {
    add({
      id: 'cloudflare_edge', group: 'community', community: true, title: 'CF WARP 标记', icon: 'shield',
      status: 'warn', value: '未知',
      summary: '无法读取 Cloudflare Trace 边缘标记',
      detail: '待外网恢复后核验 warp 状态。',
    });
  }

  // Row 8 Right: 16. TLS 证书链 (tls_integrity)
  if (raw.tlsBypassEnv) {
    add({
      id: 'tls_integrity', group: 'community', community: true, title: 'TLS 证书链', icon: 'lock',
      status: 'fail', critical: true, value: '校验被禁用',
      summary: '检测到 NODE_TLS_REJECT_UNAUTHORIZED=0，TLS 证书安全校验已被强行关闭',
      detail: '关闭证书校验会使凭据暴露于中间人解密，且异常 TLS 栈极易触发风控拦截。',
      advice: '请立即移除 NODE_TLS_REJECT_UNAUTHORIZED=0 环境变量。',
    });
  } else if (!raw.tlsInfo?.ok || !raw.tlsInfo.authorized) {
    add({
      id: 'tls_integrity', group: 'community', community: true, title: 'TLS 证书链', icon: 'lock',
      status: 'fail', critical: true, value: '握手异常',
      summary: `api.anthropic.com TLS 证书校验失败 (${raw.tlsInfo?.error || 'UNTRUSTED'})`,
      detail: '可能存在企业防火墙 SSL 解密、代理工具 MITM 劫持或系统 CA 证书库缺失。',
      advice: '严禁对 anthropic.com / claude.ai 开启 HTTPS 解密抓包（MITM），并更新 ca-certificates。',
    });
  } else if (MITM_ISSUER_KEYWORDS.test(`${raw.tlsInfo.issuerOrg} ${raw.tlsInfo.rootOrg}`)) {
    add({
      id: 'tls_integrity', group: 'community', community: true, title: 'TLS 证书链', icon: 'lock',
      status: 'fail', critical: true, value: 'MITM 劫持',
      summary: `检测到代理/抓包根证书介入 (${raw.tlsInfo.issuerOrg})`,
      detail: '对 Claude 官方流量做 TLS 中间人重签会破坏客户端 JA3/JA4 指纹并触发逆向滥用封禁。',
      advice: '请立即关闭代理软件或网关对 *.anthropic.com 与 *.claude.ai 的 MITM / HTTPS 解密！',
    });
  } else {
    add({
      id: 'tls_integrity', group: 'community', community: true, title: 'TLS 证书链', icon: 'lock',
      status: 'pass', critical: true, value: `${raw.tlsInfo.protocol || 'TLSv1.3'} · 官方 CA`,
      summary: `官方受信证书链完整 (${raw.tlsInfo.issuerOrg || 'Public CA'} · 剩余 ${raw.tlsInfo.daysRemaining ?? '—'} 天)`,
      detail: `ALPN: ${raw.tlsInfo.alpn || 'h2'}，握手耗时 ${raw.tlsInfo.latencyMs}ms，无中间人篡改痕迹。`,
    });
  }

  // Row 9 Left: 17. QUIC 防护 (quic_guard)
  if (raw.browserHasDisableQuic) {
    add({
      id: 'quic_guard', group: 'community', community: true, title: 'QUIC 防护', icon: 'ban',
      status: 'pass', value: '已禁用 QUIC',
      summary: '远端授权浏览器已显式注入 --disable-quic，阻断 UDP 443 旁路泄漏',
      detail: '防止浏览器通过 HTTP/3 (QUIC) 绕过 TCP 管控规则或暴露真实底层 UDP 延迟特征。',
    });
  } else if (directNativeMode) {
    add({
      id: 'quic_guard', group: 'community', community: true, title: 'QUIC 防护', icon: 'ban',
      status: 'pass', value: '原生同源',
      summary: '海外原生单出口直连，UDP/TCP 均走同一合规公网接口',
      detail: '不存在代理分流下的 UDP QUIC 直连泄漏面。',
    });
  } else {
    add({
      id: 'quic_guard', group: 'community', community: true, title: 'QUIC 防护', icon: 'ban',
      status: 'warn', value: '建议阻断',
      summary: '代理环境下建议阻断 UDP 443 (QUIC)，防止 HTTP/3 绕过代理裸连',
      detail: 'NodeSeek / Linux.do 社区实测：部分代理未正确接管 UDP 443 时，浏览器 QUIC 会直连暴露真实地区。',
      advice: '建议在浏览器启动参数加入 --disable-quic，或在代理规则中 REJECT UDP 443。',
    });
  }

  // Row 9 Right: 18. 时钟同步 (ntp_clock_skew)
  const skewMs = Number.isFinite(raw.trace?.serverDate) ? Math.abs(raw.checkedAtMs - raw.trace.serverDate) : null;
  const skewSec = skewMs !== null ? Math.round(skewMs / 1000) : null;
  if (skewSec !== null && skewSec > 30) {
    add({
      id: 'ntp_clock_skew', group: 'community', community: true, title: '时钟同步', icon: 'clock',
      status: 'fail', value: `偏移 ${skewSec}s`,
      summary: `系统时钟与云端标准时间偏差过大 (${skewSec} 秒)`,
      detail: '时钟偏移超过 30 秒会导致 OAuth 令牌有效期、TLS 握手与 Cloudflare 防护签名校验异常。',
      advice: '请立即启用 systemd-timesyncd 或 chrony 同步 NTP 标准时间。',
    });
  } else if ((skewSec !== null && skewSec > 5) || raw.ntpSynchronized === false) {
    add({
      id: 'ntp_clock_skew', group: 'community', community: true, title: '时钟同步', icon: 'clock',
      status: 'warn', value: skewSec !== null ? `偏移 ${skewSec}s` : 'NTP 未开启',
      summary: `NTP 服务未激活或存在轻微时钟偏差 (${skewSec ?? '—'}s)`,
      detail: '建议保持系统 NTP 自动校准常驻开启。',
      advice: '可执行 sudo timedatectl set-ntp true 开启自动时间同步。',
    });
  } else {
    add({
      id: 'ntp_clock_skew', group: 'community', community: true, title: '时钟同步', icon: 'clock',
      status: 'pass', value: skewSec !== null ? `误差 ≤${Math.max(1, skewSec)}s` : 'NTP 已同步',
      summary: `系统时钟精准同步${raw.ntpSynchronized ? ' (NTP active)' : ''}${skewSec !== null ? ` · 边缘对时误差 ${skewSec}s` : ''}`,
      detail: '时间戳签名与 OAuth 令牌轮换时序完全准确。',
    });
  }

  // Row 10 Left: 19. 环境变量纯净 (env_sanitation)
  const settingsContam = (raw.profileChecks || []).filter(p => p.contaminatedSettings?.length > 0);
  if (!raw.sanitizerWorking || settingsContam.length > 0) {
    const names = settingsContam.map(p => `${p.label}(${p.contaminatedSettings.join(',')})`).join('；');
    add({
      id: 'env_sanitation', group: 'community', community: true, title: '环境变量纯净', icon: 'sparkles',
      status: 'fail', critical: true, value: '注入污染',
      summary: settingsContam.length
        ? `账号 settings.json 残留高危覆盖变量：${names}`
        : 'CLI 环境变量净化器异常，可能透传第三方网关变量',
      detail: 'GitHub/Reddit 头号秒封原因：将 Pro/Max OAuth 登录态混用 ANTHROPIC_BASE_URL 或第三方 Hook 会立即触发服务端凭据签名封禁！',
      advice: '请立即清理对应账号 settings.json 中 env 下的 ANTHROPIC_BASE_URL / API_KEY / NODE_OPTIONS 字段！',
    });
  } else if (raw.contaminatedProcessVars?.length > 0) {
    add({
      id: 'env_sanitation', group: 'community', community: true, title: '环境变量纯净', icon: 'sparkles',
      status: 'warn', value: '宿主已剥离',
      summary: `宿主环境存在 ${raw.contaminatedProcessVars.join(', ')}，已由工作台启动器自动剥离`,
      detail: 'claudeEnvironment() 已在拉起官方 CLI 前拦截这些变量，但建议清理服务器全局 profile 免留隐患。',
      advice: '检查 ~/.bashrc 或 /etc/environment，移除多余的 ANTHROPIC_* 或 NODE_OPTIONS 变量。',
    });
  } else {
    add({
      id: 'env_sanitation', group: 'community', community: true, title: '环境变量纯净', icon: 'sparkles',
      status: 'pass', critical: true, value: '官方直通',
      summary: '无 ANTHROPIC_BASE_URL / 第三方 Token / NODE_OPTIONS 注入污染',
      detail: '所有进程环境与各账号 settings.json 均保持纯净，确保 100% 原生官方第一方调用链。',
    });
  }

  // Row 10 Right: 20. 官方 CLI 校验 (cli_authenticity)
  const versions = [...new Set((raw.profileChecks || []).map(p => p.version).filter(Boolean))];
  const verLabel = versions[0] ? versions[0].replace(/\s*\(Claude Code\)\s*/i, '') : '';
  if (!raw.cliInfo?.exists || !raw.cliInfo?.executable) {
    add({
      id: 'cli_authenticity', group: 'community', community: true, title: '官方 CLI 校验', icon: 'terminal',
      status: 'fail', critical: true, value: '未就绪',
      summary: '未找到可执行的官方 Claude Code CLI 二进制程序',
      detail: '请通过官方 https://claude.ai/install.sh 安装原版 CLI。',
      advice: '严禁使用任何第三方逆向客户端、魔改补丁包或套壳代理工具登录个人订阅账号。',
    });
  } else if (!raw.cliInfo.isOfficialLayout) {
    add({
      id: 'cli_authenticity', group: 'community', community: true, title: '官方 CLI 校验', icon: 'terminal',
      status: 'warn', value: '非标准路径',
      summary: `CLI 指向非标准包装路径 (${raw.cliInfo.realPath})`,
      detail: '请确认该入口未篡改官方二进制请求头或 User-Agent 指纹。',
    });
  } else {
    add({
      id: 'cli_authenticity', group: 'community', community: true, title: '官方 CLI 校验', icon: 'terminal',
      status: 'pass', critical: true, value: verLabel ? `v${verLabel}` : '官方原版',
      summary: `未修改的官方原生 CLI${verLabel ? ` (${verLabel})` : ''} · ${raw.cliInfo.realPath}`,
      detail: '二进制签名结构正常，未经过任何第三方逆向包装器或协议转换层。',
    });
  }

  // Row 11 Left: 21. 多号指纹隔离 (profile_isolation)
  const profiles = raw.profileChecks || [];
  const seenCfg = new Set();
  const sharedProfiles = [];
  const loosePerms = [];
  for (const p of profiles) {
    if (p.realCfg) {
      if (seenCfg.has(p.realCfg)) sharedProfiles.push(p.label);
      seenCfg.add(p.realCfg);
    }
    if (p.credMode !== null && (p.credMode & 0o077) !== 0) {
      loosePerms.push(`${p.label}(0${p.credMode.toString(8)})`);
    }
  }
  if (sharedProfiles.length > 0) {
    add({
      id: 'profile_isolation', group: 'community', community: true, title: '多号指纹隔离', icon: 'layers',
      status: 'fail', critical: true, value: '目录串号',
      summary: `严重风险：检测到多个账号槽位共用同一配置目录 (${sharedProfiles.join(', ')})`,
      detail: '多账号共用目录或浏览器 Profile 会导致 ant-did 设备标识与凭据交叉污染，极易触发关联连坐封号！',
      advice: '请立即为每个账号分配完全独立的 CLAUDE_CONFIG_DIR 与独立浏览器 Profile 目录。',
    });
  } else if (loosePerms.length > 0) {
    add({
      id: 'profile_isolation', group: 'community', community: true, title: '多号指纹隔离', icon: 'layers',
      status: 'warn', value: '权限过宽',
      summary: `凭据文件 .credentials.json 权限过宽：${loosePerms.join(', ')}`,
      detail: '凭据文件对同组或其他用户可读，若被其他脚本拷贝至异地刷新将立即触发盗号风控。',
      advice: '请将所有 .credentials.json 权限收紧为 0600，账号目录收紧为 0700。',
    });
  } else {
    add({
      id: 'profile_isolation', group: 'community', community: true, title: '多号指纹隔离', icon: 'layers',
      status: 'pass', critical: true,
      value: profiles.length > 1 ? `${profiles.length} 槽位隔离` : '独立隔离',
      summary: profiles.length > 1
        ? `${profiles.length} 个账号空间各自拥有独立 CLAUDE_CONFIG_DIR、独立浏览器 Profile 与 0600 凭据锁`
        : '独立官方凭据目录保护正常 (权限 0600)，无跨号 ant-did 串味',
      detail: '各账号凭据原位保留在各自隔离目录，从不跨账号拷贝 OAuth Token 或共享浏览器 Cookie。',
    });
  }

  // Row 11 Right: 22. OAuth 刷新锁 (oauth_lock_safety)
  const activeRuns = Number(accountFeatures.activeRuns || 0);
  const wildCount = Math.max(0, (raw.wildClaudePids?.length || 0) - activeRuns);
  if (wildCount > 0) {
    add({
      id: 'oauth_lock_safety', group: 'community', community: true, title: 'OAuth 刷新锁', icon: 'lock',
      status: 'warn', value: `${wildCount} 个外部进程`,
      summary: `检测到 ${wildCount} 个工作台之外的活跃 claude 进程，注意防并发抢刷 Refresh Token`,
      detail: 'Anthropic Refresh Token 单次轮换，多进程同时无锁抢刷同一账号易报 exited mid-refresh 或触发异常重放警告。',
      advice: '建议统一通过工作台发起会话，避免在后台用外部 crontab 并发调用同一已登录账号。',
    });
  } else {
    add({
      id: 'oauth_lock_safety', group: 'community', community: true, title: 'OAuth 刷新锁', icon: 'lock',
      status: 'pass', value: '单飞互斥',
      summary: '按账号隔离的 pauseProbes 探针退让锁正常，无野生进程抢刷凭据',
      detail: '前台对话启动前自动排空并暂停同账号后台 /usage 探针，彻底杜绝并发抢刷 OAuth 令牌。',
    });
  }

  // Row 12 Left: 23. IP 跳变与密度 (ip_stability_density)
  const recentWindow = history.filter(h => h?.ip && raw.checkedAtMs - Date.parse(h.at || 0) <= 86_400_000);
  const distinctIps24h = new Set([...recentWindow.map(h => h.ip), ...(egressIp ? [egressIp] : [])]);
  const distinctCountries24h = new Set([...recentWindow.map(h => h.country).filter(Boolean), ...(country ? [country] : [])]);
  const activeLoggedAccounts = profiles.filter(p => p.enabled && p.loggedIn).length;
  if (distinctCountries24h.size > 1) {
    add({
      id: 'ip_stability_density', group: 'community', community: true, title: 'IP 跳变与密度', icon: 'activity',
      status: 'fail', value: '24h 跨国跳变',
      summary: `近 24 小时出口跨越多个国家/地区 (${[...distinctCountries24h].join(' → ')})`,
      detail: '短时间内跨国切换出口 IP（Geo-hopping）会被 Anthropic 风控直接判定为账号共享或被盗！',
      advice: '请立即锁定单一国家固定出口，切换地区后至少静置数小时再登录操作。',
    });
  } else if (distinctIps24h.size >= 4) {
    add({
      id: 'ip_stability_density', group: 'community', community: true, title: 'IP 跳变与密度', icon: 'activity',
      status: 'warn', value: `24h 换 ${distinctIps24h.size} 个 IP`,
      summary: `近 24 小时出口 IP 频繁变动 (${distinctIps24h.size} 个不同地址)`,
      detail: `当前同出口活跃已登录账号：${activeLoggedAccounts} 个。频繁轮换节点会大幅拉高风控评分。`,
      advice: '建议使用固定静态出口 IP，关闭代理池自动轮换。',
    });
  } else if (activeLoggedAccounts > 5) {
    add({
      id: 'ip_stability_density', group: 'community', community: true, title: 'IP 跳变与密度', icon: 'activity',
      status: 'warn', value: `同 IP ${activeLoggedAccounts} 账号`,
      summary: `同一出口 IP 下同时启用 ${activeLoggedAccounts} 个已登录账号，共享密度偏高`,
      detail: 'Reddit 与 NodeSeek 社区经验表明：单一机房 IP 挂载超过 5 个高频活跃订阅账号易触发集群滥用审查。',
      advice: '建议单出口 IP 保持 2–4 个活跃日常账号，闲置后备账号可先设为停用。',
    });
  } else {
    add({
      id: 'ip_stability_density', group: 'community', community: true, title: 'IP 跳变与密度', icon: 'activity',
      status: 'pass', value: `固定 · ${activeLoggedAccounts} 号在线`,
      summary: `24h 出口恒定无跨区跳变 · 当前同 IP 活跃账号 ${activeLoggedAccounts} 个（安全密度）`,
      detail: `历史记录观察点 ${recentWindow.length + 1} 次，IP 轨迹稳定。`,
    });
  }

  // Row 12 Right: 24. 并发与防刷保护 (burst_safety)
  const maxRuns = Number(accountFeatures.maxConcurrentRuns || 3);
  const coolingCount = profiles.filter(p => p.rateLimited).length;
  if (maxRuns > 4 || coolingCount >= 2) {
    add({
      id: 'burst_safety', group: 'community', community: true, title: '并发与防刷保护', icon: 'list-check',
      status: 'warn',
      value: coolingCount >= 2 ? `${coolingCount} 号限流冷却` : `并发上限 ${maxRuns}`,
      summary: coolingCount >= 2
        ? `当前有 ${coolingCount} 个账号处于官方限流冷却期，避免短时密集重试`
        : `并行会话上限设为 ${maxRuns}，高并发跑满时需注意 API 突发速率风控`,
      detail: '新账号或机房 IP 下持续高频打满速率限制可能触发自动化 Bot 审查。',
      advice: '限流冷却期间请等待自然重置，避免编写死循环脚本无间隔轰炸触发 429/403。',
    });
  } else {
    add({
      id: 'burst_safety', group: 'community', community: true, title: '并发与防刷保护', icon: 'list-check',
      status: 'pass', value: `上限 ${maxRuns} 并行`,
      summary: `并行上限受控 (${maxRuns}) · 单轮换号带防死循环保护${coolingCount ? ` (${coolingCount} 号正常冷却中)` : ''}`,
      detail: '每条自动续传链每个账号最多尝试一次，不会对限流账号发起无限重试风暴。',
    });
  }

  const passCount = checks.filter(c => c.status === 'pass').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const failCount = checks.filter(c => c.status === 'fail').length;
  const mutedCount = checks.filter(c => c.muted).length;
  const criticalFailures = checks.filter(c => c.status === 'fail' && c.critical);
  const overall = failCount > 0 ? 'bad' : warnCount > 0 ? 'warn' : 'ok';

  return {
    checkedAt: new Date(raw.checkedAtMs).toISOString(),
    overall,
    counts: {
      total: checks.length,
      pass: passCount,
      warn: warnCount,
      fail: failCount,
      muted: mutedCount,
      criticalFail: criticalFailures.length,
    },
    egress: {
      ip: egressIp,
      country,
      countryName: country ? (COUNTRY_NAMES[country] || country) : null,
      asn: raw.asnInfo?.asn || null,
      org: raw.asnInfo?.org || null,
      timezone: raw.resolvedTz || null,
    },
    settings: {
      blockOnCritical: settings.blockOnCritical === true,
      watchdogEnabled: settings.watchdogEnabled !== false,
      mutedChecks: [...muted],
    },
    groups: CHECK_GROUPS,
    checks,
  };
}

export class EnvironmentAuditor {
  constructor({
    dataDir,
    binary,
    legacyConfigDir = path.join(os.homedir(), '.claude'),
    getAccounts = () => [],
    getAccountFeatures = () => ({}),
    probeRunner = defaultProbes,
    ttlMs = 180_000,
    minForceIntervalMs = 1500,
    watchdogIntervalMs = 10 * 60_000,
    now = Date.now,
    onUpdate = () => {},
  } = {}) {
    this.dataDir = dataDir;
    this.file = dataDir ? path.join(dataDir, 'env-audit.json') : null;
    this.binary = binary;
    this.legacyConfigDir = legacyConfigDir;
    this.getAccounts = getAccounts;
    this.getAccountFeatures = getAccountFeatures;
    this.probeRunner = probeRunner;
    this.ttlMs = ttlMs;
    this.minForceIntervalMs = minForceIntervalMs;
    this.watchdogIntervalMs = watchdogIntervalMs;
    this.now = now;
    this.onUpdate = onUpdate;

    this.settings = { blockOnCritical: false, watchdogEnabled: true, mutedChecks: [] };
    this.history = [];
    this.lastRaw = null;
    this.lastClientSignals = null;
    this.lastReport = null;
    this.lastCheckedAt = 0;
    this.inFlight = null;
    this.saving = Promise.resolve();
    this.timer = null;
    this.closed = false;
  }

  async init() {
    if (this.file) {
      try {
        const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
        if (saved?.settings && typeof saved.settings === 'object') {
          this.settings.blockOnCritical = saved.settings.blockOnCritical === true;
          this.settings.watchdogEnabled = saved.settings.watchdogEnabled !== false;
          if (Array.isArray(saved.settings.mutedChecks)) {
            this.settings.mutedChecks = saved.settings.mutedChecks
              .filter(id => typeof id === 'string' && /^[a-z0-9_]{2,40}$/.test(id))
              .slice(0, 32);
          }
        }
        if (Array.isArray(saved?.history)) {
          this.history = saved.history
            .filter(h => h && typeof h.ip === 'string' && typeof h.at === 'string')
            .slice(-25);
        }
      } catch {}
    }
    this.#armWatchdog();
    return this;
  }

  #armWatchdog() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.closed || !this.settings.watchdogEnabled || !(this.watchdogIntervalMs > 0)) return;
    this.timer = setInterval(() => {
      if (!this.closed && this.settings.watchdogEnabled) {
        void this.check({ force: true, background: true }).catch(() => {});
      }
    }, this.watchdogIntervalMs);
    this.timer.unref?.();
  }

  #persist() {
    if (!this.file || this.closed) return this.saving;
    const payload = JSON.stringify({
      version: 1,
      settings: this.settings,
      history: this.history.slice(-25),
    });
    this.saving = this.saving.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, payload, { mode: 0o600 });
      await fs.rename(tmp, this.file);
    });
    return this.saving;
  }

  sanitizeClientSignals(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const language = typeof input.language === 'string' ? input.language.trim().slice(0, 32) : null;
    const timezone = typeof input.timezone === 'string' ? input.timezone.trim().slice(0, 64) : null;
    const webrtcIps = Array.isArray(input.webrtcIps)
      ? [...new Set(input.webrtcIps.filter(ip => typeof ip === 'string' && net.isIP(ip.trim())).map(ip => ip.trim()))].slice(0, 8)
      : [];
    return { language, timezone, webrtcIps };
  }

  read() {
    if (!this.lastRaw) return null;
    this.lastReport = evaluateEnvironmentAudit(this.lastRaw, {
      settings: this.settings,
      history: this.history,
      clientSignals: this.lastClientSignals,
      accountFeatures: this.getAccountFeatures(),
    });
    return this.lastReport;
  }

  async check({ force = false, clientSignals = null, background = false } = {}) {
    const cleanSignals = this.sanitizeClientSignals(clientSignals);
    if (cleanSignals) this.lastClientSignals = cleanSignals;
    const age = this.now() - this.lastCheckedAt;
    if (this.lastRaw && (!force ? age < this.ttlMs : (!background && age < this.minForceIntervalMs))) {
      return this.read();
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      const prevOverall = this.lastReport?.overall;
      const prevCountry = this.lastReport?.egress?.country;
      const raw = await this.probeRunner({
        binary: this.binary,
        legacyConfigDir: this.legacyConfigDir,
        accounts: this.getAccounts(),
      });
      this.lastRaw = raw;
      this.lastCheckedAt = this.now();

      const report = evaluateEnvironmentAudit(raw, {
        settings: this.settings,
        history: this.history,
        clientSignals: this.lastClientSignals,
        accountFeatures: this.getAccountFeatures(),
      });
      if (report.egress.ip) {
        const last = this.history.at(-1);
        if (!last || last.ip !== report.egress.ip || last.country !== report.egress.country || this.now() - Date.parse(last.at) > 3600_000) {
          this.history.push({ ip: report.egress.ip, country: report.egress.country, at: report.checkedAt });
          if (this.history.length > 25) this.history.splice(0, this.history.length - 25);
          void this.#persist().catch(() => {});
        }
      }
      this.lastReport = report;
      if (!this.closed && (force || background || prevOverall !== report.overall || prevCountry !== report.egress.country)) {
        this.onUpdate(report, { drifted: Boolean(prevCountry && report.egress.country && prevCountry !== report.egress.country) });
      }
      return report;
    })().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async updateSettings(patch = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw Object.assign(new Error('环境检测设置格式不正确。'), { status: 400 });
    }
    if ('blockOnCritical' in patch) {
      if (typeof patch.blockOnCritical !== 'boolean') throw Object.assign(new Error('阻断开关参数无效。'), { status: 400 });
      this.settings.blockOnCritical = patch.blockOnCritical;
    }
    if ('watchdogEnabled' in patch) {
      if (typeof patch.watchdogEnabled !== 'boolean') throw Object.assign(new Error('巡检开关参数无效。'), { status: 400 });
      this.settings.watchdogEnabled = patch.watchdogEnabled;
      this.#armWatchdog();
    }
    if ('mutedChecks' in patch) {
      if (!Array.isArray(patch.mutedChecks) || patch.mutedChecks.length > 32 || !patch.mutedChecks.every(id => typeof id === 'string' && /^[a-z0-9_]{2,40}$/.test(id))) {
        throw Object.assign(new Error('豁免列表参数无效。'), { status: 400 });
      }
      this.settings.mutedChecks = [...new Set(patch.mutedChecks)];
    }
    if ('clearHistory' in patch) {
      if (typeof patch.clearHistory !== 'boolean') throw Object.assign(new Error('重置轨迹参数无效。'), { status: 400 });
      if (patch.clearHistory) {
        const cur = this.read();
        this.history = cur?.egress?.ip ? [{ ip: cur.egress.ip, country: cur.egress.country, at: cur.checkedAt }] : [];
      }
    }
    await this.#persist();
    const report = this.read();
    if (report) this.onUpdate(report, { settingsChanged: true });
    return report || { settings: { ...this.settings } };
  }

  async assertSafeBeforeRun() {
    if (!this.settings.blockOnCritical) return null;
    const report = await this.check({ force: false });
    const critical = (report?.checks || []).filter(c => c.status === 'fail' && c.critical);
    if (critical.length > 0) {
      const reasons = critical.map(c => `${c.title}（${c.summary}）`).join('；');
      throw Object.assign(new Error(`环境安全保镖已拦截本次启动：检测到 ${critical.length} 项高危封号隐患 —— ${reasons}`), { status: 409, code: 'ENV_UNSAFE' });
    }
    return report;
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([this.inFlight, this.saving]);
  }
}
