import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageMonitor, normalizeUsageReport, normalizeRateLimit } from '../lib/usage.mjs';

const rows = [
  { kind: 'weekly_scoped', group: 'weekly', percent: 77, resets_at: '2030-01-08T00:00:00Z',
    scope: { model: { display_name: 'Sonnet' } }, severity: 'warning', is_active: true },
  { kind: 'session', group: 'session', percent: 12.5, resets_at: '2030-01-01T05:00:00Z', scope: null, severity: 'normal', is_active: false },
  { kind: 'weekly_all', group: 'weekly', percent: 0, resets_at: '2030-01-08T00:00:00Z', scope: null, severity: 'normal', is_active: false },
];
const report = { rate_limits: { limits: rows }, session: { total_cost_usd: 999 } };

test('classifies exact meter kinds and keeps scoped weekly usage separate from all-model usage', () => {
  const value = normalizeUsageReport(report, '2030-01-01T00:00:00Z');
  assert.equal(value.fiveHour.utilization, 12.5);
  assert.equal(value.sevenDay.utilization, 0);
  assert.equal(value.scopes[0].model, 'Sonnet');
  assert.equal(value.scopes[0].utilization, 77);
  assert.equal(value.scopes[0].kind, 'weekly_scoped');
  assert.equal(value.rateLimited, null, 'is_active and severity do not establish rejection');
  assert.equal(value.source, 'official-cli-usage');
  assert.equal('costUsd' in value, false, 'session token cost is not subscription utilization');
});

test('missing or invalid quota is unknown, never inferred from token counts or another scoped meter', () => {
  const absent = normalizeUsageReport({ rate_limits: null });
  assert.equal(absent.fiveHour.utilization, null);
  assert.equal(absent.sevenDay.utilization, null);
  assert.equal(absent.stale, true);
  const invalid = normalizeUsageReport({ rate_limits: { limits: [
    { kind: 'session', percent: 101, resets_at: 'not a date' },
    { kind: 'weekly_scoped', percent: 42, scope: { model: { display_name: 'all models' } } },
  ] } });
  assert.equal(invalid.fiveHour.utilization, null);
  assert.equal(invalid.fiveHour.resetsAt, null);
  assert.equal(invalid.sevenDay.utilization, null);
  assert.equal(invalid.scopes[0].utilization, 42);
});

test('normalizes official rate-limit decisions without assigning unscoped utilization to 5h or weekly meters', () => {
  const event = normalizeRateLimit({ status: 'rejected', resetsAt: 1893459600, utilization: 0.99 });
  assert.equal(event.rateLimited, true);
  assert.equal(event.cooldownUntil, '2030-01-01T01:00:00.000Z');
  assert.equal('fiveHour' in event, false);
  assert.equal('utilization' in event, false);
  assert.equal(normalizeRateLimit({ status: 'allowed_warning' }).rateLimited, false);
  assert.equal(normalizeRateLimit({ status: 'made_up' }), null);
});

test('served requests keep the 5h and weekly meters live and name the binding limit', () => {
  const info = { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.93, resetsAt: 1893974400,
    unifiedWindows: { five_hour: { utilization: 0.415, resetsAt: 1893470400 }, seven_day: { utilization: 0.93, resetsAt: 1893974400 } } };
  const event = normalizeRateLimit(info, '2030-01-01T00:00:00Z');
  assert.equal(event.limitType, 'seven_day');
  assert.deepEqual(event.windows, { fiveHour: { utilization: 41.5, resetsAt: '2030-01-01T04:00:00.000Z' }, sevenDay: { utilization: 93, resetsAt: '2030-01-07T00:00:00.000Z' } });
  const single = normalizeRateLimit({ status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: 1893470400 });
  assert.deepEqual(single.windows, { fiveHour: { utilization: 100, resetsAt: '2030-01-01T04:00:00.000Z' } });
  assert.equal(normalizeRateLimit({ status: 'rejected', rateLimitType: 'invented', utilization: 1 }).limitType, null);
  assert.equal(normalizeRateLimit({ status: 'rejected', rateLimitType: 'seven_day_fable', utilization: 1 }).limitType, 'seven_day_fable', 'model weekly meters keep their family');
});

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'claude-usage-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const binary = join(cwd, 'usage-cli.mjs');
  const source = `#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
const record=process.env.FIXTURE_RECORD;
const count=existsSync(record)?JSON.parse(readFileSync(record,'utf8')).count:0;
writeFileSync(record,JSON.stringify({count:count+1,pid:process.pid,args:process.argv.slice(2),key:process.env.ANTHROPIC_API_KEY,proxy:process.env.HTTPS_PROXY}));
const mode=process.env.FIXTURE_MODE;
if(mode==='fail'){process.stderr.write('private diagnostic sk-ant-must-not-escape');process.exit(1)}
if(mode==='hang'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}
else {
const output=m=>process.stdout.write(JSON.stringify(m)+'\\n');
output({type:'assistant',usage_report:mode==='null'?{rate_limits:null}:${JSON.stringify(report)}});
output({type:'result',subtype:'success',is_error:false,num_turns:mode==='model-call'?1:0,duration_api_ms:0,local_command:'usage'});
}
`;
  await writeFile(binary, source);
  await chmod(binary, 0o700);
  let clock = Date.parse('2030-01-01T00:00:00Z');
  const updates = [];
  const monitor = new UsageMonitor({ cwd, binary, timeoutMs: 5000, now: () => clock,
    onUpdate: value => updates.push(value), env: { FIXTURE_RECORD: join(cwd, 'record.json'),
      ANTHROPIC_API_KEY: 'must-not-pass', HTTPS_PROXY: 'http://proxy.example:8080' } });
  t.after(() => monitor.close());
  return { cwd, monitor, updates, advance: ms => { clock += ms; } };
}

