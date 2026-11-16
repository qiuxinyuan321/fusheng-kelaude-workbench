import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { evaluateEnvironmentAudit, EnvironmentAuditor } from '../lib/env-audit.mjs';
import { createWorkbench } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';

const ORIGIN = 'https://claude.test.invalid';
const PASSWORD = 'test-only-password-do-not-deploy';
const record = await hashPassword(PASSWORD);

function cleanRaw(overrides = {}) {
  const now = 1_794_796_000_000;
  return {
    checkedAtMs: now,
    resolvedTz: 'Asia/Tokyo',
    localeEnv: 'en_US.UTF-8',
    interfaces: [{ name: 'eth0', family: 'IPv4', address: '198.51.100.10', internal: false }],
    ipv6SocketBlocked: true,
    ipv6BlockCode: 'EAFNOSUPPORT',
    dnsServers: ['8.8.8.8', '1.1.1.1'],
    proxyCores: [],
    local7890: false,
    configuredProxy: null,
    configuredProxyAlive: null,
    ipRules: '0:\tfrom all lookup local\n32766:\tfrom all lookup main',
    unitHasAddressSandbox: true,
    hasRemoteBrowser: false,
    browserHasDisableQuic: false,
    browserHasNoProxy: false,
    ntpSynchronized: true,
    trace: {
      ok: true, source: 'claude.ai', ip: '198.51.100.10', loc: 'JP',
      warp: 'off', tls: 'TLSv1.3', http: 'h2', colo: 'NRT', latencyMs: 8, serverDate: now - 1000,
    },
    independentIp: { ok: true, ip: '198.51.100.10', source: 'api.ipify.org', latencyMs: 14 },
    dnsRes: { ok: true, apiAddrs: ['160.79.104.10'], webAddrs: ['160.79.104.11'] },
    ecosystem: [
      { id: 'api', host: 'api.anthropic.com', reachable: true, status: 404, latencyMs: 11, blocked: false },
      { id: 'web', host: 'claude.ai', reachable: true, status: 200, latencyMs: 9, blocked: false },
      { id: 'oauth', host: 'claude.com', reachable: true, status: 200, latencyMs: 12, blocked: false },
      { id: 'platform', host: 'platform.claude.com', reachable: true, status: 200, latencyMs: 16, blocked: false },
    ],
    tlsInfo: {
      ok: true, authorized: true, protocol: 'TLSv1.3', alpn: 'h2',
      issuerOrg: 'Google Trust Services', rootOrg: 'GTS Root R1', daysRemaining: 65, latencyMs: 13,
    },
    ipv6Egress: { blockedBySandbox: true },
    asnInfo: {
      ok: true, source: 'ipinfo.io', asn: 'AS2516', org: 'KDDI CORPORATION',
      isp: 'KDDI', country: 'JP', timezone: 'Asia/Tokyo', reportedType: 'isp',
    },
    cliInfo: { exists: true, executable: true, realPath: '/usr/local/share/claude/versions/2.1.105', isOfficialLayout: true },
    contaminatedProcessVars: [],
    tlsBypassEnv: false,
    sanitizerWorking: true,
    profileChecks: [
      { id: 'primary', label: '默认账号', enabled: true, loggedIn: true, rateLimited: false, version: '2.1.105', realCfg: '/tmp/claude-primary', dirMode: 0o700, credMode: 0o600, contaminatedSettings: [] },
    ],
    wildClaudePids: [],
    ...overrides,
  };
}

test('evaluates all 24 anti-ban checks in exact 14 core + 10 community order when clean', () => {
  const report = evaluateEnvironmentAudit(cleanRaw(), {
    clientSignals: { language: 'zh-CN', timezone: 'Asia/Shanghai', webrtcIps: [] },
    accountFeatures: { activeRuns: 0, maxConcurrentRuns: 3 },
  });
  assert.equal(report.overall, 'ok');
  assert.equal(report.counts.total, 24);
  assert.equal(report.counts.pass, 24);
  assert.equal(report.counts.warn, 0);
  assert.equal(report.counts.fail, 0);
});

