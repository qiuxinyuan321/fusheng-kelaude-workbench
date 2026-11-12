import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SystemMonitor } from '../lib/system.mjs';

test('a recently confirmed login answers callers that cannot wait, and the check catches up in the background', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'system-auth-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const binary = join(dir, 'claude'), calls = join(dir, 'calls'), status = join(dir, 'status');
  // `auth status` takes 300 ms and answers from a file, like a CLI that is slow to start.
  await writeFile(binary, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
if (process.argv[2] === '--version') { console.log('2.1.300 (Claude Code)'); process.exit(0); }
appendFileSync(${JSON.stringify(calls)}, 'x');
setTimeout(() => console.log(readFileSync(${JSON.stringify(status)}, 'utf8')), 300);
`);
  await chmod(binary, 0o700); await writeFile(calls, '');
  const login = loggedIn => writeFile(status, JSON.stringify({ loggedIn, subscriptionType: 'pro' }));
  const checks = async () => (await readFile(calls, 'utf8')).length;
  const monitor = new SystemMonitor({ workspaceRoot: dir, binary });
  const timed = async options => { const started = Date.now(), account = await monitor.auth(options); return { loggedIn: account.loggedIn, ms: Date.now() - started }; };
  await login(true);
  // Never checked: even a caller that cannot wait gets a real answer.
  let r = await timed({ wait: false });
  assert.equal(r.loggedIn, true); assert(r.ms >= 250, `first check waits (${r.ms} ms)`); assert.equal(await checks(), 1);
  r = await timed(); assert(r.ms < 200, 'reused within 60 s'); assert.equal(await checks(), 1);
  // Four minutes later the login was revoked: a turn still starts at once, and the background check records the change.
  await login(false); monitor.lastAccount = Date.now() - 4 * 60_000;
  r = await timed({ wait: false });
  assert.equal(r.loggedIn, true); assert(r.ms < 200, `trusted login answers at once (${r.ms} ms)`);
  for (let i = 0; i < 60 && monitor.account.loggedIn !== false; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(monitor.account.loggedIn, false); assert.equal(await checks(), 2);
  // A known logout is checked again before it is reported, so a new login shows up.
  await login(true); monitor.lastAccount = Date.now() - 61_000;
  r = await timed({ wait: false }); assert.equal(r.loggedIn, true); assert(r.ms >= 250);
  // Callers that wait, and logins older than 10 minutes, are checked first.
  monitor.lastAccount = Date.now() - 2 * 60_000;
  r = await timed(); assert.equal(r.loggedIn, true); assert(r.ms >= 250);
  await login(false); monitor.lastAccount = Date.now() - 11 * 60_000;
  r = await timed({ wait: false }); assert.equal(r.loggedIn, false); assert(r.ms >= 250);
  assert.equal(await checks(), 5);
  // noteAuthenticated does not forge login when logged out, and renews the 10-minute trust window when logged in.
  monitor.noteAuthenticated();
  assert.equal(monitor.account.loggedIn, false);
  await login(true);
  await monitor.auth({ force: true });
  assert.equal(await checks(), 6);
  monitor.lastAccount = Date.now() - 12 * 60_000;
  monitor.noteAuthenticated();
  r = await timed({ wait: false });
  assert.equal(r.loggedIn, true);
  assert(r.ms < 100, 'renewed login trust answers immediately after a >10m foreground turn');
  assert.equal(await checks(), 6);
});
