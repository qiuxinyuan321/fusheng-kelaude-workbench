import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorkbench } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';
import { BUNDLE_FORMAT } from '../lib/plugins.mjs';

const ORIGIN = 'https://plugins.test.invalid';
const PASSWORD = 'test-only-do-not-deploy-plugins';
const passwordRecord = await hashPassword(PASSWORD);
const exists = value => fs.lstat(value).then(() => true, () => false);
const serverManifest = id => ({ id, type: 'plugin', name: 'Fixture backend', version: '1.0.0', permissions: ['backend'], main: 'main.js', backend: 'backend.mjs', contributes: { panel: { title: 'Fixture' } } });

function fakeRunner() {
  const calls = [];
  return { calls, factory(options) {
    let resolve, done = false;
    const call = { options, stops: 0, emit: event => options.onEvent(event) };
    const completion = new Promise(r => { resolve = r; });
    call.finish = async (result = { code: 0 }) => {
      if (done) return completion;
      done = true;
      if (result.code === 0) call.emit({ type: 'done' });
      await options.onExit(result); resolve(result); return result;
    };
    call.handle = { done: completion, stop() { call.stops++; void call.finish({ code: null, stopped: true }); return true; }, respondPermission: () => true };
    calls.push(call); return call.handle;
  } };
}

