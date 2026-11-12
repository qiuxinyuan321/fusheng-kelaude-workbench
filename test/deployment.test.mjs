import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {deploy, parseArguments, verifyBuiltAssets} from '../scripts/deploy.mjs';
import {doctor} from '../scripts/doctor.mjs';
import {parseEnv, deploymentEnvironment, systemdPath} from '../scripts/deployment-utils.mjs';

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'workbench-deploy-'));
  t.after(() => fs.rm(temp, {recursive: true, force: true}));
  const source = path.join(temp, 'source'), target = path.join(temp, 'deployment');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'package.json'), '{"private":true}');
  await fs.writeFile(path.join(source, 'package-lock.json'), '{}');
  await fs.writeFile(path.join(source, 'server.mjs'), '// fixture');
  const doctorEnv = path.join(temp, 'doctor.env');
  await fs.writeFile(doctorEnv, `WORKBENCH_ORIGIN=http://127.0.0.1:17880\nWORKBENCH_DATA=${JSON.stringify(path.join(source, 'data'))}\n`);
  const commands = [];
  const run = async (program, args, options) => { commands.push({program, args, cwd: options.cwd}); };
  return {temp, source, target, commands, run, doctorEnv};
}

test('deploy validates an explicit isolated target and never adopts an unrelated nonempty directory', async t => {
  const f = await fixture(t);
  await assert.rejects(deploy({}, f), /--target/);
  await assert.rejects(deploy({target: 'relative'}, f), /--target/);
  await assert.rejects(deploy({target: path.join(f.source, 'install')}, f), /独立/);
  await fs.mkdir(f.target);
  await fs.writeFile(path.join(f.target, 'unrelated.txt'), 'leave me alone');
  await assert.rejects(deploy({target: f.target}, f), /非空/);
  assert.equal(await fs.readFile(path.join(f.target, 'unrelated.txt'), 'utf8'), 'leave me alone');
  assert.equal(f.commands.length, 0);
});

