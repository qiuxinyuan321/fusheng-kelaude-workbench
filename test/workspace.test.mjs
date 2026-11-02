import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { Workspace, TEXT_LIMIT, UPLOAD_LIMIT } from '../lib/workspace.mjs';

const exec = promisify(execFile);
const hash = text => createHash('sha256').update(text).digest('hex');
const rejected = (operation, status, code) => assert.rejects(operation, error => {
  assert.equal(error.status, status, error.message);
  if (code) assert.equal(error.code, code);
  return true;
});
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-workspace-'));
  const root = path.join(base, 'workspace'), outside = path.join(base, 'outside');
  await fs.mkdir(root); await fs.mkdir(outside);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, root, outside, workspace: new Workspace(root) };
}
async function git(root, ...args) {
  return exec('git', ['--no-pager', '--literal-pathspecs', '-c', 'user.name=Workspace Test',
    '-c', 'user.email=workspace-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
  { cwd: root, timeout: 10000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } });
}
async function init(root) { await git(root, 'init', '-b', 'main'); }

test('nested creation, UTF-8 read/write and sorted metadata work in a real directory', async t => {
  const { root, workspace: w } = await fixture(t);
  assert.deepEqual(await w.mkdir('src'), { path: 'src', type: 'directory' });
  await w.mkdir('src/子目录');
  const saved = await w.write('src/子目录/你好.txt', '你好，世界🙂\nsecond line\n', null);
  const result = await w.read('src/子目录/你好.txt');
  assert.equal(result.text, '你好，世界🙂\nsecond line\n');
  assert.equal(result.hash, hash(result.text)); assert.equal(result.hash, saved.hash);
  assert.equal(result.size, Buffer.byteLength(result.text));
  assert.equal((await fs.stat(path.join(root, 'src'))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(root, result.path))).mode & 0o777, 0o600);
  const listing = await w.list('src');
  assert.equal(listing.path, 'src'); assert.equal(listing.entries[0].type, 'directory');
  assert.equal(listing.entries[0].path, 'src/子目录'); assert.equal(listing.truncated, false);
  assert.doesNotThrow(() => JSON.stringify({ listing, result, saved }));
});

test('all public file methods reject traversal and absolute or ambiguous paths', async t => {
  const { workspace: w, outside } = await fixture(t);
  await fs.writeFile(path.join(outside, 'important.txt'), 'do not change');
  for (const name of ['../outside/important.txt', '/etc/passwd', 'a/../b', './a', 'a//b',
    'a\\b', 'C:\\Windows\\x', 'C:/Windows/x', 'a\0b', 'a\nb']) {
    await rejected(w.read(name), 400);
    await rejected(w.list(name), 400);
    await rejected(w.write(name, 'changed', null), 400);
    await rejected(w.upload(name, Buffer.from('changed').toString('base64')), 400);
    await rejected(w.mkdir(name), 400);
  }
  assert.equal(await fs.readFile(path.join(outside, 'important.txt'), 'utf8'), 'do not change');
});

test('inward and outward symbolic links are never followed and disappear from list/search', async t => {
  const { root, outside, workspace: w } = await fixture(t);
  await fs.writeFile(path.join(outside, 'outside.txt'), 'escape-only marker');
  await fs.writeFile(path.join(root, 'normal.txt'), 'inside marker');
  await fs.symlink(outside, path.join(root, 'escape'));
  await fs.symlink('normal.txt', path.join(root, 'inside-link'));
  await fs.symlink(path.join(outside, 'outside.txt'), path.join(root, 'outside-link'));
  for (const name of ['escape/outside.txt', 'inside-link', 'outside-link']) {
    await rejected(w.read(name), 403, 'SYMLINK_PATH');
    await rejected(w.write(name, 'overwrite', null), 403, 'SYMLINK_PATH');
  }
  await rejected(w.mkdir('escape/created'), 403, 'SYMLINK_PATH');
  await rejected(w.upload('escape/upload', 'aGVsbG8='), 403, 'SYMLINK_PATH');
  assert.deepEqual((await w.list()).entries.map(e => e.name), ['normal.txt']);
  assert.deepEqual((await w.search('escape-only')).matches, []);
  assert.equal(await fs.readFile(path.join(outside, 'outside.txt'), 'utf8'), 'escape-only marker');
  assert.deepEqual(await fs.readdir(outside), ['outside.txt']);
});

