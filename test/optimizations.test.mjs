import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkbench } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';
import { cleanPreview, newSession, summary } from '../lib/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://198.51.100.10:17880';
const PASSWORD = 'test-only-optimizations-pass';
const passwordRecord = await hashPassword(PASSWORD);
const VERSION = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).version;

function fakeRunner() {
  const calls = [];
  return {
    calls,
    factory(options) {
      let resolve, done = false;
      const call = { options, stops: 0, emit: event => options.onEvent(event) };
      const completion = new Promise(r => { resolve = r; });
      call.finish = async (result = { code: 0 }) => {
        if (done) return completion;
        done = true;
        if (result.code === 0) call.emit({ type: 'done' });
        await options.onExit(result);
        resolve(result);
        return result;
      };
      call.handle = {
        done: completion,
        steer: () => ({ ok: true, id: 'steer-1' }),
        stop() { call.stops++; void call.finish({ code: null, stopped: true }); return true; },
        respondPermission: () => true,
      };
      calls.push(call);
      return call.handle;
    },
  };
}

async function createFixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-opt-'));
  const dataDir = path.join(dir, 'data');
  const workspaceRoot = path.join(dir, 'workspaces');
  let cliVersion = '2.1.320 (Claude Code)';
  const authCalls = [];
  const usageCalls = [];
  const probeCalls = [];
  let modelSet = [
    { value: 'opus', displayName: 'Opus 5.5', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'fable', displayName: 'Fable 5.1', resolvedModel: 'claude-fable-5-1', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] },
  ];
  const usageSnapshot = {
    fiveHour: { utilization: 12 },
    sevenDay: { utilization: 28 },
    scopes: [{ key: 'seven_day_fable', label: 'Fable 周剩余', utilization: 34, resetsAt: '2099-01-05T00:00:00Z' }],
    stale: false,
  };
  const fake = fakeRunner();
  const wb = await createWorkbench({
    dataDir,
    workspaceRoot,
    origin: ORIGIN,
    passwordRecord,
    workshopUrl: 'off',
    monitor: {
      sample: async activeRuns => ({ activeRuns, host: 'test-node' }),
      auth: async (opts = {}) => {
        authCalls.push(opts);
        return { loggedIn: true, subscriptionType: 'max', authMethod: 'claude.ai', version: cliVersion };
      },
    },
    usageMonitor: {
      read: () => ({ ...usageSnapshot }),
      refresh: async (opts = {}) => {
        usageCalls.push(opts);
        return { ...usageSnapshot };
      },
      observe: () => {},
      close: async () => {},
    },
    modelProbe: async ctx => {
      probeCalls.push(ctx);
      return { version: cliVersion, models: modelSet };
    },
    runFactory: fake.factory,
    ...overrides,
  });
  const server = await new Promise(resolve => {
    const s = wb.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';

  t.after(async () => {
    await wb.close();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function api(route, { method = 'GET', body, auth = true } = {}) {
    const headers = {
      Origin: ORIGIN,
      'X-Forwarded-For': '198.51.100.10',
      ...(auth && cookie ? { Cookie: cookie } : {}),
      ...(method !== 'GET' && method !== 'HEAD' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}),
    };
    const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed, headers: response.headers };
  }

  async function login() {
    const res = await api('/api/login', { method: 'POST', body: { password: PASSWORD }, auth: false });
    assert.equal(res.status, 200);
    cookie = res.headers.get('set-cookie').split(';')[0];
    csrf = res.body.csrfToken;
  }

  return {
    wb,
    base,
    fake,
    api,
    login,
    authCalls,
    usageCalls,
    probeCalls,
    setCliRelease(ver, models) {
      cliVersion = ver;
      if (models) modelSet = models;
    },
  };
}

test('cold bootstrap seeds zero-turn model catalog, warm bootstrap serves cached state, and CLI version bumps re-probe Fable 5.2', async t => {
  const f = await createFixture(t);
  await f.login();

  // Cold bootstrap waits for initial auth and modelProbe so first paint already knows the account's live models.
  const cold = await f.api('/api/bootstrap');
  assert.equal(cold.status, 200);
  assert.equal(f.authCalls.length, 1);
  assert.equal(f.authCalls[0].wait, true);
  assert.equal(f.probeCalls.length, 1);
  assert.deepEqual(cold.body.config.models.map(m => [m.value, m.displayName]), [
    ['opus', 'Opus 5.5'],
    ['fable', 'Fable 5.1'],
  ]);
  assert.equal(cold.body.usage.scopes[0].label, 'Fable 周剩余');

  // Warm bootstrap serves cached models without re-probing when CLI version has not changed.
  const probesBeforeWarm = f.probeCalls.length;
  const warm = await f.api('/api/bootstrap');
  assert.equal(warm.status, 200);
  assert.equal(f.probeCalls.length, probesBeforeWarm);

  // CLI binary upgrades to 2.1.322 with Fable 5.2 and Haiku 5.5 effort support: warmup/syncModels detects version drift and refreshes.
  f.setCliRelease('2.1.322 (Claude Code)', [
    { value: 'opus', displayName: 'Opus 5.5', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'fable', displayName: 'Fable 5.2', resolvedModel: 'claude-fable-5-2', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
    { value: 'haiku', displayName: 'Haiku 5.5', resolvedModel: 'claude-haiku-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'], supportsThinkingOff: true },
  ]);
  await f.wb.warmup();
  assert.equal(f.probeCalls.length, probesBeforeWarm + 1);

  const fresh = await f.api('/api/bootstrap?fresh=1');
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.body.config.models.map(m => [m.value, m.displayName, m.resolvedModel]), [
    ['opus', 'Opus 5.5', 'claude-opus-5-5'],
    ['fable', 'Fable 5.2', 'claude-fable-5-2'],
    ['haiku', 'Haiku 5.5', 'claude-haiku-5-5'],
  ]);
  assert.equal(fresh.body.config.models[2].supportsThinkingOff, true);
});

