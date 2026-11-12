import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {hashPassword} from '../lib/auth.mjs';
import {parseEnv, validateConfig, inside, exists, assertNoSymlink, writeNew, command, shellQuote, systemdQuote, systemdPath} from './deployment-utils.mjs';

const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const marker = 'fusheng-kelaude-workbench-deployment';
const copyEntries = ['package.json', 'package-lock.json', 'server.mjs', 'lib', 'public', 'scripts', 'plugins', 'workshop', 'docs', 'deploy', 'test', 'README.md', 'LICENSE', 'SECURITY.md', 'DISCLAIMER.md', '.env.example', 'AGENTS.md'];
const builtStaticFiles = ['public/index.html', 'public/app.js', 'public/styles.css',
  'public/vendor/editor/monaco.js', 'public/vendor/editor/monaco.css',
  'public/vendor/editor/editor.worker.js', 'public/vendor/editor/json.worker.js',
  'public/vendor/editor/css.worker.js', 'public/vendor/editor/html.worker.js',
  'public/vendor/editor/ts.worker.js'];

export async function verifyBuiltAssets(releaseDir) {
  const missing = [];
  for (const relative of builtStaticFiles) {
    try {
      const stat = await fs.stat(path.join(releaseDir, relative));
      if (!stat.isFile() || stat.size <= 0) missing.push(relative);
    } catch { missing.push(relative); }
  }
  let hasEditorFont = false;
  try {
    const assetsDir = path.join(releaseDir, 'public/vendor/editor/assets');
    for (const entry of await fs.readdir(assetsDir)) {
      if (!entry.endsWith('.ttf')) continue;
      const stat = await fs.stat(path.join(assetsDir, entry));
      if (stat.isFile() && stat.size > 0) { hasEditorFont = true; break; }
    }
  } catch {}
  if (!hasEditorFont) missing.push('public/vendor/editor/assets/*.ttf');
  if (missing.length) throw new Error(`构建产物不完整，拒绝激活新版本：${missing.join(', ')}`);
}