async function fixture(t, overrides = {}) {
  const { primaryLoggedIn = true, ...serverOverrides } = overrides;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-backends-'));
  const dataDir = path.join(dir, 'data'), binary = path.join(dir, 'fake-claude');
  await fs.writeFile(binary, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'status') {
 const loggedIn = process.env.CLAUDE_CONFIG_DIR ? fs.existsSync(path.join(process.env.CLAUDE_CONFIG_DIR, '.test-logged-in')) : ${primaryLoggedIn === true};
 console.log(JSON.stringify({loggedIn, subscriptionType: 'pro', authMethod: 'claude.ai', email: 'fixture@example.invalid'}));
 process.exit(loggedIn ? 0 : 1);
}
if (args.includes('/usage')) {
 console.log(JSON.stringify({type: 'assistant', usage_report: {rate_limits: {limits: [{kind: 'session', percent: 2, resets_at: '2099-01-01T00:00:00Z'}, {kind: 'weekly_all', percent: 3, resets_at: '2099-01-01T00:00:00Z'}]}}}));
 console.log(JSON.stringify({type: 'result', num_turns: 0, duration_api_ms: 0, local_command: 'usage', is_error: false}));
 process.exit(0);
}
if (args.includes('--version')) {console.log('2.1.292 (test fixture)'); process.exit(0);}
process.stderr.write('unexpected fixture command'); process.exit(80);
`, { mode: 0o700 });
  const fake = fakeRunner(), usageSnapshot = { fiveHour: { utilization: 2 }, sevenDay: { utilization: 3 }, scopes: [], stale: false };
  const config = { dataDir, workspaceRoot: path.join(dir, 'workspaces'), binary, origin: ORIGIN, passwordRecord,
    monitor: { sample: async activeRuns => ({ activeRuns }), auth: async () => ({ loggedIn: true }) },
    usageMonitor: { read: () => usageSnapshot, refresh: async () => usageSnapshot, observe: () => {}, close: async () => {} },
    runFactory: fake.factory, workshopUrl: 'off', ...serverOverrides };
  let wb, server, base, cookie = '', csrf = '';
  async function start() {
    wb = await createWorkbench(config);
    server = await new Promise(resolve => { const value = wb.app.listen(0, '127.0.0.1', () => resolve(value)); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (!server) return;
    await wb.close(); await new Promise(resolve => server.close(resolve)); server = null;
  }
  async function api(route, { method = 'GET', body, auth = true, token = csrf, origin = ORIGIN } = {}) {
    const headers = { Origin: origin, ...(auth && cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': token } : {}) };
    const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text();
    return { status: response.status, body: raw ? JSON.parse(raw) : null, headers: response.headers };
  }
  async function login() {
    const result = await api('/api/login', { method: 'POST', body: { password: PASSWORD }, auth: false });
    assert.equal(result.status, 200); cookie = result.headers.get('set-cookie').split(';')[0]; csrf = result.body.csrfToken;
  }
  async function enable(id, enabled = true) {
    const result = await api(`/api/plugins/${id}/enable`, { method: 'POST', body: { enabled, granted: ['backend', 'sessions.read'] } });
    assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.plugins.find(plugin => plugin.id === id);
  }
  const backend = (id, method, params = {}, options = {}) => api(`/api/plugins/${id}/backend`, { method: 'POST', body: { method, params }, ...options });
  async function create() { const result = await api('/api/sessions', { method: 'POST', body: { permissionMode: 'default' } }); assert.equal(result.status, 201); return result.body; }
  async function send(session, text = '完成测试任务', requestId = randomUUID()) { return api(`/api/sessions/${session.id}/messages`, { method: 'POST', body: { text, requestId } }); }
  async function account(label) {
    const result = await backend('account-pool', 'create', { label }); assert.equal(result.status, 200, JSON.stringify(result.body));
    const account = result.body.accounts.find(value => value.label === label);
    const profile = path.join(dataDir, 'server-plugin-data', 'account-pool', 'profiles', account.id, 'config');
    await fs.writeFile(path.join(profile, '.test-logged-in'), 'fixture login only');
    assert.equal((await backend('account-pool', 'refresh', { id: account.id })).status, 200);
    return { ...account, profile };
  }
  async function transcript(call, id = randomUUID()) {
    assert.ok(call.options.configDir, 'fixture writes only to a temporary account config directory');
    const project = path.join(call.options.configDir, 'projects', call.options.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    await fs.mkdir(project, { recursive: true }); await fs.writeFile(path.join(project, `${id}.jsonl`), '{"type":"user","message":"synthetic transcript"}\n');
    call.emit({ type: 'session', sessionId: id }); return { id, project };
  }
  await start();
  t.after(async () => { await stop(); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, dataDir, config, fake, api, login, enable, backend, create, send, account, transcript, start, stop, get wb() { return wb; } };
}

test('bundled server plugins are inactive by default and the original single-account run is unchanged', async t => {
  const f = await fixture(t); await f.login();
  const result = await f.api('/api/plugins');
  for (const id of ['account-pool', 'task-resume']) {
    const plugin = result.body.plugins.find(value => value.id === id);
    assert.equal(plugin.active, false); assert.equal(plugin.backendReady, false);
    assert.equal(await exists(path.join(f.dataDir, 'server-plugin-data', id)), false);
    assert.equal((await f.backend(id, 'list')).status, 403);
  }
  const s = await f.create(); assert.equal((await f.send(s)).status, 202);
  assert.equal(f.fake.calls[0].options.configDir, undefined); assert.equal(f.fake.calls[0].options.permissionMode, 'default');
  await f.fake.calls[0].finish(); assert.equal(f.wb.store.get(s.id).status, 'idle');
});

test('draft quota follows composer choices without binding a session or starting a model request', async t => {
  const f = await fixture(t);
  await f.login(); await f.enable('account-pool');
  const extra = await f.account('Draft account');
  const route = choices => '/api/usage?choices=' + encodeURIComponent(JSON.stringify(choices));
  const snapshot = await f.api(route({ 'account-pool': extra.id }));
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.contextLabel, 'Draft account');
  assert.equal(snapshot.body.fiveHour.utilization, 2);
  const automatic = await f.api(route({ 'account-pool': 'auto' }));
  assert.equal(automatic.body.fiveHour.utilization, null, 'the next automatically routed account is not known before launch');
  assert.equal(automatic.body.contextLabel, '自动选择');
  assert.deepEqual((await f.backend('account-pool', 'list')).body.bindings, {});
  assert.equal(f.fake.calls.length, 0);
  assert.equal((await f.api('/api/usage?choices=broken')).status, 400);
  assert.equal((await f.api(route({ 'account-pool': [] }))).status, 400);
  assert.equal((await f.api(route({ 'account-pool': randomUUID() }))).status, 404);
  await f.backend('account-pool', 'update', { id: extra.id, enabled: false });
  assert.equal((await f.api(route({ 'account-pool': extra.id }))).status, 409);
});

test('session quota stays with its execution profile across primary refreshes and concurrent runs', async t => {
  const observations = [];
  const primary = { fiveHour: { utilization: 100 }, sevenDay: { utilization: 100 }, scopes: [], rateLimited: true };
  const f = await fixture(t, { usageMonitor: {
    read: () => structuredClone(primary), refresh: async () => structuredClone(primary),
    observe: event => observations.push(event), close: async () => {},
  } });
  await f.login(); await f.enable('account-pool');
  const extra = await f.account('Second account'), secondary = await f.create(), first = await f.create();
  await f.backend('account-pool', 'bind', { sessionId: secondary.id, accountId: extra.id });
  await f.backend('account-pool', 'bind', { sessionId: first.id, accountId: 'primary' });
  const route = `/api/usage?sessionId=${secondary.id}`;
  assert.equal((await f.api(route)).body.fiveHour.utilization, 2, 'a selected extra profile must not show primary quota');
  assert.equal((await f.send(secondary)).status, 202);
  const call = f.fake.calls[0];
  call.emit({ type: 'rate_limit', rateLimited: false, windows: { fiveHour: { utilization: 21 }, sevenDay: { utilization: 34 } } });
  await f.wb.runs.get(secondary.id).pluginEvents;
  assert.equal(observations.length, 0, 'extra-profile events must never enter the primary monitor');
  assert.equal((await f.api(route)).body.fiveHour.utilization, 21);
  assert.equal((await f.api('/api/bootstrap')).body.usage.fiveHour.utilization, 100);
  assert.equal((await f.api('/api/usage?refresh=1')).body.fiveHour.utilization, 100);
  assert.equal((await f.api(route)).body.fiveHour.utilization, 21, 'primary refresh cannot overwrite secondary quota');
  // A cached primary rejection must not be copied into the plugin's routing monitor.
  assert.equal((await f.send(first)).status, 202);
  f.fake.calls[1].emit({ type: 'rate_limit', rateLimited: true, limitType: 'five_hour', cooldownUntil: '2099-01-01T00:00:00Z', windows: { fiveHour: { utilization: 100 } } });
  await f.wb.runs.get(first.id).pluginEvents;
  assert.equal(observations.length, 1);
  assert.equal((await f.api(`/api/usage?sessionId=${first.id}`)).body.rateLimited, true);
  assert.equal((await f.api(route)).body.rateLimited, false);
  assert.equal(call.stops, 0); assert.equal(call.options.configDir, extra.profile);
  await call.finish(); await f.fake.calls[1].finish();
  assert.equal((await f.api(route + '&refresh=1')).body.fiveHour.utilization, 2);
  await f.enable('account-pool', false);
  assert.equal((await f.api(route)).status, 409, 'disabled ownership must not silently show another profile');
  assert.equal((await f.api('/api/usage?sessionId=invalid')).status, 400);
  assert.equal((await f.api(`/api/usage?sessionId=${randomUUID()}`)).status, 404);
});

test('an authenticated extra profile makes execution ready without a primary login, and disabling the plugin restores base readiness', async t => {
  const f = await fixture(t, {primaryLoggedIn: false,
    monitor: {sample: async activeRuns => ({activeRuns}), auth: async () => ({loggedIn: false})}});
  await f.login();
  const base = await f.api('/api/bootstrap');
  assert.equal(base.body.account.loggedIn, false);
  assert.equal(base.body.execution.ready, false);
  await f.enable('account-pool');
  const extra = await f.account('Only signed-in account');
  const ready = await f.api('/api/bootstrap');
  assert.equal(ready.body.account.loggedIn, false, 'base account status remains accurate');
  assert.equal(ready.body.execution.ready, true, 'generic execution readiness includes the optional account provider');
  const s = await f.create();
  await f.backend('account-pool', 'bind', {sessionId: s.id, accountId: extra.id});
  assert.equal((await f.send(s)).status, 202);
  assert.equal(f.fake.calls[0].options.configDir, extra.profile);
  await f.fake.calls[0].finish();
  await f.enable('account-pool', false);
  assert.equal((await f.api('/api/bootstrap')).body.execution.ready, false);
  const fresh = await f.create();
  assert.equal((await f.send(fresh)).status, 409);
  assert.equal(f.fake.calls.length, 1);
});

test('backend activation and calls require authentication, CSRF, origin and complete permission consent', async t => {
  const f = await fixture(t);
  const route = '/api/plugins/task-resume/enable', body = { enabled: true, granted: ['backend', 'sessions.read'] };
  assert.equal((await f.api(route, { method: 'POST', body, auth: false })).status, 401);
  await f.login(); assert.equal((await f.api(route, { method: 'POST', body, token: '' })).status, 403);
  assert.equal((await f.api(route, { method: 'POST', body, origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await f.api(route, { method: 'POST', body: { enabled: true, granted: ['sessions.read'] } })).status, 400);
  assert.equal((await f.enable('task-resume')).backendReady, true);
  assert.equal((await f.backend('task-resume', 'list', {}, { auth: false })).status, 401);
  assert.equal((await f.backend('task-resume', 'list', {}, { token: '' })).status, 403);
  assert.equal((await f.backend('task-resume', 'list')).status, 200);
});

test('web bundles and development directories cannot execute server backends', async t => {
  const f = await fixture(t); await f.login(); const marker = path.join(f.dir, 'imported-marker');
  const source = `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)},'executed'); export const activate=()=>({call:()=>({ok:true})});`;
  const manifest = serverManifest('untrusted-backend');
  const bundle = { format: BUNDLE_FORMAT, formatVersion: 1, manifest, files: [{ path: 'main.js', encoding: 'utf8', data: '' }, { path: 'backend.mjs', encoding: 'utf8', data: source }] };
  const imported = await f.api('/api/plugins/install', { method: 'POST', body: { bundle } }); assert.equal(imported.status, 403);
  const dev = path.join(f.dataDir, 'plugins', manifest.id); await fs.mkdir(dev);
  await fs.writeFile(path.join(dev, 'manifest.json'), JSON.stringify(manifest)); await fs.writeFile(path.join(dev, 'main.js'), ''); await fs.writeFile(path.join(dev, 'backend.mjs'), source);
  const scanned = await f.api('/api/plugins/rescan', { method: 'POST', body: {} }); assert.equal(scanned.status, 200);
  assert.equal(scanned.body.plugins.some(value => value.id === manifest.id), false);
  assert.ok(scanned.body.errors.some(value => value.dir === manifest.id));
  assert.equal((await f.backend(manifest.id, 'list')).status, 403); assert.equal(await exists(marker), false);
});

test('a builtin directory or backend entry symlink cannot import code outside its plugin', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'backend-link-fixture-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const builtin = path.join(base, 'builtin'), outside = path.join(base, 'outside'), marker = path.join(base, 'imported');
  await fs.mkdir(builtin); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'manifest.json'), JSON.stringify(serverManifest('linked-plugin')));
  await fs.writeFile(path.join(outside, 'main.js'), '');
  await fs.writeFile(path.join(outside, 'backend.mjs'), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'bad');export const activate=()=>({call:()=>({})});`);
  await fs.symlink(outside, path.join(builtin, 'linked-plugin'));
  const entry = path.join(builtin, 'linked-entry'); await fs.mkdir(entry);
  await fs.writeFile(path.join(entry, 'manifest.json'), JSON.stringify(serverManifest('linked-entry'))); await fs.writeFile(path.join(entry, 'main.js'), '');
  await fs.symlink(path.join(outside, 'backend.mjs'), path.join(entry, 'backend.mjs'));
  const f = await fixture(t, { builtinPluginsDir: builtin }); await f.login();
  for (const id of ['linked-plugin', 'linked-entry']) {
    const listed = (await f.api('/api/plugins')).body.plugins.find(plugin => plugin.id === id);
    if (listed) {
      const plugin = await f.enable(id); assert.equal(plugin.backendReady, false); assert.ok(plugin.backendError);
      assert.equal((await f.backend(id, 'list')).status, 503);
    }
  }
  assert.equal(await exists(marker), false);
});