test('foreground turns on the default profile pause background OAuth and usage probes until exit', async t => {
  const f = await createFixture(t);
  await f.login();
  await f.wb.warmup();

  const created = await f.api('/api/sessions', { method: 'POST', body: { title: '并发锁回归', model: 'fable' } });
  assert.equal(created.status, 201);
  const sessionId = created.body.id;

  const sent = await f.api(`/api/sessions/${sessionId}/messages`, { method: 'POST', body: { text: '检查 OAuth 互斥协调' } });
  assert.equal(sent.status, 202);
  assert.equal(f.fake.calls.length, 1);

  f.authCalls.length = 0;
  f.usageCalls.length = 0;
  const duringRun = await f.api('/api/bootstrap?fresh=1');
  assert.equal(duringRun.status, 200);
  assert.equal(f.authCalls.length, 0, 'cached default auth is reused without spawning auth status during an active turn');
  assert.equal(f.usageCalls.length, 0, 'usage probe is deferred during an active turn');
  assert.equal(duringRun.body.usage.stale, true);
  assert.match(duringRun.body.usage.unavailableReason, /后台用量探测已暂缓/);

  await f.fake.calls[0].finish({ code: 0 });
  const afterRun = await f.api('/api/usage');
  assert.equal(afterRun.status, 200);
  assert.equal(f.usageCalls.length, 1);
  assert.equal(afterRun.body.stale, false);
});

