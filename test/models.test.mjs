import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModelCatalog, cleanModels, contextKey, isAliasModel, isModel, modelFamily, parseCliVersion, probeCliModels, stripModelWindow } from '../lib/models.mjs';

const reported = [
  { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-opus-5-5' },
  { value: 'opus', displayName: 'Opus', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], secret: 'never-kept' },
  { value: 'fable', displayName: 'Fable', resolvedModel: 'claude-fable-5-1', description: 'Fable 5.1' },
  { value: 'claude-opus-4-6', displayName: 'Opus 4.6', resolvedModel: 'claude-opus-4-6' },
  { value: 'opus; rm -rf /', displayName: 'injected' },
];

test('aliases and pinned versions are accepted by shape; anything else is rejected', () => {
  for (const ok of ['opus', 'sonnet', 'fable', 'haiku', 'claude-opus-4-6', 'claude-fable-5-1', 'claude-haiku-4-5-20251001']) assert.equal(isModel(ok), true, ok);
  for (const bad of ['', 'default', 'Opus', 'gpt-4', 'claude-', 'claude-opus 4', '--model=x', 'claude-opus-4-6;id', `claude-${'a'.repeat(70)}`, null, 7]) assert.equal(isModel(bad), false, String(bad));
  assert.equal(modelFamily('claude-fable-5-1'), 'fable');
  assert.equal(modelFamily('Opus'), 'opus');
  assert.equal(modelFamily('all models'), null);
});