test('catches high-risk ban vectors across region, IPv6, DNS, WARP, MITM TLS, env contamination, profile collision and geo-hopping', () => {
  const now = 1_794_796_000_000;
  const report = evaluateEnvironmentAudit(cleanRaw({
    resolvedTz: 'Asia/Shanghai',
    localeEnv: 'zh_CN.UTF-8',
    ipv6SocketBlocked: false,
    unitHasAddressSandbox: false,
    dnsServers: ['114.114.114.114'],
    trace: {
      ok: true, source: '1.1.1.1', ip: '203.0.113.8', loc: 'CN',
      warp: 'on', tls: 'TLSv1.3', http: 'h2', colo: 'HKG', latencyMs: 45, serverDate: now - 95_000,
    },
    independentIp: { ok: true, ip: '198.51.100.77', source: 'api.ipify.org', latencyMs: 60 },
    ipv6Egress: { reachable: true, ip: '240e::1234', loc: 'CN' },
    ecosystem: [{ id: 'api', host: 'api.anthropic.com', reachable: true, status: 403, latencyMs: 40, blocked: true }],
    tlsInfo: { ok: true, authorized: true, protocol: 'TLSv1.3', alpn: 'h2', issuerOrg: 'Mihomo Root CA', rootOrg: 'Clash Meta', daysRemaining: 365, latencyMs: 3 },
    profileChecks: [
      { id: 'primary', label: '主号', enabled: true, loggedIn: true, rateLimited: true, realCfg: '/tmp/shared-claude', dirMode: 0o755, credMode: 0o644, contaminatedSettings: ['ANTHROPIC_BASE_URL'] },
      { id: 'acct-2', label: '副号', enabled: true, loggedIn: true, rateLimited: true, realCfg: '/tmp/shared-claude', dirMode: 0o755, credMode: 0o644, contaminatedSettings: [] },
    ],
    wildClaudePids: [41001, 41002],
  }), {
    history: [{ ip: '198.51.100.10', country: 'JP', at: new Date(now - 3600_000).toISOString() }],
    clientSignals: { language: 'zh-CN', timezone: 'Asia/Shanghai', webrtcIps: ['203.0.113.99'] },
    accountFeatures: { activeRuns: 0, maxConcurrentRuns: 5 },
  });
  assert.equal(report.overall, 'bad');
  assert.ok(report.counts.criticalFail >= 7);
});

test('HTTP endpoints enforce auth/CSRF and Fail-Closed guard blocks message turns & native terminals when unsafe', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oss-env-audit-http-'));
  let unsafeMode = true;
  let spawnedRuns = 0;

  const usageSnapshot = { fiveHour: { utilization: 5, resetsAt: '2026-11-17T00:00:00Z' }, sevenDay: { utilization: 12, resetsAt: '2026-11-22T00:00:00Z' }, scopes: [], stale: false };
  const wb = await createWorkbench({
    dataDir: path.join(dir, 'data'),
    workspaceRoot: path.join(dir, 'workspaces'),
    legacyConfigDir: path.join(dir, 'legacy'),
    origin: ORIGIN,
    passwordRecord: record,
    workshopUrl: 'off',
    monitor: {
      async sample(activeRuns) { return { activeRuns, cpuPercent: 2 }; },
      async auth() { return { loggedIn: true, subscriptionType: 'max', version: '2.1.105' }; },
    },
    usageMonitor: { read: () => usageSnapshot, refresh: async () => usageSnapshot, observe: () => {}, close: async () => {} },
    envProbe: async () => unsafeMode
      ? cleanRaw({
        trace: { ok: true, source: 'claude.ai', ip: '203.0.113.9', loc: 'HK', warp: 'on', tls: 'TLSv1.3', http: 'h2', colo: 'HKG', latencyMs: 18, serverDate: 1_794_796_000_000 },
        independentIp: { ok: true, ip: '203.0.113.9', source: 'api.ipify.org', latencyMs: 20 },
      })
      : cleanRaw(),
    runFactory: options => {
      spawnedRuns++;
      setImmediate(() => { options.onEvent({ type: 'done' }); void options.onExit({ code: 0, stopped: false }); });
      return { done: Promise.resolve({ code: 0 }), stop: () => true, steer: () => ({ ok: false }), respondPermission: () => false };
    },
  });

  const server = await new Promise(resolve => { const s = wb.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await wb.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });

  assert.equal((await fetch(`${base}/api/env-audit`)).status, 401);

  const loginRes = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await loginRes.json();

  const req = async (route, { method = 'GET', body, csrf = csrfToken } = {}) => {
    const headers = { Origin: ORIGIN, Cookie: cookie };
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };

  assert.equal((await req('/api/env-audit/settings', { method: 'PUT', body: { blockOnCritical: true }, csrf: '' })).status, 403);
  const checked = await req('/api/env-audit/check', { method: 'POST', body: { force: true, clientSignals: { language: 'zh-CN', webrtcIps: [] } } });
  assert.equal(checked.body.overall, 'bad');

  const saved = await req('/api/env-audit/settings', { method: 'PUT', body: { blockOnCritical: true } });
  assert.equal(saved.status, 200);

  const created = await req('/api/sessions', { method: 'POST', body: { title: '防封测试' } });
  const sid = created.body.id;

  const blockedTurn = await req(`/api/sessions/${sid}/messages`, { method: 'POST', body: { text: '测试阻断' } });
  assert.equal(blockedTurn.status, 409);
  assert.match(blockedTurn.body.error, /环境安全保镖已拦截/);
  assert.equal(spawnedRuns, 0);

  const blockedTerm = await req('/api/terminals', { method: 'POST', body: { sessionId: sid, kind: 'claude', cols: 80, rows: 24 } });
  assert.equal(blockedTerm.status, 409);
  assert.match(blockedTerm.body.error, /环境安全保镖已拦截/);

  unsafeMode = false;
  await new Promise(r => setTimeout(r, 1600));
  await req('/api/env-audit/check', { method: 'POST', body: { force: true } });
  const resetHist = await req('/api/env-audit/settings', { method: 'PUT', body: { clearHistory: true } });
  assert.equal(resetHist.body.overall, 'ok');

  const allowedTurn = await req(`/api/sessions/${sid}/messages`, { method: 'POST', body: { text: '恢复后允许' } });
  assert.equal(allowedTurn.status, 202);
  assert.equal(spawnedRuns, 1);
});