export function parseArguments(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (['--help', '--password-stdin', '--start'].includes(option)) result[option.slice(2)] = true;
    else if (['--target', '--port', '--origin', '--claude-binary'].includes(option)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${option} 缺少值。`);
      result[option.slice(2)] = argv[++i];
    } else throw new Error(`未知选项：${option}`);
  }
  return result;
}

async function copySource(source, destination) {
  for (const entry of copyEntries) {
    const from = path.join(source, entry);
    if (!await exists(from)) continue;
    await fs.cp(from, path.join(destination, entry), {recursive: true, filter: async file => {
      const relative = path.relative(source, file).split(path.sep).join('/');
      if (relative === 'public/vendor' || /(?:^|\/)(?:node_modules|\.git|data)(?:\/|$)/.test(relative)) return false;
      if ((await fs.lstat(file)).isSymbolicLink()) throw new Error(`发布源不能包含符号链接：${relative}`);
      return true;
    }});
  }
}

function renderService(target) {
  return `[Unit]\nDescription=Fusheng Kelaude Workbench\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${systemdPath(target)}\nExecStart=${systemdQuote(process.execPath)} ${systemdQuote(path.join(target, 'current/scripts/run-deployment.mjs'))} ${systemdQuote(path.join(target, 'workbench.env'))}\nRestart=on-failure\nRestartSec=5\nKillMode=mixed\nTimeoutStopSec=30\nUMask=0077\nNoNewPrivileges=yes\nRestrictSUIDSGID=yes\n\n[Install]\nWantedBy=default.target\n`;
}

export async function deploy(options, {source = sourceRoot, run = command, verifyBuild = run === command} = {}) {
  if (!options.target || !path.isAbsolute(options.target)) throw new Error('必须通过 --target 指定绝对路径的部署目录。');
  if (process.platform === 'win32') throw new Error('自动部署支持 Linux/macOS；Windows 请使用 WSL2。');
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('需要 Node.js 20 或更新版本。');
  const target = path.resolve(options.target);
  source = await fs.realpath(source);
  if (target === path.parse(target).root || target === os.homedir() || inside(source, target) || inside(target, source)) throw new Error('部署目录必须独立于源码目录，且不能是根目录或用户家目录本身。');
  // macOS /tmp and /var are symlink aliases. Resolve the nearest existing
  // ancestor once, then use that canonical path for every managed write.
  let ancestor = target;
  while (!await exists(ancestor)) ancestor = path.dirname(ancestor);
  const canonical = path.join(await fs.realpath(ancestor), path.relative(ancestor, target));
  if (canonical !== target) throw new Error(`请使用真实路径 --target ${canonical}（不通过符号链接部署）。`);
  await assertNoSymlink(target);
  const manifestFile = path.join(target, 'deployment.json');
  let previous = null;
  if (await exists(manifestFile)) {
    await assertNoSymlink(manifestFile);
    previous = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    if (previous.kind !== marker || previous.schemaVersion !== 1) throw new Error('此目录不是本工具管理的部署，已停止。');
  } else if (await exists(target) && (await fs.readdir(target)).length) throw new Error('目标目录非空且没有部署标识，已停止；请选择空目录。');
  for (const relative of ['releases', 'data', 'data/auth.json', 'workbench.env', 'start.sh', 'workbench.service', '.deploy.lock']) await assertNoSymlink(path.join(target, relative));

  const configFile = path.join(target, 'workbench.env');
  const configExists = await exists(configFile);
  const config = configExists ? parseEnv(await fs.readFile(configFile, 'utf8')) : {
    WORKBENCH_HOST: '127.0.0.1', PORT: String(options.port || 17880),
    WORKBENCH_ORIGIN: options.origin || `http://127.0.0.1:${options.port || 17880}`,
    WORKBENCH_DATA: path.join(target, 'data'), WORKBENCH_AUTH_FILE: path.join(target, 'data/auth.json'),
    WORKBENCH_WORKSPACES: path.join(target, 'data/workspaces'), WORKBENCH_ROOT_OPERATIONS: '0',
    CLAUDE_BINARY: options['claude-binary'] || 'claude',
  };
  validateConfig(config);
  if (!config.WORKBENCH_DATA) throw new Error('部署配置必须明确设置 WORKBENCH_DATA；不会在程序目录里隐式创建数据。');
  for (const [option, key] of [['port', 'PORT'], ['origin', 'WORKBENCH_ORIGIN'], ['claude-binary', 'CLAUDE_BINARY']]) {
    if (configExists && options[option] !== undefined && String(options[option]) !== config[key]) throw new Error(`已存在的 ${key} 与 --${option} 不同；请明确编辑 ${configFile}，部署不会覆盖配置。`);
  }
  for (const [key, fallback] of [['WORKBENCH_DATA', path.join(target, 'data')], ['WORKBENCH_AUTH_FILE', path.join(config.WORKBENCH_DATA || target, 'auth.json')], ['WORKBENCH_WORKSPACES', path.join(config.WORKBENCH_DATA || target, 'workspaces')]]) {
    const value = config[key] || fallback;
    if (!path.isAbsolute(value) || !inside(path.join(target, 'data'), value)) throw new Error(`${key} 必须位于本部署的 data 目录中。`);
    await assertNoSymlink(value);
  }
  const authFile = config.WORKBENCH_AUTH_FILE || path.join(config.WORKBENCH_DATA, 'auth.json');
  const authExists = await exists(authFile);
  if (authExists && options.password !== undefined) throw new Error('已有登录口令，部署不会替换；升级时请去掉 --password-stdin。');
  if (options.password !== undefined && (options.password.length < 12 || options.password.length > 1024)) throw new Error('登录口令长度必须是 12 至 1024 个字符。');
  if (authExists) {
    const auth = JSON.parse(await fs.readFile(authFile, 'utf8'));
    if (!/^[a-f0-9]{48}$/i.test(auth.salt || '') || !/^[a-f0-9]{128}$/i.test(auth.hash || '')) throw new Error('已有登录口令文件格式无效，部署不会覆盖它。');
  }
  await fs.mkdir(target, {recursive: true, mode: 0o700});
  let lock;
  try { lock = await fs.open(path.join(target, '.deploy.lock'), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('此部署已有 .deploy.lock；确认没有部署正在运行后再处理该锁。'); throw error; }
  const release = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const releaseDir = path.join(target, 'releases', release);
  const temporaryLink = path.join(target, `.current-${randomUUID()}`);
  let activated = false;
  let previousRelease = null;
  try {
    if (!previous) await writeNew(manifestFile, JSON.stringify({kind: marker, schemaVersion: 1, createdAt: new Date().toISOString()}, null, 2) + '\n');
    await fs.mkdir(releaseDir, {recursive: true, mode: 0o700});
    await copySource(source, releaseDir);
    // npm lifecycle scripts are unnecessary for this project's dependencies.
    await run('npm', ['ci', '--ignore-scripts', '--no-fund', '--no-audit'], {cwd: releaseDir});
    await run('npm', ['run', 'build'], {cwd: releaseDir});
    if (verifyBuild) await verifyBuiltAssets(releaseDir);
    await fs.mkdir(config.WORKBENCH_DATA, {recursive: true, mode: 0o700});
    if (!configExists) await writeNew(configFile, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
    if (!authExists && options.password !== undefined) {
      await fs.mkdir(path.dirname(authFile), {recursive: true, mode: 0o700});
      const record = {...await hashPassword(options.password), updatedAt: new Date().toISOString()};
      await writeNew(authFile, JSON.stringify(record, null, 2) + '\n');
    }
    const launcher = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(target, 'current/scripts/run-deployment.mjs'))} ${shellQuote(configFile)}\n`;
    // Existing launchers may have administrator customization; never replace.
    if (!await exists(path.join(target, 'start.sh'))) await writeNew(path.join(target, 'start.sh'), launcher, 0o700);
    if (!await exists(path.join(target, 'workbench.service'))) await writeNew(path.join(target, 'workbench.service'), renderService(target));
    const current = path.join(target, 'current');
    if (await exists(current)) {
      if (!(await fs.lstat(current)).isSymbolicLink()) throw new Error('current 不是符号链接，部署不会覆盖。');
      const oldTarget = await fs.realpath(current);
      if (!inside(path.join(target, 'releases'), oldTarget)) throw new Error('current 指向本部署 releases 之外，已停止。');
      previousRelease = path.basename(oldTarget);
    }
    await fs.symlink(path.join('releases', release), temporaryLink, 'dir');
    await fs.rename(temporaryLink, current);
    activated = true;
    return {target, release, configFile, start: path.join(target, 'start.sh'), authReady: authExists || options.password !== undefined, previousRelease};
  } finally {
    await fs.rm(temporaryLink, {force: true});
    if (!activated) await fs.rm(releaseDir, {recursive: true, force: true});
    await lock.close();
    await fs.rm(path.join(target, '.deploy.lock'), {force: true});
  }
}

if (process.argv[1] && await fs.realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log('用法：node scripts/deploy.mjs --target /绝对路径 [--port 17880] [--origin https://域名] [--claude-binary /绝对路径/claude] [--password-stdin] [--start]\n部署只写入指定目录，保留已有配置、口令及数据，不自动注册服务或登录 Claude。');
    } else {
      if (options['password-stdin']) {
        if (process.stdin.isTTY) throw new Error('--password-stdin 需要由受保护的输入流提供口令，请勿将口令写入命令参数。');
        let password = '';
        for await (const chunk of process.stdin) { password += chunk; if (password.length > 1026) throw new Error('登录口令超过长度限制。'); }
        options.password = password.replace(/\r?\n$/, '');
      }
      const result = await deploy(options);
      console.log(JSON.stringify(result, null, 2));
      if (!result.authReady) console.log(`尚未设置登录口令：WORKBENCH_DATA=${shellQuote(path.join(result.target, 'data'))} node ${shellQuote(path.join(result.target, 'current/scripts/set-password.mjs'))}`);
      console.log(`运行检查：node ${shellQuote(path.join(result.target, 'current/scripts/doctor.mjs'))} --target ${shellQuote(result.target)}`);
      if (options.start) {
        if (!result.authReady) throw new Error('未设置登录口令，不能启动。部署文件已保留。');
        await command(process.execPath, [path.join(result.target, 'current/scripts/run-deployment.mjs'), result.configFile]);
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