test('reported lists keep only page fields, drop the default duplicate and invalid values', () => {
  assert.deepEqual(cleanModels(reported).map(m => m.value), ['opus', 'fable', 'claude-opus-4-6']);
  const opus = cleanModels(reported)[0];
  assert.equal(opus.secret, undefined);
  assert.deepEqual(opus.supportedEffortLevels, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('catalog keeps one list per CLI login, offers their union, persists privately without paths', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-models-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const catalog = new ModelCatalog({ dataDir });
  await catalog.init([{ updatedAt: '2030-01-01T00:00:00Z', capabilities: { version: '2.9.0', models: reported } }]);
  assert.deepEqual(catalog.list().map(m => m.value), ['opus', 'fable', 'claude-opus-4-6'], 'the first start seeds from saved session capabilities');
  assert.equal(catalog.resolve('default', 'fable'), 'claude-fable-5-1');
  assert.equal(catalog.resolve('default', 'claude-opus-4-1'), 'claude-opus-4-1', 'pinned values resolve to themselves');
  assert.equal(catalog.resolve('default', 'sonnet'), null);

  const team = contextKey('/srv/accounts/team/.claude');
  assert.match(team, /^cli-[a-f0-9]{16}$/);
  assert.equal(contextKey(undefined), 'default');
  assert.equal(catalog.observe('default', [{ value: 'opus', resolvedModel: 'claude-opus-4-6' }], '2.9.0', '2030-01-02T00:00:00Z'), true);
  assert.equal(catalog.observe('default', [{ value: 'opus', resolvedModel: 'claude-opus-4-6' }], '2.9.0', '2030-01-02T00:00:00Z'), false, 'an unchanged report is not a change');
  assert.equal(catalog.observe(team, [{ value: 'opus', resolvedModel: 'claude-opus-5-5' }, { value: 'fable', resolvedModel: 'claude-fable-5-1' }], '2.9.1', '2030-01-03T00:00:00Z'), true);
  assert.deepEqual(catalog.list().map(m => [m.value, m.resolvedModel]), [['opus', 'claude-opus-5-5'], ['fable', 'claude-fable-5-1']], 'a model one login adds is offered; the newest report leads');
  assert.equal(catalog.resolve('default', 'opus'), 'claude-opus-4-6', 'each login resolves with its own list');
  assert.equal(catalog.resolve('default', 'fable'), 'claude-fable-5-1', 'and borrows from the union for the rest');
  assert.equal(catalog.observe('default', [{ value: 'nope' }], '2.9.0'), false, 'an empty clean list is ignored');
  await catalog.save();
  const file = path.join(dataDir, 'models.json');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.doesNotMatch(await fs.readFile(file, 'utf8'), /srv|accounts/, 'config directories are stored only as hashes');
  const reloaded = new ModelCatalog({ dataDir }); await reloaded.init();
  assert.deepEqual(reloaded.list(), catalog.list());

  const empty = new ModelCatalog({ dataDir: path.join(dataDir, 'missing') }); await empty.init();
  assert.deepEqual(empty.list().map(m => m.value), ['opus', 'sonnet', 'fable', 'haiku']);
});

test('1m context window variants, supportsThinkingOff and CLI version upgrades refresh cleanly', async t => {
  for (const ok of ['opus[1m]', 'fable[1m]', 'claude-fable-5-2[1m]', 'claude-opus-5-5[1m]']) assert.equal(isModel(ok), true, ok);
  for (const bad of ['opus[2m]', 'claude-fable-5-2[10m]', '[1m]', 'default[1m]']) assert.equal(isModel(bad), false, bad);
  assert.equal(isAliasModel('fable[1m]'), true);
  assert.equal(isAliasModel('claude-fable-5-2[1m]'), false);
  assert.equal(stripModelWindow('claude-fable-5-2[1m]'), 'claude-fable-5-2');
  assert.equal(parseCliVersion('2.1.322 (Claude Code)'), '2.1.322');

  const cleaned = cleanModels([
    { value: 'fable[1m]', displayName: 'Fable (1M context)', resolvedModel: 'claude-fable-5-2[1m]', supportsEffort: true, supportsThinkingOff: false },
    { value: 'haiku', displayName: 'Haiku 5.5', resolvedModel: 'claude-haiku-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'], supportsThinkingOff: true },
  ]);
  assert.equal(cleaned[0].resolvedModel, 'claude-fable-5-2');
  assert.equal(cleaned[0].supportsThinkingOff, false);
  assert.equal(cleaned[1].supportsEffort, true);
  assert.equal(cleaned[1].supportsThinkingOff, true);

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-models-ver-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const catalog = new ModelCatalog({ dataDir });
  await catalog.init();
  assert.equal(catalog.needsRefresh('default'), true);
  const t0 = Date.parse('2026-11-12T00:00:00Z');
  catalog.observe('default', cleaned, '2.1.320 (Claude Code)', new Date(t0).toISOString(), false);
  assert.equal(catalog.versionOf('default'), '2.1.320');
  assert.equal(catalog.resolve('default', 'claude-fable-5-2[1m]'), 'claude-fable-5-2');
  assert.equal(catalog.needsRefresh('default', { version: '2.1.320 (Claude Code)', now: t0 + 60_000 }), false);
  assert.equal(catalog.needsRefresh('default', { version: '2.1.322 (Claude Code)', now: t0 + 60_000 }), true, 'CLI binary upgrade triggers model catalog refresh');
  assert.equal(catalog.needsRefresh('default', { version: '2.1.320', now: t0 + 7 * 3600_000 }), true, 'stale catalog refreshes periodically');
});

test('probeCliModels performs a zero-turn initialize handshake without sending any user message', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-model-probe-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const framesFile = path.join(dir, 'frames.jsonl');
  const fakeCli = path.join(dir, 'fake-claude');
  await fs.writeFile(fakeCli, `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  fs.appendFileSync(${JSON.stringify(framesFile)}, line + '\\n');
  const msg = JSON.parse(line);
  if (msg.type === 'control_request' && msg.request?.subtype === 'initialize') {
    process.stdout.write(JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: msg.request_id,
        response: {
          claude_code_version: '2.1.322 (Claude Code)',
          models: [
            { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-opus-5-5' },
            { value: 'opus', displayName: 'Opus 5.5', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
            { value: 'fable', displayName: 'Fable 5.2', resolvedModel: 'claude-fable-5-2', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'] },
            { value: 'haiku', displayName: 'Haiku 5.5', resolvedModel: 'claude-haiku-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'], supportsThinkingOff: true }
          ]
        }
      }
    }) + '\\n');
  }
});
rl.on('close', () => process.exit(0));
`, { mode: 0o700 });

  const probed = await probeCliModels({ binary: fakeCli, cwd: dir, timeoutMs: 5000 });
  assert.equal(probed.version, '2.1.322');
  assert.deepEqual(probed.models.map(m => [m.value, m.displayName, m.resolvedModel]), [
    ['opus', 'Opus 5.5', 'claude-opus-5-5'],
    ['fable', 'Fable 5.2', 'claude-fable-5-2'],
    ['haiku', 'Haiku 5.5', 'claude-haiku-5-5'],
  ]);
  assert.equal(probed.models[2].supportsThinkingOff, true);
  const frames = (await fs.readFile(framesFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, 'control_request');
  assert.equal(frames[0].request.subtype, 'initialize');
});