test('both plugins retain an isolated account and official session through checkpoint recovery and account transfer', async t => {
  const f = await fixture(t); await f.login(); await f.enable('account-pool'); await f.enable('task-resume');
  const a = await f.account('First account'), b = await f.account('Second account'), s = await f.create();
  assert.equal((await f.backend('account-pool', 'bind', { sessionId: s.id, accountId: a.id })).status, 200);
  assert.equal((await f.send(s, 'ORIGINAL TASK THAT MUST NOT BE REPLAYED')).status, 202);
  const first = f.fake.calls[0]; assert.equal(first.options.configDir, a.profile); const original = await f.transcript(first);
  await fs.writeFile(path.join(a.profile, '.credentials.json'), 'SYNTHETIC CREDENTIAL MUST STAY LOCAL');
  first.emit({ type: 'tool', name: 'Write', status: 'completed', output: 'synthetic output' });
  first.emit({ type: 'error', message: 'synthetic connection loss' }); await first.finish({ code: 1 });
  const checkpoint = (await f.backend('task-resume', 'list')).body.tasks.find(value => value.sessionId === s.id);
  assert.equal(checkpoint.claudeSessionId, original.id); assert.equal(checkpoint.state, 'failed'); assert.equal(checkpoint.lastTool.name, 'Write');
  assert.equal((await f.backend('account-pool', 'bind', { sessionId: s.id, accountId: b.id })).status, 200);
  const restored = await f.backend('task-resume', 'resume', { sessionId: s.id }); assert.equal(restored.status, 200, JSON.stringify(restored.body));
  const next = f.fake.calls[1]; assert.equal(next.options.configDir, b.profile); assert.equal(next.options.sessionId, original.id); assert.equal(next.options.cwd, first.options.cwd);
  assert.notEqual(next.options.prompt, first.options.prompt); assert.match(next.options.prompt, /不要直接重放历史工具调用/);
  const copied = path.join(b.profile, 'projects', next.options.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${original.id}.jsonl`);
  assert.equal(await fs.readFile(copied, 'utf8'), await fs.readFile(path.join(original.project, `${original.id}.jsonl`), 'utf8'));
  assert.equal(await exists(path.join(b.profile, '.credentials.json')), false);
  await next.finish(); assert.equal((await f.backend('task-resume', 'list')).body.tasks[0].state, 'completed');
});

test('parallel runs use their own account profiles; exclusive plugin operations still wait for every task and hold back new ones', async t => {
  const f = await fixture(t); await f.login(); await f.enable('account-pool');
  const one = await f.account('Parallel one'), two = await f.account('Parallel two'), a = await f.create(), b = await f.create();
  await f.backend('account-pool', 'bind', { sessionId: a.id, accountId: one.id }); await f.backend('account-pool', 'bind', { sessionId: b.id, accountId: two.id });
  assert.equal((await f.send(a)).status, 202); assert.equal((await f.send(b)).status, 202);
  assert.deepEqual(f.fake.calls.map(call => call.options.configDir), [one.profile, two.profile]);
  // Account changes still need every task to finish first.
  assert.equal((await f.backend('account-pool', 'create', { label: 'During runs' })).status, 409);
  for (const call of f.fake.calls) await call.finish();
  let release; const gate = new Promise(resolve => { release = resolve; });
  const holding = f.wb.serverPlugins.context.withExclusive(() => gate);
  const refused = await f.send(a); assert.equal(refused.status, 409); assert.match(refused.body.error, /插件或配置操作/);
  assert.equal((await f.api(`/api/sessions/${b.id}/file`, { method: 'PUT', body: { path: 'note.txt', text: 'x', hash: null } })).status, 409);
  release(); await holding;
  assert.equal((await f.send(a)).status, 202); assert.equal(f.fake.calls.length, 3); await f.fake.calls[2].finish();
});

test('composer choices reach only their own plugin, and an idle conversation can be rebound while another runs', async t => {
  const f = await fixture(t); await f.login(); await f.enable('account-pool');
  const one = await f.account('Picker one'), two = await f.account('Picker two'), a = await f.create(), b = await f.create();
  const message = (session, body) => f.api(`/api/sessions/${session.id}/messages`, { method: 'POST', body: { text: '选择器任务', requestId: randomUUID(), ...body } });
  assert.equal((await f.send(a)).status, 202);
  assert.equal((await f.backend('account-pool', 'bind', { sessionId: b.id, accountId: two.id })).status, 200, 'other conversations stay rebindable');
  const refused = await f.backend('account-pool', 'bind', { sessionId: a.id, accountId: one.id });
  assert.equal(refused.status, 409); assert.match(refused.body.error, /正在运行/);
  for (const choices of [['account-pool'], { 'account-pool': '../escape' }, { 'Bad Id': 'x' }, 'auto']) {
    assert.equal((await message(b, { choices })).status, 400, JSON.stringify(choices));
  }
  // The first-message choice overrides the stored binding; choices for other plugins are not passed along.
  assert.equal((await message(b, { choices: { 'account-pool': one.id, 'not-installed': 'x' } })).status, 202);
  assert.equal(f.fake.calls[1].options.configDir, one.profile);
  const bindings = (await f.backend('account-pool', 'list')).body.bindings;
  assert.equal(bindings[b.id].accountId, one.id); assert.equal(bindings[b.id].pinned, true);
  const c = await f.create();
  const missing = await message(c, { choices: { 'account-pool': 'not-an-account' } });
  assert.equal(missing.status, 409); assert.match(missing.body.error, /所选账号/);
  assert.equal((await message(c, { choices: { 'account-pool': 'auto' } })).status, 202);
  assert.equal(f.fake.calls[2].options.configDir, undefined, 'automatic selection keeps the default account');
  for (const call of f.fake.calls) await call.finish();
});

test('two simultaneous resume requests reserve only one execution slot', async t => {
  const f = await fixture(t); await f.login(); await f.enable('task-resume'); const s = await f.create();
  await f.send(s); f.fake.calls[0].emit({ type: 'session', sessionId: randomUUID() });
  f.fake.calls[0].emit({ type: 'error', message: 'failure' }); await f.fake.calls[0].finish({ code: 1 });
  const responses = await Promise.all([1, 2].map(() => f.backend('task-resume', 'resume', { sessionId: s.id })));
  assert.deepEqual(responses.map(value => value.status).sort(), [200, 409]); assert.equal(f.fake.calls.length, 2);
  await f.fake.calls[1].finish();
});

test('user stop cannot become an automatic resume and disabling checkpoints leaves normal conversations usable', async t => {
  const f = await fixture(t); await f.login(); await f.enable('task-resume');
  await f.backend('task-resume', 'settings.update', { autoResume: true, retryDelayMs: 1000 });
  const s = await f.create(); await f.send(s); f.fake.calls[0].emit({ type: 'session', sessionId: randomUUID() });
  assert.equal((await f.api(`/api/sessions/${s.id}/stop`, { method: 'POST', body: {} })).status, 200);
  await f.fake.calls[0].handle.done;
  const task = (await f.backend('task-resume', 'list')).body.tasks[0]; assert.equal(task.state, 'stopped'); assert.equal(task.automatic, false);
  assert.equal((await f.backend('task-resume', 'resume', { sessionId: s.id })).status, 409);
  await f.enable('task-resume', false); assert.equal((await f.backend('task-resume', 'list')).status, 403);
  assert.equal((await f.send(s, '用户明确发起的新任务')).status, 202); assert.equal(f.fake.calls.length, 2); await f.fake.calls[1].finish();
});

test('disabled account ownership and safe mode block old extra-profile sessions but allow new base sessions', async t => {
  const f = await fixture(t); await f.login(); await f.enable('account-pool'); const a = await f.account('Owned account'), s = await f.create();
  await f.backend('account-pool', 'bind', { sessionId: s.id, accountId: a.id }); await f.send(s); await f.transcript(f.fake.calls[0]); await f.fake.calls[0].finish();
  await f.enable('account-pool', false); assert.equal((await f.send(s)).status, 409); assert.equal((await f.backend('account-pool', 'list')).status, 403);
  await f.enable('account-pool'); await f.stop(); f.config.safeMode = true; await f.start();
  assert.equal((await f.backend('account-pool', 'list')).status, 403); assert.equal((await f.send(s)).status, 409);
  const fresh = await f.create(); assert.equal((await f.send(fresh)).status, 202); assert.equal(f.fake.calls.at(-1).options.configDir, undefined); await f.fake.calls.at(-1).finish();
});

test('a service restart retains a recoverable checkpoint without automatically starting the task', async t => {
  const f = await fixture(t); await f.login(); await f.enable('task-resume'); const s = await f.create();
  await f.send(s); const sessionId = randomUUID(); f.fake.calls[0].emit({ type: 'session', sessionId });
  await f.stop(); assert.equal(f.fake.calls[0].stops, 1); await f.start();
  const task = (await f.backend('task-resume', 'list')).body.tasks[0]; assert.equal(task.state, 'interrupted'); assert.equal(task.resumable, true); assert.equal(f.fake.calls.length, 1);
  assert.equal((await f.backend('task-resume', 'resume', { sessionId: s.id })).status, 200); assert.equal(f.fake.calls[1].options.sessionId, sessionId); await f.fake.calls[1].finish();
});

test('checkpoint I/O failure cannot prevent stopping the CLI during service shutdown', async t => {
  const f = await fixture(t); await f.login(); await f.enable('task-resume'); const s = await f.create();
  await f.send(s); f.fake.calls[0].emit({ type: 'session', sessionId: randomUUID() });
  // Finish event persistence before the deliberate disk failure; this is not a real profile.
  await f.wb.runs.get(s.id).pluginEvents;
  const location = path.join(f.dataDir, 'server-plugin-data', 'task-resume'), moved = `${location}.test-backup`;
  await fs.rename(location, moved); await fs.writeFile(location, 'simulated filesystem failure');
  try {
    await f.stop(); assert.equal(f.fake.calls[0].stops, 1); assert.equal(f.wb.runs.size, 0);
  } finally { await fs.unlink(location); await fs.rename(moved, location); }
});

test('shutdown waits for pending backend preflight and its completion cleanup before returning', async t => {
  const f = await fixture(t); await f.login(); await f.enable('task-resume'); const s = await f.create();
  const plugin = f.wb.serverPlugins.active.get('task-resume');
  const before = plugin.beforeRun.bind(plugin), exit = plugin.onExit.bind(plugin);
  let releasePreflight, signalPreflight, releaseCleanup, signalCleanup;
  const preflightGate = new Promise(resolve => { releasePreflight = resolve; });
  const preflightEntered = new Promise(resolve => { signalPreflight = resolve; });
  const cleanupGate = new Promise(resolve => { releaseCleanup = resolve; });
  const cleanupEntered = new Promise(resolve => { signalCleanup = resolve; });
  plugin.beforeRun = async payload => { signalPreflight(); await preflightGate; return before(payload); };
  plugin.onExit = async payload => { signalCleanup(); await cleanupGate; return exit(payload); };
  const submitting = f.send(s, 'Must never start during shutdown');
  await preflightEntered;
  let closed = false;
  const closing = f.wb.close().then(() => { closed = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false, 'close must include the run reservation before a child exists');
    releasePreflight();
    await cleanupEntered;
    assert.equal(closed, false, 'close must also await plugin completion persistence');
    releaseCleanup();
    const response = await submitting;
    await closing;
    assert.equal(response.status, 409);
    assert.equal(closed, true);
    assert.equal(f.fake.calls.length, 0);
    assert.equal(f.wb.runs.size, 0);
    assert.equal(f.wb.store.get(s.id).messages.length, 0);
    assert.equal(f.wb.store.get(s.id).status, 'idle');
  } finally { releasePreflight(); releaseCleanup(); await submitting; await closing; }
});