test('fresh install uses a supplied password, binds loopback, and upgrade preserves all runtime data and config', async t => {
  const f = await fixture(t);
  const first = await deploy({target: f.target, password: 'test-only-deployment-password'}, f);
  const authFile = path.join(f.target, 'data/auth.json');
  const auth = await fs.readFile(authFile, 'utf8');
  assert(!auth.includes('test-only-deployment-password'));
  assert.equal((await fs.stat(authFile)).mode & 0o777, 0o600);
  const config = await fs.readFile(first.configFile, 'utf8');
  assert.equal(parseEnv(config).WORKBENCH_HOST, '127.0.0.1');
  // systemd 247 refuses a quoted WorkingDirectory= and marks the whole unit as bad-setting.
  assert.match(await fs.readFile(path.join(f.target, 'workbench.service'), 'utf8'), new RegExp(`^WorkingDirectory=${f.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  await fs.writeFile(path.join(f.target, 'data/conversation.json'), '{"valuable":true}');
  const second = await deploy({target: f.target}, f);
  assert.notEqual(first.release, second.release);
  assert.equal(second.previousRelease, first.release);
  assert.equal(await fs.readFile(authFile, 'utf8'), auth);
  assert.equal(await fs.readFile(first.configFile, 'utf8'), config);
  assert.equal(await fs.readFile(path.join(f.target, 'data/conversation.json'), 'utf8'), '{"valuable":true}');
  assert.equal(await fs.readlink(path.join(f.target, 'current')), path.join('releases', second.release));
  assert.deepEqual(f.commands.slice(0, 2).map(({program, args}) => [program, args]), [['npm', ['ci', '--ignore-scripts', '--no-fund', '--no-audit']], ['npm', ['run', 'build']]]);
  await assert.rejects(deploy({target: f.target, password: 'replacement-password'}, f), /不会替换/);
  await assert.rejects(deploy({target: f.target, origin: 'https://changed.example'}, f), /不会覆盖/);
});

test('failed upgrade leaves the active release and data intact, removes its partial release and unlocks', async t => {
  const f = await fixture(t);
  const first = await deploy({target: f.target}, f);
  const active = await fs.readlink(path.join(f.target, 'current'));
  await assert.rejects(deploy({target: f.target}, {...f, run: async () => { throw new Error('registry unavailable'); }}), /registry unavailable/);
  assert.equal(await fs.readlink(path.join(f.target, 'current')), active);
  assert.deepEqual(await fs.readdir(path.join(f.target, 'releases')), [first.release]);
  await assert.rejects(fs.access(path.join(f.target, '.deploy.lock')), {code: 'ENOENT'});
  assert.equal(first.authReady, false);
  await assert.rejects(fs.access(path.join(f.target, 'data/auth.json')), {code: 'ENOENT'});
});

test('verifyBuild rejects incomplete Monaco or static assets before switching current and removes the broken release', async t => {
  const f = await fixture(t);
  const first = await deploy({target: f.target}, f);
  const active = await fs.readlink(path.join(f.target, 'current'));

  await assert.rejects(
    deploy({target: f.target}, {...f, verifyBuild: true}),
    /构建产物不完整.*monaco\.js/
  );
  assert.equal(await fs.readlink(path.join(f.target, 'current')), active, 'current symlink stays on previous working release');
  assert.deepEqual(await fs.readdir(path.join(f.target, 'releases')), [first.release], 'broken candidate release directory is cleaned up');
  await assert.rejects(fs.access(path.join(f.target, '.deploy.lock')), {code: 'ENOENT'});

  const populateValidBuild = async (_program, args, options) => {
    if (args[0] !== 'run' || args[1] !== 'build') return;
    await fs.mkdir(path.join(options.cwd, 'public/vendor/editor/assets'), {recursive: true});
    for (const rel of ['public/index.html', 'public/app.js', 'public/styles.css',
      'public/vendor/editor/monaco.js', 'public/vendor/editor/monaco.css',
      'public/vendor/editor/editor.worker.js', 'public/vendor/editor/json.worker.js',
      'public/vendor/editor/css.worker.js', 'public/vendor/editor/html.worker.js',
      'public/vendor/editor/ts.worker.js', 'public/vendor/editor/assets/codicon-TEST1234.ttf']) {
      await fs.writeFile(path.join(options.cwd, rel), 'non-empty-built-asset');
    }
  };
  const upgraded = await deploy({target: f.target}, {...f, run: populateValidBuild, verifyBuild: true});
  assert.equal(await fs.readlink(path.join(f.target, 'current')), path.join('releases', upgraded.release));
  await verifyBuiltAssets(path.join(f.target, 'releases', upgraded.release));
});

test('deploy rejects credential/data symlinks and external credential paths without modifying them', async t => {
  const f = await fixture(t);
  const first = await deploy({target: f.target}, f);
  const external = path.join(f.temp, 'other-credential.json');
  await fs.writeFile(external, 'do not touch');
  const auth = path.join(f.target, 'data/auth.json');
  await fs.symlink(external, auth);
  await assert.rejects(deploy({target: f.target, password: 'supplied-password'}, f), /符号链接/);
  assert.equal(await fs.readFile(external, 'utf8'), 'do not touch');
  await fs.rm(auth);
  const config = parseEnv(await fs.readFile(first.configFile, 'utf8'));
  config.WORKBENCH_AUTH_FILE = external;
  await fs.writeFile(first.configFile, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'));
  await assert.rejects(deploy({target: f.target}, f), /data 目录/);
  assert.equal(await fs.readFile(external, 'utf8'), 'do not touch');
});

test('doctor reports missing prerequisites without creating credentials or a data directory', async t => {
  const f = await fixture(t);
  const report = await doctor({root: f.source, envFile: f.doctorEnv, skipClaude: true});
  assert.equal(report.ok, false);
  assert.equal(report.checks.find(c => c.id === 'workbench-password').status, 'fail');
  assert.equal(report.checks.find(c => c.id === 'dependencies').status, 'fail');
  assert.equal(report.checks.find(c => c.id === 'claude-auth').status, 'skip');
  await assert.rejects(fs.access(path.join(f.source, 'data')), {code: 'ENOENT'});
});

test('doctor verifies the terminal executable and uses the same auth command as the workbench', async t => {
  const f = await fixture(t), calls = [];
  const report = await doctor({root: f.source, envFile: f.doctorEnv}, {run: async (program, args) => {
    calls.push([program, args]);
    if (program === '/usr/bin/python3') throw Object.assign(new Error('not installed at terminal path'), {code: 'ENOENT'});
    if (args[0] === '--version') return {stdout: 'test-cli-version'};
    if (args.join(' ') === 'auth status') return {stdout: '{"loggedIn":true}'};
    throw new Error('unexpected CLI invocation');
  }});
  assert.equal(report.checks.find(c => c.id === 'terminal-python').status, 'fail');
  assert.match(report.checks.find(c => c.id === 'terminal-python').message, /\/usr\/bin\/python3/);
  assert.equal(report.checks.find(c => c.id === 'claude-auth').status, 'pass');
  assert.equal(calls[0][0], '/usr/bin/python3');
  assert.deepEqual(calls.at(-1)[1], ['auth', 'status']);
});

test('systemd path settings are written unquoted, with specifiers escaped and unwritable characters refused', () => {
  assert.equal(systemdPath('/srv/my workbench/100%'), '/srv/my workbench/100%%');
  for (const bad of ['relative/dir', '/srv/"quoted"', '/srv/back\\slash', '/srv/new\nline', '/srv/trailing ']) assert.throws(() => systemdPath(bad), /systemd 路径/);
});

test('configuration parsing does not execute shell syntax and deployment does not inherit another workbench configuration', () => {
  assert.equal(parseEnv('CLAUDE_BINARY="/a path/claude"\nX=\'$(touch nope)\'').X, '$(touch nope)');
  assert.throws(() => parseEnv('PORT=17880\nPORT=9999'), /重复/);
  assert.throws(() => parseArguments(['--target']), /缺少值/);
  const old = process.env.WORKBENCH_AUTH_FILE;
  process.env.WORKBENCH_AUTH_FILE = '/unrelated/secret';
  try { assert.equal(deploymentEnvironment({WORKBENCH_DATA: '/explicit/data'}).WORKBENCH_AUTH_FILE, undefined); }
  finally { if (old === undefined) delete process.env.WORKBENCH_AUTH_FILE; else process.env.WORKBENCH_AUTH_FILE = old; }
});

test('deployment CLI help is noninteractive and requires no installed project dependencies', async () => {
  const script = fileURLToPath(new URL('../scripts/deploy.mjs', import.meta.url));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--help'], {stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', code => resolve({code, output}));
  });
  assert.equal(result.code, 0);
  assert.match(result.output, /--password-stdin/);
});

test('deployment and doctor CLI entrypoints work through a current symlink', async t => {
  const f = await fixture(t);
  const repository = fileURLToPath(new URL('..', import.meta.url));
  await fs.symlink(repository, path.join(f.temp, 'current'), 'dir');
  for (const name of ['deploy', 'doctor']) {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(f.temp, `current/scripts/${name}.mjs`), '--help'], {stdio: ['ignore', 'pipe', 'pipe']});
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`exit ${code}`)));
    });
    assert.match(output, /--target/);
  }
});
