import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createAccountPool } from '../plugins/account-pool/server.mjs';
import { limitName, quotaLoad, routeCandidates } from '../plugins/account-pool/routing.mjs';

const SESSION = 'cccccccc-cccc-4ccc-accc-cccccccccccc';
const NATIVE = 'dddddddd-dddd-4ddd-addd-dddddddddddd';
const fixedNow = Date.parse('2026-10-21T04:00:00Z');
const session = (id = randomUUID()) => ({ id, model: 'sonnet', claudeSessionId: null });

async function fixture(t, extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-accounts-'));
  const dataDir = path.join(root, 'data'), workspaceRoot = path.join(root, 'workspace'), legacyConfigDir = path.join(root, 'legacy');
  await Promise.all([fs.mkdir(workspaceRoot), fs.mkdir(legacyConfigDir)]);
  const auth = new Map(), usage = new Map(), probes = [], monitors = new Map();
  let active = true, lockDepth = 0, lockCalls = 0;
  const options = { dataDir, workspaceRoot, legacyConfigDir, binary: 'claude', now: () => fixedNow,
    isActive: () => active,
    withExclusive: async fn => {
      assert.equal(lockDepth, 0, 'host lock must not be acquired recursively');
      lockCalls++; lockDepth++;
      try { return await fn(); } finally { lockDepth--; }
    },
    authProvider: async options => { probes.push(options); return auth.get(options.accountId) || { loggedIn: true, email: 'owner@example.com', subscriptionType: 'max' }; },
    usageFactory: ({ accountId }) => {
      const monitor = { read: () => usage.get(accountId) || { fiveHour: { utilization: null }, sevenDay: { utilization: null }, scopes: [] },
        refresh: async () => monitor.read(), observe: event => usage.set(accountId, { ...monitor.read(), ...event }), close: async () => {} };
      monitors.set(accountId, monitor); return monitor;
    },
    getSession: id => id === SESSION ? session(SESSION) : null,
    ...extra,
  };
  const pool = await createAccountPool(options);
  t.after(async () => { await pool.close(); await fs.rm(root, { recursive: true, force: true }); });
  const create = async label => {
    const before = new Set(pool.snapshot().accounts.map(account => account.id));
    const result = await pool.call('create', { label });
    return result.accounts.find(account => !before.has(account.id)).id;
  };
  return { root, dataDir, workspaceRoot, legacyConfigDir, options, pool, auth, usage, probes, monitors, create,
    setActive: value => { active = value; }, lockCalls: () => lockCalls };
}