test('a symlink root and a replaced root are rejected', async t => {
  const { base, root, workspace: w } = await fixture(t);
  await fs.symlink(root, path.join(base, 'linked-root'));
  await rejected(new Workspace(path.join(base, 'linked-root')).list(), 403, 'UNSAFE_ROOT');
  await w.list();
  await fs.rename(root, path.join(base, 'old-workspace')); await fs.mkdir(root);
  await rejected(w.write('new.txt', 'no', null), 409, 'ROOT_CHANGED');
  assert.deepEqual(await fs.readdir(root), []);
});

test('hard links cannot expose or overwrite a file outside the workspace', async t => {
  const { root, outside, workspace: w } = await fixture(t);
  const external = path.join(outside, 'private.txt'); await fs.writeFile(external, 'private marker');
  await fs.link(external, path.join(root, 'innocent.txt'));
  await rejected(w.read('innocent.txt'), 403, 'HARDLINK_FILE');
  await rejected(w.write('innocent.txt', 'changed', hash('private marker')), 403, 'HARDLINK_FILE');
  assert.deepEqual((await w.list()).entries, []);
  assert.deepEqual((await w.search('private marker')).matches, []);
  assert.equal(await fs.readFile(external, 'utf8'), 'private marker');
});

test('credential-shaped paths are filtered consistently while environment templates remain readable', async t => {
  const { root, workspace: w } = await fixture(t);
  const secretNames = ['.env', '.env.production', '.env.local', '.envrc', '.npmrc', 'credentials.json',
    'client_secret.json', 'refresh-token.txt', 'server.key', 'auth.json', 'access.json'];
  for (const name of secretNames) await fs.writeFile(path.join(root, name), 'hidden-marker');
  for (const dir of ['.claude', '.ssh', 'node_modules', '.git']) {
    await fs.mkdir(path.join(root, dir)); await fs.writeFile(path.join(root, dir, 'file.txt'), 'hidden-marker');
  }
  for (const name of ['.env.example', '.env.production.example', '.env.sample', 'README.md'])
    await fs.writeFile(path.join(root, name), 'public-marker');
  for (const name of [...secretNames, '.claude/file.txt', '.ssh/file.txt']) {
    await rejected(w.read(name), 403, 'SECRET_PATH');
    await rejected(w.write(name, 'anything', null), 403, 'SECRET_PATH');
  }
  await rejected(w.read('.GIT/config'), 403, 'HIDDEN_PATH');
  assert.deepEqual((await w.list()).entries.map(e => e.name).sort(), ['.env.example', '.env.production.example', '.env.sample', 'README.md'].sort());
  assert.equal((await w.read('.env.example')).text, 'public-marker');
  assert.deepEqual((await w.search('hidden-marker')).matches, []);
  assert.equal((await w.search('PUBLIC-marker')).matches.length, 4);
});

test('hash-based saving preserves executable mode and rejects stale or missing hashes', async t => {
  const { root, workspace: w } = await fixture(t);
  await fs.writeFile(path.join(root, 'script.sh'), 'original\n', { mode: 0o755 });
  await fs.chmod(path.join(root, 'script.sh'), 0o755); // chmod is not masked by umask, so the prior mode is 0o755 on any host
  const original = await w.read('script.sh');
  await rejected(w.write('script.sh', 'new\n'), 400, 'HASH_REQUIRED');
  await rejected(w.write('script.sh', 'new\n', null), 409, 'FILE_EXISTS');
  await rejected(w.write('script.sh', 'new\n', 'f'.repeat(64)), 409, 'HASH_MISMATCH');
  const updated = await w.write('script.sh', 'new\n', original.hash);
  assert.equal(updated.hash, hash('new\n'));
  assert.equal((await fs.stat(path.join(root, 'script.sh'))).mode & 0o777, 0o755);
  await rejected(w.write('script.sh', 'stale\n', original.hash), 409, 'HASH_MISMATCH');
  await rejected(w.write('missing.txt', 'not recreated', original.hash), 409, 'FILE_MISSING');
  assert.deepEqual((await fs.readdir(root)).sort(), ['script.sh']);
});