test('sessions can be pinned or unpinned while running, while other session mutations still return 409', async t => {
  const f = await createFixture(t);
  await f.login();

  const created = await f.api('/api/sessions', { method: 'POST', body: { title: '置顶测试', model: 'fable' } });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.pinned, false);

  const started = await f.api(`/api/sessions/${id}/messages`, {
    method: 'POST',
    body: { text: '帮我梳理部署清单\n\n引用当前工作区文件：\n- deploy/nginx/cloud-ops-workbench.conf' },
  });
  assert.equal(started.status, 202);

  // Pinning alone is allowed while running.
  const pinned = await f.api(`/api/sessions/${id}`, { method: 'PATCH', body: { pinned: true } });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.body.pinned, true);

  // Combining pinned with title/model mutation while running is rejected.
  const rejected = await f.api(`/api/sessions/${id}`, { method: 'PATCH', body: { pinned: false, title: '运行中改名' } });
  assert.equal(rejected.status, 409);

  const list = await f.api('/api/sessions');
  assert.equal(list.status, 200);
  const row = list.body.find(item => item.id === id);
  assert.equal(row.pinned, true);
  assert.equal(row.preview, '帮我梳理部署清单');

  await f.fake.calls[0].finish({ code: 0 });
});

test('session summary preview strips workspace attachment footers and ignores steers and auto-continue prompts', () => {
  assert.equal(cleanPreview('  第一行提问\n第二行补充\n\n引用当前工作区文件：\n- server.mjs  '), '第一行提问 第二行补充');
  const s = newSession({ title: '摘要过滤' });
  s.messages.push(
    { id: '1', role: 'user', text: '实现首屏 immutable 静态缓存\n\n引用当前工作区文件：\n- server.mjs', createdAt: '2026-11-12T01:00:00Z' },
    { id: '2', role: 'user', text: '顺便检查一下字体缓存', steer: 'sent', createdAt: '2026-11-12T01:01:00Z' },
    { id: '3', role: 'user', text: '上一轮因「主账号」5 小时额度用尽中断，工作台已自动换到「备用账号」，对话历史已接续。', createdAt: '2026-11-12T01:02:00Z' },
  );
  const sum = summary(s);
  assert.equal(sum.preview, '实现首屏 immutable 静态缓存');
});

test('static asset caching, lazy-loaded HTML shell and Nginx HTTPS gzip configuration match 1.7.0 release invariants', async t => {
  const f = await createFixture(t);

  const htmlRes = await fetch(`${f.base}/`);
  assert.equal(htmlRes.status, 200);
  assert.equal(htmlRes.headers.get('cache-control'), 'no-cache');

  const versionedJs = await fetch(`${f.base}/app.js?v=${VERSION}`);
  assert.equal(versionedJs.status, 200);
  assert.equal(versionedJs.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const versionedVendor = await fetch(`${f.base}/vendor/marked.js?v=${VERSION}`);
  assert.equal(versionedVendor.status, 200);
  assert.equal(versionedVendor.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const unversionedJs = await fetch(`${f.base}/app.js`);
  assert.equal(unversionedJs.status, 200);
  assert.equal(unversionedJs.headers.get('cache-control'), 'public, max-age=0, must-revalidate');

  const indexHtml = await fs.readFile(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.doesNotMatch(indexHtml, /xterm|workshop\.js/, 'xterm and workshop bundles must stay lazy-loaded off the initial HTML shell');
  const assetRefs = [...indexHtml.matchAll(/(?:href|src)="\/([^"]+)"/g)].map(m => m[1]).filter(ref => /\.(?:css|js)\b/.test(ref));
  assert.ok(assetRefs.length >= 3);
  for (const ref of assetRefs) {
    assert.ok(ref.endsWith(`?v=${VERSION}`), `expected ${ref} in index.html to carry ?v=${VERSION}`);
  }

  const nginxConf = await fs.readFile(path.join(ROOT, 'deploy/nginx/cloud-ops-workbench.conf'), 'utf8');
  assert.match(nginxConf, /gzip\s+on;/);
  assert.match(nginxConf, /text\/javascript/);
  assert.match(nginxConf, /font\/ttf/);
  assert.match(nginxConf, /application\/wasm/);
});