test('optional account pool starts with the existing official profile and only persists metadata', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.legacyConfigDir, '.credentials.json'), 'never-copy-this-token');
  const initial = await f.pool.call('list');
  assert.equal(initial.accounts.length, 1);
  assert.equal(initial.accounts[0].id, 'primary');
  assert.equal(initial.accounts[0].auth.loggedIn, null);
  assert.deepEqual(initial.settings, { strategy: 'sticky', switchAt: 100 });
  const other = await f.create('另一个账号');
  assert.deepEqual(await fs.readdir(path.join(f.dataDir, 'profiles', other, 'config')), []);
  assert.equal((await f.pool.beforeRun({ session: session() })).configDir, undefined);
  const text = await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8');
  assert.doesNotMatch(text, /owner@example|never-copy-this-token|loggedIn/);
  assert.equal((await fs.stat(path.join(f.dataDir, 'accounts.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(f.legacyConfigDir), ['.credentials.json']);
  assert.ok((await f.pool.call('list')).accounts.every(account => account.auth.emailMask === 'o***@example.com'));
});

test('auth probes isolate each profile and strip credential and config overrides without losing operator proxies', async t => {
  const f = await fixture(t, { env: { CLAUDE_CONFIG_DIR: '/attacker', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/secrets',
    ANTHROPIC_API_KEY: 'private', CLAUDE_CODE_OAUTH_TOKEN: 'private', ANTHROPIC_BASE_URL: 'https://bad.invalid',
    NODE_OPTIONS: '--require=/bad', HTTPS_PROXY: 'http://operator-proxy.invalid' } });
  const other = await f.create('账号 2');
  await f.pool.call('refresh');
  assert.equal(f.probes.length, 2);
  assert.equal(f.probes[0].configDir, undefined);
  assert.equal(f.probes[0].env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(f.probes[1].env.CLAUDE_CONFIG_DIR, path.join(f.dataDir, 'profiles', other, 'config'));
  for (const probe of f.probes) {
    assert.equal(probe.env.HTTPS_PROXY, 'http://operator-proxy.invalid');
    for (const key of ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'NODE_OPTIONS']) assert.equal(probe.env[key], undefined);
  }
  assert.equal(f.lockCalls(), 2);
});

test('official auth status logged-out JSON is respected even when the CLI exits nonzero', async t => {
  const calls = [];
  const f = await fixture(t, { authProvider: undefined, exec: async (binary, args, options) => {
    calls.push({ binary, args, options });
    throw Object.assign(new Error('not logged in'), { stdout: JSON.stringify({ loggedIn: false, email: 'do-not-return@example.com' }) });
  } });
  await f.pool.call('refresh');
  assert.deepEqual(calls[0].args, ['auth', 'status']);
  assert.equal(f.pool.snapshot().accounts[0].auth.loggedIn, false);
  await assert.rejects(f.pool.beforeRun({ session: session() }), /没有已登录/);
  assert.doesNotMatch(JSON.stringify(f.pool.snapshot()), /do-not-return/);
});

test('round-robin persists its cursor and skips disabled and unconfirmed accounts', async t => {
  const f = await fixture(t);
  const second = await f.create('账号 2'), third = await f.create('账号 3');
  await f.pool.call('settings', { strategy: 'round-robin' });
  const choices = [];
  for (let index = 0; index < 4; index++) choices.push((await f.pool.beforeRun({ session: session() })).accountId);
  assert.deepEqual(choices, ['primary', second, third, 'primary']);
  await f.pool.call('update', { id: second, enabled: false });
  assert.equal((await f.pool.beforeRun({ session: session() })).accountId, third);
  await f.pool.close();
  const restored = await createAccountPool(f.options);
  t.after(() => restored.close());
  assert.equal((await restored.beforeRun({ session: session() })).accountId, 'primary');
  f.auth.set(third, { loggedIn: null });
  await restored.call('refresh');
  assert.equal((await restored.beforeRun({ session: session() })).accountId, 'primary');
});

test('quota routing uses all blocking windows, skips cooldowns and keeps unknown usage distinct', async t => {
  const f = await fixture(t);
  const second = await f.create('余量较多'), third = await f.create('未读额度');
  f.usage.set('primary', { fiveHour: { utilization: 20 }, sevenDay: { utilization: 92 }, scopes: [] });
  f.usage.set(second, { fiveHour: { utilization: 40 }, sevenDay: { utilization: 55 }, scopes: [] });
  await f.pool.call('settings', { strategy: 'quota', switchAt: 90 });
  assert.equal((await f.pool.beforeRun({ session: session() })).accountId, second);
  f.usage.set(second, { rateLimited: true, cooldownUntil: new Date(fixedNow + 60000).toISOString(), scopes: [] });
  assert.equal((await f.pool.beforeRun({ session: session() })).accountId, third);
  f.usage.set(third, { rateLimited: true, cooldownUntil: null, scopes: [] });
  await assert.rejects(f.pool.beforeRun({ session: session() }), /没有已登录/);
  const account = { enabled: true, auth: { loggedIn: true }, usage: { fiveHour: { utilization: 100, resetsAt: new Date(fixedNow - 1).toISOString() },
    sevenDay: { utilization: 25 }, scopes: [{ model: 'Claude Opus', utilization: 99 }] } };
  assert.equal(quotaLoad(account, { model: 'claude-sonnet-4-6', now: fixedNow }).load, 25);
  assert.equal(quotaLoad(account, { model: 'claude-opus-4-6', now: fixedNow }).load, 99);
  assert.equal(routeCandidates([account], { model: 'opus', below: 95, now: fixedNow }).length, 0);
  const fable = { enabled: true, auth: { loggedIn: true }, usage: { sevenDay: { utilization: 20 }, scopes: [{ model: 'Fable', utilization: 97 }, { model: 'Opus', utilization: 30 }] } };
  assert.equal(quotaLoad(fable, { model: 'fable', now: fixedNow }).load, 97, 'the Fable weekly meter gates Fable turns');
  assert.equal(quotaLoad(fable, { model: 'claude-opus-4-6', now: fixedNow }).load, 30, 'pinned versions use their family meter');
  assert.equal(limitName('seven_day_opus'), 'Opus 本周额度');
  assert.equal(limitName('seven_day_fable'), 'Fable 本周额度');
  assert.equal(limitName(null), '额度');
});

test('bindings are validated, pinned accounts never silently fail over, and unbinding restores policy', async t => {
  const f = await fixture(t);
  const other = await f.create('绑定账号');
  await assert.rejects(f.pool.call('bind', { sessionId: randomUUID(), accountId: other }), /会话不存在/);
  await f.pool.call('bind', { sessionId: SESSION, accountId: other });
  assert.equal((await f.pool.beforeRun({ session: session(SESSION) })).accountId, other);
  assert.equal(f.pool.ownsSession(session(SESSION)), true);
  f.usage.set(other, { fiveHour: { utilization: 100 }, scopes: [] });
  await assert.rejects(f.pool.beforeRun({ session: session(SESSION) }), /绑定的账号/);
  await f.pool.call('bind', { sessionId: SESSION, accountId: null });
  assert.equal((await f.pool.beforeRun({ session: session(SESSION) })).accountId, 'primary');
  assert.equal(f.pool.ownsSession(session(SESSION)), false);
});

test('binding waits only for this conversation, and a first-message choice pins or releases the account', async t => {
  let status = 'idle';
  const f = await fixture(t, { getSession: id => id === SESSION ? { ...session(SESSION), status } : null });
  const other = await f.create('选择器账号');
  const locks = f.lockCalls();
  await f.pool.call('bind', { sessionId: SESSION, accountId: other });
  assert.equal(f.lockCalls(), locks, 'binding one conversation does not wait for every task');
  for (status of ['running', 'awaiting_approval', 'stopping']) {
    await assert.rejects(f.pool.call('bind', { sessionId: SESSION, accountId: null }), /正在运行/);
  }
  assert.equal(f.pool.sessionState(SESSION).pinned, true);
  status = 'idle';
  // 'auto' releases a pinned conversation back to the global strategy for this turn and the next;
  // the default 'sticky' strategy keeps the account it last used while that account has quota.
  assert.equal((await f.pool.beforeRun({ session: session(SESSION), request: { choice: 'auto' } })).accountId, other);
  assert.deepEqual(f.pool.sessionState(SESSION), { accountId: other, transcriptAccountId: other, pinned: false });
  f.usage.set(other, { fiveHour: { utilization: 100 }, scopes: [] });
  assert.equal((await f.pool.beforeRun({ session: session(SESSION) })).accountId, 'primary', 'an unpinned conversation may move on');
  f.usage.delete(other);
  const fresh = session();
  assert.equal((await f.pool.beforeRun({ session: fresh, request: { choice: other } })).accountId, other);
  assert.equal(f.pool.sessionState(fresh.id).pinned, true);
  assert.equal(f.pool.sessionState(fresh.id).accountId, other);
  await assert.rejects(f.pool.beforeRun({ session: session(), request: { choice: 'not-an-account' } }), /所选账号/);
  await f.pool.call('update', { id: other, enabled: false });
  await assert.rejects(f.pool.beforeRun({ session: session(), request: { choice: other } }), /所选账号/);
  // No choice leaves the stored binding and strategy in charge.
  assert.equal((await f.pool.beforeRun({ session: session(), request: { choice: null } })).accountId, 'primary');
});

test('turn-boundary account changes copy only the current official transcript from its last owner', async t => {
  const f = await fixture(t);
  const other = await f.create('第二账号');
  const current = { ...session(SESSION), claudeSessionId: NATIVE };
  const project = path.join('projects', f.workspaceRoot.replace(/[^a-zA-Z0-9]/g, '-'));
  await fs.mkdir(path.join(f.legacyConfigDir, project), { recursive: true });
  const relative = path.join(project, `${NATIVE}.jsonl`);
  await fs.writeFile(path.join(f.legacyConfigDir, relative), '{"source":"primary"}\n');
  await fs.writeFile(path.join(f.legacyConfigDir, '.credentials.json'), 'credential-never-copied');
  await f.pool.call('bind', { sessionId: SESSION, accountId: other });
  const selected = await f.pool.beforeRun({ session: current });
  assert.equal(selected.configDir, path.join(f.dataDir, 'profiles', other, 'config'));
  assert.equal(await fs.readFile(path.join(selected.configDir, relative), 'utf8'), '{"source":"primary"}\n');
  await assert.rejects(fs.stat(path.join(selected.configDir, '.credentials.json')), { code: 'ENOENT' });
  await fs.appendFile(path.join(selected.configDir, relative), '{"source":"second"}\n');
  await f.pool.call('bind', { sessionId: SESSION, accountId: 'primary' });
  assert.equal((await f.pool.beforeRun({ session: current })).accountId, 'primary');
  assert.match(await fs.readFile(path.join(f.legacyConfigDir, relative), 'utf8'), /second/);
  assert.equal(f.pool.sessionState(SESSION).transcriptAccountId, 'primary');
});

test('quota follows the executing owner until a pending account preference can take effect', async t => {
  const f = await fixture(t), other = await f.create('Next account');
  await f.pool.beforeRun({ session: session(SESSION) });
  f.usage.set('primary', { fiveHour: { utilization: 100 }, scopes: [] });
  f.usage.set(other, { fiveHour: { utilization: 20 }, scopes: [] });
  await f.pool.call('bind', { sessionId: SESSION, accountId: other });
  assert.equal((await f.pool.readUsage({ session: session(SESSION), inProgress: true })).fiveHour.utilization, 100);
  assert.equal((await f.pool.readUsage({ session: session(SESSION), choice: other, inProgress: true })).fiveHour.utilization, 100, 'a first-message preference cannot replace the account already executing');
  assert.equal((await f.pool.readUsage({ session: session(SESSION) })).fiveHour.utilization, 20);
  await f.pool.call('bind', { sessionId: SESSION, accountId: null });
  assert.equal((await f.pool.readUsage({ session: session(SESSION) })).fiveHour.utilization, 100, 'automatic routing displays the last owner until the next turn chooses');
});

test('missing source transcript refuses account changes without publishing a new owner', async t => {
  const f = await fixture(t);
  const other = await f.create('第二账号');
  await f.pool.call('bind', { sessionId: SESSION, accountId: other });
  await assert.rejects(f.pool.beforeRun({ session: { ...session(SESSION), claudeSessionId: NATIVE } }), /接续|记录/);
  assert.equal(f.pool.sessionState(SESSION).transcriptAccountId, 'primary');
});

test('disabled plugins stop new probes, writes and runs while retaining ownership for the host', async t => {
  const f = await fixture(t);
  const other = await f.create('独立账号');
  await f.pool.call('bind', { sessionId: SESSION, accountId: other });
  await f.pool.beforeRun({ session: session(SESSION) });
  const count = f.probes.length, before = await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8');
  f.setActive(false);
  await assert.rejects(f.pool.call('refresh'), /已停用/);
  await assert.rejects(f.pool.call('create', { label: '不会创建' }), /已停用/);
  await assert.rejects(f.pool.beforeRun({ session: session(SESSION) }), /已停用/);
  assert.equal(f.probes.length, count);
  assert.equal(f.pool.ownsSession(session(SESSION)), true);
  assert.equal(await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8'), before);
});

test('bad ids, caller paths, invalid settings and unsafe binary paths are rejected', async t => {
  const f = await fixture(t);
  for (const [method, params] of [['update', { id: '../escape', enabled: true }], ['create', { label: 'x', configDir: '/outside' }],
    ['settings', { strategy: 'random' }], ['settings', { switchAt: 0 }], ['update', { id: 'primary', enabled: false }]]) {
    await assert.rejects(f.pool.call(method, params));
  }
  await assert.rejects(f.pool.beforeRun({ session: session(), cwd: path.dirname(f.workspaceRoot) }), /工作区超出/);
  await assert.rejects(createAccountPool({ ...f.options, binary: './untrusted' }), /binary/);
  await assert.rejects(createAccountPool({ ...f.options, dataDir: '../escape' }), /absolute/);
  assert.equal(f.pool.snapshot().accounts[0].enabled, true);
  assert.equal(f.pool.snapshot().accounts.length, 1);
});

test('linked profile ancestors and corrupt metadata fail closed without modifying their targets', async t => {
  const f = await fixture(t);
  const other = await f.create('第二账号');
  const parent = path.join(f.dataDir, 'profiles', other), outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.rm(parent, { recursive: true });
  await fs.symlink(outside, parent);
  await assert.rejects(f.pool.call('refresh', { id: other }), /真实目录/);
  assert.deepEqual(await fs.readdir(outside), []);
  await f.pool.close();
  await fs.writeFile(path.join(f.dataDir, 'accounts.json'), '{bad');
  await assert.rejects(createAccountPool(f.options), /未重建或覆盖/);
  assert.equal(await fs.readFile(path.join(f.dataDir, 'accounts.json'), 'utf8'), '{bad');
});

test('metadata hardlinks and symlinks are rejected before a write', async t => {
  for (const kind of ['hard', 'symbolic']) {
    const f = await fixture(t);
    const filename = path.join(f.dataDir, 'accounts.json'), outside = path.join(f.root, 'outside.json');
    const original = await fs.readFile(filename, 'utf8');
    await fs.rename(filename, outside);
    if (kind === 'hard') await fs.link(outside, filename); else await fs.symlink(outside, filename);
    await assert.rejects(f.pool.call('settings', { strategy: 'round-robin' }), /独立文件/);
    assert.equal(await fs.readFile(outside, 'utf8'), original);
    assert.equal(f.pool.snapshot().settings.strategy, 'sticky');
  }
});

test('login command quotes operator paths and emits only the official auth command', async t => {
  const f = await fixture(t, { binary: "/opt/cli's folder/claude" });
  const other = await f.create('账号');
  const result = await f.pool.call('loginCommand', { id: other });
  assert.match(result.command, /CLAUDE_CONFIG_DIR='/);
  assert.match(result.command, /'\/opt\/cli'\\''s folder\/claude' auth login --claudeai$/);
  assert.match(result.command, /-u ANTHROPIC_API_KEY/);
  assert.doesNotMatch(result.command, /sudo|claudeops|DISPLAY|chrom/);
  assert.match(result.note, /同一系统用户/);
});

test('execution readiness uses auth TTL while idle and only cached state when the shared lock is busy', async t => {
  let busy = true, now = fixedNow;
  const f = await fixture(t, { isBusy: () => busy, now: () => now });
  assert.equal((await f.pool.executionStatus()).ready, null);
  assert.equal(f.probes.length, 0);
  assert.equal(f.lockCalls(), 0);
  busy = false;
  const ready = await f.pool.executionStatus();
  assert.equal(ready.ready, true);
  assert.equal(ready.label, '账号插件');
  assert.doesNotMatch(JSON.stringify(ready), /owner|example\.com|email|token/i);
  assert.equal(f.probes.length, 1);
  await f.pool.executionStatus();
  assert.equal(f.probes.length, 1);
  f.auth.set('primary', { loggedIn: false });
  now += 60_001;
  busy = true;
  assert.equal((await f.pool.executionStatus()).ready, true);
  assert.equal(f.probes.length, 1);
  busy = false;
  assert.equal((await f.pool.executionStatus()).ready, false);
  assert.equal(f.probes.length, 2);
});