test('concurrent saves across Workspace instances allow exactly one writer for a hash', async t => {
  const { root, workspace: a } = await fixture(t), b = new Workspace(root);
  await a.write('shared.txt', 'base', null);
  const { hash: before } = await a.read('shared.txt');
  const results = await Promise.allSettled([a.write('shared.txt', 'writer-a', before), b.write('shared.txt', 'writer-b', before)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert(['writer-a', 'writer-b'].includes((await a.read('shared.txt')).text));
  const created = await Promise.allSettled([a.write('new.txt', 'one', null), b.write('new.txt', 'two', null)]);
  assert.equal(created.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(created.find(r => r.status === 'rejected').reason.status, 409);
});

test('text limits count UTF-8 bytes and binary files cannot be edited as text', async t => {
  const { root, workspace: w } = await fixture(t);
  const exact = 'a'.repeat(TEXT_LIMIT);
  await w.write('exact.txt', exact, null);
  assert.equal((await w.read('exact.txt')).size, TEXT_LIMIT);
  await rejected(w.write('too-big.txt', exact + 'a', null), 413);
  await rejected(w.write('wide.txt', '中'.repeat(Math.ceil(TEXT_LIMIT / 3)), null), 413);
  await rejected(w.write('bad-unicode.txt', '\ud800', null), 400, 'INVALID_TEXT');
  await rejected(w.write('nul.txt', 'hello\0world', null), 415, 'BINARY_FILE');
  await fs.writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 255]));
  await rejected(w.read('binary.dat'), 415, 'BINARY_FILE');
  await rejected(w.write('binary.dat', 'replacement', hash(Buffer.from([0, 1, 255]))), 415, 'BINARY_FILE');
  await fs.writeFile(path.join(root, 'oversize.txt'), Buffer.alloc(TEXT_LIMIT + 1, 97));
  await rejected(w.read('oversize.txt'), 413, 'FILE_TOO_LARGE');
});

test('uploads accept binary up to 8 MiB, validate canonical base64 and never clobber implicitly', async t => {
  const { root, workspace: w } = await fixture(t);
  const data = Buffer.alloc(UPLOAD_LIMIT, 0);
  const uploaded = await w.upload('large.bin', data.toString('base64'));
  assert.equal(uploaded.size, UPLOAD_LIMIT); assert.equal(uploaded.binary, true);
  assert.equal((await fs.stat(path.join(root, 'large.bin'))).size, UPLOAD_LIMIT);
  await rejected(w.upload('too-large.bin', Buffer.alloc(UPLOAD_LIMIT + 1).toString('base64')), 413);
  for (const value of ['YQ', 'YQ==\n', 'Y===', 'YQ==AAAA', 'YR==', 'data:text/plain;base64,YQ=='])
    await rejected(w.upload('invalid.bin', value), 400, 'INVALID_BASE64');
  const tiny = await w.upload('tiny.txt', 'aGVsbG8=');
  assert.equal(tiny.binary, false);
  await rejected(w.upload('tiny.txt', 'd29ybGQ='), 409, 'FILE_EXISTS');
  await w.upload('tiny.txt', 'd29ybGQ=', tiny.hash);
  assert.equal((await w.read('tiny.txt')).text, 'world');
  await w.upload('empty.txt', ''); assert.equal((await w.read('empty.txt')).text, '');
});

test('missing files and invalid types have structured errors', async t => {
  const { workspace: w } = await fixture(t);
  await rejected(w.read('missing.txt'), 404, 'NOT_FOUND');
  await w.mkdir('folder'); await rejected(w.mkdir('folder'), 409, 'ALREADY_EXISTS');
  await rejected(w.read('folder'), 400, 'NOT_FILE');
  await w.write('file.txt', 'text', null); await rejected(w.list('file.txt'), 400, 'NOT_DIRECTORY');
  await rejected(w.write('missing-parent/child.txt', 'text', null), 404, 'NOT_FOUND');
  await rejected(w.search(''), 400, 'INVALID_QUERY');
  await rejected(w.search('two\nlines'), 400, 'INVALID_QUERY');
});

test('search is literal, skips excluded data, supports subdirectories and caps results', async t => {
  const { root, workspace: w } = await fixture(t);
  await w.mkdir('src');
  await w.write('src/a.txt', 'ordinary\nFoo [bar]\nfoo [bar]\n', null);
  await fs.mkdir(path.join(root, 'node_modules')); await fs.writeFile(path.join(root, 'node_modules', 'x'), 'foo [bar]');
  await fs.writeFile(path.join(root, '.env'), 'foo [bar]');
  await fs.writeFile(path.join(root, 'binary'), Buffer.from('foo [bar]\0'));
  const result = await w.search('FOO [bar]');
  assert.deepEqual(result.matches.map(m => [m.path, m.line]), [['src/a.txt', 2], ['src/a.txt', 3]]);
  await w.write('many.txt', 'needle\n'.repeat(300), null);
  const capped = await w.search('needle');
  assert.equal(capped.matches.length, 200); assert.equal(capped.truncated, true);
});