test('runs only official /usage, caches for 90 seconds and shares concurrent refreshes', async t => {
  const { cwd, monitor, updates, advance } = await fixture(t);
  assert.equal(monitor.read().fiveHour.utilization, null);
  const first = monitor.refresh();
  assert.equal(monitor.refresh({ force: true }), first);
  const snapshot = await first;
  assert.equal(snapshot.fiveHour.utilization, 12.5);
  assert.equal(snapshot.stale, false);
  await monitor.refresh();
  assert.equal(updates.length, 1);
  let record = JSON.parse(await readFile(join(cwd, 'record.json'), 'utf8'));
  assert.equal(record.count, 1);
  assert(record.args.includes('/usage'));
  assert(record.args.includes('--safe-mode'));
  assert.equal(record.key, undefined);
  assert.equal(record.proxy, 'http://proxy.example:8080');
  advance(90_000);
  assert.equal(monitor.read().stale, true);
  await monitor.refresh();
  record = JSON.parse(await readFile(join(cwd, 'record.json'), 'utf8'));
  assert.equal(record.count, 2);
});

test('refresh failure retains last successful values and timestamp while exposing stale status', async t => {
  const { monitor, advance } = await fixture(t);
  const before = await monitor.refresh();
  advance(90_000);
  monitor.env.FIXTURE_MODE = 'fail';
  const after = await monitor.refresh();
  assert.equal(after.fiveHour.utilization, before.fiveHour.utilization);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(after.stale, true);
  assert(after.unavailableReason);
  assert(!JSON.stringify(after).includes('private diagnostic'));
  assert(!JSON.stringify(after).includes('sk-ant-'));
});

test('null report retains cached data and accidental model results are not adopted', async t => {
  const { monitor } = await fixture(t);
  await monitor.refresh();
  monitor.env.FIXTURE_MODE = 'null';
  const missing = await monitor.refresh({ force: true });
  assert.equal(missing.fiveHour.utilization, 12.5);
  assert.equal(missing.stale, true);
  monitor.env.FIXTURE_MODE = 'model-call';
  const invalid = await monitor.refresh({ force: true });
  assert.match(invalid.unavailableReason, /无模型调用/);
});

test('expired windows and expired block deadlines become stale or unknown instead of invented recovery', async t => {
  const { monitor, advance } = await fixture(t);
  await monitor.refresh();
  monitor.observe(normalizeRateLimit({ status: 'rejected', resetsAt: 1893459600 }, '2030-01-01T00:00:00Z'));
  assert.equal(monitor.read().rateLimited, true);
  advance(6 * 3600_000);
  const after = monitor.read();
  assert.equal(after.rateLimited, null);
  assert.equal(after.cooldownUntil, null);
  assert.equal(after.stale, true);
  assert.equal(after.fiveHour.utilization, 12.5, 'keep a clearly stale historical value, never invent a reset to zero');
});

test('close cancels an in-flight query process and blocks future refreshes', async t => {
  const { cwd, monitor } = await fixture(t);
  monitor.env.FIXTURE_MODE = 'hang';
  const pending = monitor.refresh();
  let record;
  for (let i = 0; i < 100; i++) {
    try { record = JSON.parse(await readFile(join(cwd, 'record.json'), 'utf8')); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  assert(record?.pid, 'fixture must have started');
  await monitor.close();
  const result = await pending;
  assert.equal(result.fiveHour.utilization, null);
  assert.equal(result.stale, true);
  assert.match(result.unavailableReason, /已停止/);
  assert.throws(() => process.kill(record.pid, 0), { code: 'ESRCH' });
  await monitor.refresh({ force: true });
  assert.equal(JSON.parse(await readFile(join(cwd, 'record.json'), 'utf8')).count, 1);
});

test('live windows from served requests update the snapshot and a rejection carries its limit type', async t => {
  const { monitor, advance } = await fixture(t);
  await monitor.refresh();
  advance(120_000);
  monitor.observe(normalizeRateLimit({ status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.6, resetsAt: 1893470400 }, seven_day: { utilization: 0.2, resetsAt: 1893974400 } } }, '2030-01-01T00:02:00Z'));
  let snapshot = monitor.read();
  assert.equal(snapshot.fiveHour.utilization, 60); assert.equal(snapshot.sevenDay.utilization, 20);
  assert.equal(snapshot.stale, false); assert.equal(snapshot.scopes[0].utilization, 77, 'model meters wait for the next /usage');
  assert.equal(snapshot.scopes[0].stale, true, 'scoped model meters are explicitly marked stale until /usage refreshes');
  monitor.observe(normalizeRateLimit({ status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: 1893470400 }, '2030-01-01T00:03:00Z'));
  snapshot = monitor.read();
  assert.equal(snapshot.rateLimited, true); assert.equal(snapshot.limitType, 'five_hour'); assert.equal(snapshot.fiveHour.utilization, 100);
  const refreshed = await monitor.refresh({ force: true });
  assert.equal(Boolean(refreshed.scopes[0].stale), false, 'fresh /usage clears stale flag on scoped meters');
  advance(5 * 3600_000);
  assert.equal(monitor.read().limitType, null);
});