test('search skips oversized files before applying the cumulative byte budget', async t => {
  const { root, workspace: w } = await fixture(t);
  const large = await fs.open(path.join(root, '00-large.bin'), 'w');
  try { await large.truncate(33 * 1024 * 1024); } finally { await large.close(); }
  const text = 'needle in a searchable file\n';
  await fs.writeFile(path.join(root, 'zz-target.txt'), text);
  const result = await w.search('needle');
  assert.deepEqual(result.matches.map(m => [m.path, m.line]), [['zz-target.txt', 1]]);
  assert.equal(result.truncated, false);
  assert.equal(result.scannedFiles, 2);
  assert.equal(result.scannedBytes, Buffer.byteLength(text));
});

test('search still truncates when searchable files exceed the cumulative byte budget', async t => {
  const { root, workspace: w } = await fixture(t);
  for (let i = 0; i < 16; i++) {
    await fs.writeFile(path.join(root, `file-${String(i).padStart(2, '0')}.txt`), Buffer.alloc(TEXT_LIMIT, 'x'));
  }
  await fs.writeFile(path.join(root, 'zz-target.txt'), 'needle\n');
  const result = await w.search('needle');
  assert.deepEqual(result.matches, []);
  assert.equal(result.truncated, true);
  assert.equal(result.scannedFiles, 17);
  assert.equal(result.scannedBytes, 32 * 1024 * 1024);
});

test('Git queries never discover a repository above the selected session root', async t => {
  const { base, workspace: w } = await fixture(t);
  await init(base);
  assert.equal((await w.gitStatus()).available, false);
  assert.equal((await w.diff()).available, false);
});

test('Git status and staged/unstaged diff omit secret files and include safe modifications', async t => {
  const { root, workspace: w } = await fixture(t);
  await init(root);
  await fs.writeFile(path.join(root, 'safe.txt'), 'safe old\n');
  await fs.writeFile(path.join(root, '.env'), 'SECRET_OLD\n');
  await git(root, 'add', '--', 'safe.txt', '.env'); await git(root, 'commit', '-m', 'fixture');
  await fs.writeFile(path.join(root, 'safe.txt'), 'safe staged\n'); await git(root, 'add', '--', 'safe.txt');
  await fs.writeFile(path.join(root, 'safe.txt'), 'safe working\n');
  await fs.writeFile(path.join(root, '.env'), 'SECRET_NEW\n');
  await fs.writeFile(path.join(root, 'untracked.txt'), 'new\n');
  const status = await w.gitStatus();
  assert.equal(status.available, true); assert.match(status.branch, /main/);
  assert(status.entries.some(e => e.path === 'safe.txt' && e.status === 'MM'));
  assert(!JSON.stringify(status).includes('.env'));
  const changes = await w.diff();
  assert.match(changes.stagedDiff, /safe staged/); assert.match(changes.workingDiff, /safe working/);
  assert(!changes.diff.includes('SECRET_')); assert(!changes.diff.includes('.env'));
  assert.deepEqual(changes.untrackedPaths, ['untracked.txt']);
  await rejected(w.diff('.env'), 403, 'SECRET_PATH');
});

test('Git pathspec metacharacters and leading dashes are literal file names', async t => {
  const { root, workspace: w } = await fixture(t); await init(root);
  const special = ':(glob)*.txt';
  for (const name of [special, 'other.txt', '--config']) await fs.writeFile(path.join(root, name), 'old\n');
  await git(root, 'add', '--', special, 'other.txt', '--config'); await git(root, 'commit', '-m', 'fixture');
  await fs.writeFile(path.join(root, special), 'special only\n');
  await fs.writeFile(path.join(root, 'other.txt'), 'must not appear\n');
  await fs.writeFile(path.join(root, '--config'), 'dash only\n');
  const changes = await w.diff(special);
  assert.match(changes.diff, /special only/); assert(!changes.diff.includes('must not appear'));
  assert.match((await w.diff('--config')).diff, /dash only/);
});

test('Git external diff, textconv and fsmonitor commands are never executed', async t => {
  const { root, outside, workspace: w } = await fixture(t); await init(root);
  const marker = path.join(outside, 'executed'), command = path.join(outside, 'untrusted.sh');
  await fs.writeFile(command, `#!/bin/sh\ntouch '${marker}'\nprintf malicious\n`, { mode: 0o700 });
  await fs.writeFile(path.join(root, 'safe.txt'), 'old\n');
  await fs.writeFile(path.join(root, '.gitattributes'), '*.txt diff=untrusted\n');
  await git(root, 'add', '--', 'safe.txt', '.gitattributes'); await git(root, 'commit', '-m', 'fixture');
  await git(root, 'config', 'diff.external', command);
  await git(root, 'config', 'diff.untrusted.textconv', command);
  await git(root, 'config', 'core.fsmonitor', command);
  await fs.writeFile(path.join(root, 'safe.txt'), 'changed\n');
  const status = await w.gitStatus(); assert(status.entries.some(e => e.path === 'safe.txt'));
  const changes = await w.diff('safe.txt'); assert.match(changes.diff, /changed/);
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
});

test('deleted parent directories still produce a safe tracked deletion diff', async t => {
  const { root, workspace: w } = await fixture(t); await init(root);
  await fs.mkdir(path.join(root, 'removed')); await fs.writeFile(path.join(root, 'removed', 'old.txt'), 'removed text\n');
  await git(root, 'add', '--', 'removed'); await git(root, 'commit', '-m', 'fixture');
  await fs.rm(path.join(root, 'removed'), { recursive: true });
  const status = await w.gitStatus(); assert(status.entries.some(e => e.path === 'removed/old.txt'));
  assert.match((await w.diff('removed/old.txt')).diff, /-removed text/);
});

test('external Git directories, alternates and linked metadata are rejected', async t => {
  const { root, outside, workspace: w } = await fixture(t);
  await fs.writeFile(path.join(root, '.git'), `gitdir: ${outside}\n`);
  await rejected(w.gitStatus(), 403, 'EXTERNAL_GIT_DIR');
  await fs.unlink(path.join(root, '.git')); await fs.symlink(outside, path.join(root, '.git'));
  await rejected(w.diff(), 403, 'EXTERNAL_GIT_DIR');
  await fs.unlink(path.join(root, '.git')); await init(root);
  await fs.writeFile(path.join(root, '.git', 'objects', 'info', 'alternates'), `${outside}\n`);
  await rejected(w.gitStatus(), 403, 'EXTERNAL_GIT_DIR');
  await fs.unlink(path.join(root, '.git', 'objects', 'info', 'alternates'));
  await fs.unlink(path.join(root, '.git', 'config')); await fs.symlink(path.join(outside, 'missing'), path.join(root, '.git', 'config'));
  await rejected(w.gitStatus(), 403, 'UNSAFE_GIT_METADATA');
});

test('Git excludes hard-linked working files and secret rename sources', async t => {
  const { root, outside, workspace: w } = await fixture(t); await init(root);
  await fs.writeFile(path.join(root, 'safe.txt'), 'normal\n');
  await fs.writeFile(path.join(root, '.env'), 'secret content\n');
  await git(root, 'add', '--', 'safe.txt', '.env'); await git(root, 'commit', '-m', 'fixture');
  await fs.writeFile(path.join(outside, 'private.txt'), 'EXTERNAL_PRIVATE\n');
  await fs.unlink(path.join(root, 'safe.txt')); await fs.link(path.join(outside, 'private.txt'), path.join(root, 'safe.txt'));
  await git(root, 'mv', '--', '.env', 'renamed.txt');
  const status = await w.gitStatus();
  assert(!status.entries.some(e => e.path === 'safe.txt' || e.path === 'renamed.txt'));
  const changes = await w.diff(); assert(!changes.diff.includes('EXTERNAL_PRIVATE')); assert(!changes.diff.includes('secret content'));
});

test('Git nested object links and included config files cannot escape the session', async t => {
  const { root, outside, workspace: w } = await fixture(t); await init(root);
  await fs.writeFile(path.join(outside, 'config'), '[core]\nrepositoryFormatVersion = 0\n');
  await git(root, 'config', 'include.path', path.join(outside, 'config'));
  await rejected(w.gitStatus(), 403, 'EXTERNAL_GIT_CONFIG');
  await git(root, 'config', '--unset', 'include.path');
  await fs.mkdir(path.join(root, '.git', 'objects', 'aa'));
  await fs.symlink(path.join(outside, 'config'), path.join(root, '.git', 'objects', 'aa', 'bb'));
  await rejected(w.gitStatus(), 403, 'UNSAFE_GIT_METADATA');
});
