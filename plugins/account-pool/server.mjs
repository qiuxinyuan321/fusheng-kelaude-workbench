import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { claudeEnvironment } from '../../lib/claude-environment.mjs';
import { UsageMonitor, unknownQuota } from '../../lib/usage.mjs';
import { routeCandidates, shouldSwitch, SWITCH_LEVELS } from './routing.mjs';
import { transferConversation } from './transfer.mjs';

export const PRIMARY_ACCOUNT_ID = 'primary';
// Composer choice meaning "no fixed account": the session follows the global strategy.
export const AUTO_CHOICE = 'auto';
const RUNNING = ['running', 'awaiting_approval', 'stopping'];
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const STRATEGIES = ['sticky', 'round-robin', 'quota'];
const fail = (status, message) => Object.assign(new Error(message), { status, statusCode: status });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const idIsValid = id => id === PRIMARY_ACCOUNT_ID || (typeof id === 'string' && UUID.test(id));
const bounded = (value, max = 80) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
const initialAuth = () => ({ loggedIn: null, emailMask: null, subscriptionType: null, authMethod: null });
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const date = now => new Date(now()).toISOString();

export function maskEmail(value) {
  if (typeof value !== 'string' || value.length > 320) return null;
  const match = value.match(/^([^\s@]+)@([^\s@]+\.[^\s@]+)$/);
  return match ? `${match[1][0]}***@${match[2]}` : null;
}

function label(value) {
  if (!bounded(value, 60)?.trim()) throw fail(400, '账号名称须为 1–60 个字符。');
  return value.trim();
}

function fields(params, allowed) {
  if (!object(params) || Object.keys(params).some(key => !allowed.includes(key))) throw fail(400, '插件参数无效。');
}

/** Official authentication remains in the CLI. This module persists identifiers and routing
 * preferences only; no credential file is read, copied or returned by its API.
 * The host must acquire its global execution lock before beforeRun(), and provide
 * withExclusive() for interactive API operations that probe or change execution state. */
export async function createAccountPool(options) {
  const pool = new AccountPool(options);
  await pool.init();
  return pool;
}

class AccountPool {
  constructor({ dataDir, workspaceRoot, binary = 'claude', legacyConfigDir = path.join(homedir(), '.claude'),
    env = {}, isActive = () => true, isBusy = () => false, withExclusive = async fn => fn(), getSession = () => null,
    authProvider, usageFactory = options => new UsageMonitor(options), now = Date.now,
    exec = promisify(execFile), onUpdate = () => {}, authTtlMs = 60_000 } = {}) {
    if (![dataDir, workspaceRoot, legacyConfigDir].every(value => typeof value === 'string' && path.isAbsolute(value))) {
      throw new TypeError('Account data, workspace and legacy configuration paths must be absolute');
    }
    if (typeof binary !== 'string' || !binary || /[\x00-\x1f\x7f]/.test(binary) ||
      (!path.isAbsolute(binary) && !/^[A-Za-z0-9_.-]+$/.test(binary))) throw new TypeError('CLI binary must be absolute or a command name');
    if (!(authTtlMs > 0)) throw new TypeError('Authentication cache TTL must be positive');
    Object.assign(this, { dataDir, workspaceRoot, binary, legacyConfigDir, env, isActive, isBusy, withExclusive,
      getSession, authProvider, usageFactory, now, exec, onUpdate, authTtlMs });
    this.filename = path.join(dataDir, 'accounts.json');
    this.profilesRoot = path.join(dataDir, 'profiles');
    this.state = { version: 1, defaultAccountId: PRIMARY_ACCOUNT_ID, settings: { strategy: 'sticky', switchAt: 100 },
      cursor: null, accounts: [{ id: PRIMARY_ACCOUNT_ID, label: '默认账号', enabled: true, createdAt: date(now) }], bindings: {} };
    this.runtime = new Map();
    this.runAccounts = new Map();
    this.operations = Promise.resolve();
    this.closed = false;
  }

  async init() {
    await this.#directory(this.dataDir);
    await this.#directory(this.profilesRoot);
    try {
      if ((await this.#file(this.filename)).size > 2 * 1024 * 1024) throw fail(500, '账号插件配置过大。');
      const raw = await fs.readFile(this.filename, 'utf8');
      if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw fail(500, '账号插件配置过大。');
      this.state = this.#validateState(JSON.parse(raw));
    } catch (error) {
      if (error.code !== 'ENOENT') throw fail(500, '账号插件配置无法读取，未重建或覆盖现有账号。');
      await this.#persist();
    }
    for (const account of this.state.accounts) await this.#prepare(account.id);
    return this;
  }

  #validateState(value) {
    if (!object(value) || value.version !== 1 || !Array.isArray(value.accounts) || !value.accounts.length ||
      value.accounts.length > 10 || !object(value.settings) || !STRATEGIES.includes(value.settings.strategy) ||
      !SWITCH_LEVELS.includes(value.settings.switchAt) || !object(value.bindings) || Object.keys(value.bindings).length > 10000) {
      throw fail(500, '账号插件配置格式无效。');
    }
    const ids = new Set();
    const accounts = value.accounts.map(account => {
      if (!object(account) || !idIsValid(account.id) || ids.has(account.id) || typeof account.enabled !== 'boolean') throw fail(500, '账号插件配置格式无效。');
      ids.add(account.id);
      return { id: account.id, label: label(account.label), enabled: account.enabled, createdAt: bounded(account.createdAt) || date(this.now) };
    });
    if (!ids.has(PRIMARY_ACCOUNT_ID) || !accounts.find(account => account.id === value.defaultAccountId)?.enabled ||
      (value.cursor !== null && !ids.has(value.cursor))) throw fail(500, '默认账号配置无效。');
    const bindings = {};
    for (const [sessionId, binding] of Object.entries(value.bindings)) {
      if (!UUID.test(sessionId) || !object(binding) || !ids.has(binding.accountId) ||
        !ids.has(binding.transcriptAccountId) || typeof binding.pinned !== 'boolean') throw fail(500, '会话账号绑定配置无效。');
      bindings[sessionId] = { accountId: binding.accountId, transcriptAccountId: binding.transcriptAccountId, pinned: binding.pinned };
    }
    return { version: 1, defaultAccountId: value.defaultAccountId,
      settings: { strategy: value.settings.strategy, switchAt: value.settings.switchAt }, cursor: value.cursor, accounts, bindings };
  }

  #active() {
    if (this.closed || !this.isActive()) throw fail(409, '多账号插件已停用，请重新启用后操作。');
  }

  #record(id) {
    if (!idIsValid(id)) throw fail(400, '账号 ID 无效。');
    const account = this.state.accounts.find(account => account.id === id);
    if (!account) throw fail(404, '账号不存在。');
    return account;
  }

  #runtime(id) {
    this.#record(id);
    if (!this.runtime.has(id)) this.runtime.set(id, { auth: initialAuth(), lastAuthAt: null, monitor: null });
    return this.runtime.get(id);
  }

  #configDir(id) {
    this.#record(id);
    return id === PRIMARY_ACCOUNT_ID ? undefined : path.join(this.profilesRoot, id, 'config');
  }

  #storageDir(id) { return this.#configDir(id) || this.legacyConfigDir; }

  #monitor(id) {
    const runtime = this.#runtime(id);
    runtime.monitor ||= this.usageFactory({ accountId: id, binary: this.binary, cwd: this.workspaceRoot,
      env: this.env, configDir: this.#configDir(id), now: this.now,
      onUpdate: () => { if (!this.closed && this.isActive()) this.onUpdate(); } });
    return runtime.monitor;
  }

  #account(id) {
    const account = this.#record(id), runtime = this.#runtime(id);
    return structuredClone({ ...account, isDefault: id === this.state.defaultAccountId,
      primary: id === PRIMARY_ACCOUNT_ID, auth: runtime.auth,
      usage: runtime.monitor?.read?.() || unknownQuota() });
  }

  snapshot() {
    return { accounts: this.state.accounts.map(account => this.#account(account.id)),
      defaultAccountId: this.state.defaultAccountId, settings: structuredClone(this.state.settings),
      bindings: structuredClone(this.state.bindings) };
  }

  sessionState(sessionId) { return structuredClone(this.state.bindings[sessionId] || null); }
  ownsSession(session) { return Boolean(this.state.bindings[session?.id]?.transcriptAccountId !== undefined && this.state.bindings[session.id].transcriptAccountId !== PRIMARY_ACCOUNT_ID); }

  async readUsage({ session, choice = null, refresh = false, inProgress = false } = {}) {
    this.#active();
    if (!session && choice === AUTO_CHOICE) return { ...unknownQuota(), contextLabel: '自动选择', unavailableReason: '新一轮开始时确定所用账号。' };
    const chosen = typeof choice === 'string' && choice !== AUTO_CHOICE ? this.#record(choice) : null;
    if (chosen && !chosen.enabled) throw fail(409, '无法读取停用账号的额度。');
    const binding = this.state.bindings[session?.id];
    // While a process is running, use the owner recorded at launch. Idle pinned
    // sessions show their selected account; automatic sessions show the last owner.
    const id = (inProgress ? this.runAccounts.get(session?.id) || binding?.transcriptAccountId || chosen?.id : chosen?.id || (binding?.pinned ? binding.accountId : binding?.transcriptAccountId)) || this.state.defaultAccountId;
    const monitor = this.#monitor(id);
    if (refresh) await monitor.refresh({ force: true });
    else void monitor.refresh().catch(() => {});
    this.#active();
    return { ...monitor.read(), contextLabel: this.#record(id).label };
  }

  async executionStatus() {
    this.#active();
    if (!this.isBusy()) {
      try {
        await this.withExclusive(() => this.#enqueue(async () => {
          for (const account of this.state.accounts) if (account.enabled) await this.#refresh(account.id, { usage: false });
        }));
      } catch (error) {
        // A task may acquire the lock between the initial check and acquisition.
        // Its current run keeps priority; readiness can use the existing cache.
        if (error.status !== 409 || !this.isBusy() || !this.isActive() || this.closed) throw error;
      }
    }
    this.#active();
    const enabled = this.state.accounts.filter(account => account.enabled);
    const loggedIn = enabled.filter(account => this.#runtime(account.id).auth.loggedIn === true).length;
    const unknown = enabled.some(account => this.#runtime(account.id).auth.loggedIn === null);
    return { ready: loggedIn ? true : unknown ? null : false, label: '账号插件',
      detail: loggedIn ? `${loggedIn} 个已启用账号已确认登录。` : unknown ? '账号登录状态待确认，请在插件中刷新。' : '启用的账号尚未登录，请在插件中完成官方登录。' };
  }

  async call(method, params = {}) {
    this.#active();
    if (method === 'list') { fields(params, []); return this.snapshot(); }
    if (method === 'loginCommand') {
      fields(params, ['id']);
      const account = this.#record(params.id);
      if (!account.enabled) throw fail(409, '请先启用此账号。');
      // Commands are copied to the operator's own server terminal; the plugin does
      // not open a browser, collect an OAuth code or store terminal output.
      const configDir = this.#configDir(account.id);
      const clear = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_PROFILE',
        'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
        'CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDECODE', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONSTARTUP'];
      return { command: `cd ${quote(this.workspaceRoot)} && env ${clear.map(key => `-u ${key}`).join(' ')} ${configDir ? `CLAUDE_CONFIG_DIR=${quote(configDir)} ` : ''}${quote(this.binary)} auth login --claudeai`,
        note: '在工作台所在服务器，以运行工作台的同一系统用户执行。停止运行中的任务后再登录；完成后点击“刷新账号状态”。', accountId: account.id };
    }
    if (!['create', 'update', 'settings', 'bind', 'refresh'].includes(method)) throw fail(404, '未知账号插件方法。');
    // A binding only records which account the session's next turn uses; its records move in beforeRun.
    // It therefore waits for this plugin's queue, not for other sessions' tasks to finish.
    if (method === 'bind') return this.#enqueue(async () => {
      this.#active();
      fields(params, ['sessionId', 'accountId']);
      if (typeof params.sessionId !== 'string' || !UUID.test(params.sessionId)) throw fail(400, '会话 ID 无效。');
      const session = await this.getSession(params.sessionId);
      if (!session || session.id !== params.sessionId) throw fail(404, '会话不存在。');
      // The page locks its picker during a turn too. A binding made while a turn is starting is still safe:
      // beforeRun records the account the transcript now lives under, and the next turn moves it from there.
      if (RUNNING.includes(session.status)) throw fail(409, '这个会话正在运行，请等本轮结束后再切换账号。');
      if (params.accountId !== null && !this.#record(params.accountId).enabled) throw fail(409, '无法绑定停用账号。');
      const previous = structuredClone(this.state);
      try {
        const old = this.state.bindings[params.sessionId];
        this.state.bindings[params.sessionId] = { accountId: params.accountId || old?.accountId || this.state.defaultAccountId,
          transcriptAccountId: old?.transcriptAccountId || PRIMARY_ACCOUNT_ID, pinned: params.accountId !== null };
        this.#active();
        await this.#persist();
      } catch (error) { this.state = previous; throw error; }
      this.onUpdate();
      return this.snapshot();
    });
    return this.withExclusive(() => this.#enqueue(async () => {
      this.#active();
      if (method === 'refresh') {
        fields(params, ['id']);
        const ids = params.id === undefined ? this.state.accounts.filter(account => account.enabled).map(account => account.id) : [this.#record(params.id).id];
        for (const id of ids) { this.#active(); await this.#refresh(id, { force: true, usage: true }); }
        this.#active();
        return this.snapshot();
      }
      const previous = structuredClone(this.state);
      try {
        if (method === 'create') {
          fields(params, ['label']);
          if (this.state.accounts.length >= 10) throw fail(409, '最多可保留 10 个账号。');
          const account = { id: randomUUID(), label: label(params.label || `账号 ${this.state.accounts.length + 1}`), enabled: true, createdAt: date(this.now) };
          this.state.accounts.push(account);
          await this.#prepare(account.id);
        } else if (method === 'update') {
          fields(params, ['id', 'label', 'enabled', 'isDefault']);
          const account = this.#record(params.id);
          if (params.label !== undefined) account.label = label(params.label);
          if (params.enabled !== undefined) {
            if (typeof params.enabled !== 'boolean') throw fail(400, '账号启用状态无效。');
            account.enabled = params.enabled;
          }
          if (params.isDefault !== undefined) {
            if (params.isDefault !== true) throw fail(400, '请通过选择另一个账号变更默认账号。');
            this.state.defaultAccountId = account.id;
          }
          if (!this.#record(this.state.defaultAccountId).enabled) throw fail(409, '默认账号必须启用，请先选择其他默认账号。');
        } else if (method === 'settings') {
          fields(params, ['strategy', 'switchAt']);
          if (params.strategy !== undefined) {
            if (!STRATEGIES.includes(params.strategy)) throw fail(400, '账号策略无效。');
            this.state.settings.strategy = params.strategy;
          }
          if (params.switchAt !== undefined) {
            if (!SWITCH_LEVELS.includes(params.switchAt)) throw fail(400, '切换阈值仅支持 90、95、98、100。');
            this.state.settings.switchAt = params.switchAt;
          }
        }
        this.#active();
        await this.#persist();
        this.onUpdate();
        return this.snapshot();
      } catch (error) { this.state = previous; throw error; }
    }));
  }

  /** Called only while the host owns the task/terminal/probe lock. Routing happens
   * at turn boundaries; this plugin never repeats an interrupted request. */
  async beforeRun({ session, cwd = this.workspaceRoot, request = {}, kind = 'run' } = {}) {
    this.#active();
    if (!session || !UUID.test(session.id) || typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw fail(400, '会话运行参数无效。');
    const relative = path.relative(this.workspaceRoot, cwd);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw fail(400, '会话工作区超出允许范围。');
    return this.#enqueue(async () => {
      this.#active();
      for (const record of this.state.accounts) {
        if (record.enabled) { this.#active(); await this.#refresh(record.id, { usage: true }); }
      }
      this.#active();
      let binding = this.state.bindings[session.id];
      // A choice made in the composer before this conversation existed arrives with its first message.
      if (typeof request.choice === 'string') {
        if (request.choice === AUTO_CHOICE) { if (binding?.pinned) binding = { ...binding, pinned: false }; }
        else {
          const chosen = this.state.accounts.find(account => account.id === request.choice);
          if (!chosen?.enabled) throw fail(409, '所选账号不存在或已停用，请在输入框重新选择账号。');
          binding = { accountId: chosen.id, transcriptAccountId: binding?.transcriptAccountId || PRIMARY_ACCOUNT_ID, pinned: true };
        }
      }
      const model = request.model || session.model;
      const { strategy, switchAt } = this.state.settings;
      const preferredId = binding?.accountId || this.state.defaultAccountId;
      const accounts = this.state.accounts.map(account => this.#account(account.id));
      const candidates = routeCandidates(accounts, { model, below: switchAt, now: this.now() });
      let selected;
      if (binding?.pinned) {
        selected = accounts.find(account => account.id === preferredId && account.enabled && account.auth.loggedIn === true);
        if (!selected || shouldSwitch(selected, { model, switchAt: 100, now: this.now() })) throw fail(409, '绑定的账号尚未登录、已停用或额度不可用；请在多账号插件中重新绑定。');
      } else if (strategy === 'round-robin') {
        const eligible = this.state.accounts.filter(account => candidates.some(candidate => candidate.account.id === account.id));
        const cursor = this.state.accounts.findIndex(account => account.id === this.state.cursor);
        selected = [...this.state.accounts.slice(cursor + 1), ...this.state.accounts.slice(0, cursor + 1)]
          .find(account => eligible.some(candidate => candidate.id === account.id));
      } else if (strategy === 'quota') {
        selected = candidates[0]?.account;
      } else {
        selected = candidates.find(candidate => candidate.account.id === preferredId)?.account || candidates[0]?.account;
      }
      if (!selected) throw fail(409, '没有已登录且低于切换阈值的可用账号。请刷新账号状态、调整阈值或等待官方额度恢复。');
      await this.#prepare(selected.id);
      const sourceId = binding?.transcriptAccountId || PRIMARY_ACCOUNT_ID;
      if (session.claudeSessionId && sourceId !== selected.id) {
        await transferConversation({ sessionId: session.claudeSessionId, sourceDir: this.#storageDir(sourceId),
          targetDir: this.#storageDir(selected.id), cwd });
      }
      this.#active();
      const previous = structuredClone(this.state);
      try {
        this.state.bindings[session.id] = { accountId: selected.id, transcriptAccountId: selected.id, pinned: binding?.pinned || false };
        this.state.cursor = selected.id;
        await this.#persist();
      } catch (error) { this.state = previous; throw error; }
      // Only chat turns report their exit; terminals keep no per-turn account.
      if (kind === 'run') this.runAccounts.set(session.id, selected.id);
      this.onUpdate();
      return { accountId: selected.id, configDir: this.#configDir(selected.id) };
    });
  }

  onEvent({ session, event } = {}) {
    // Quota events belong to the account this turn started on, even if the session was rebound meanwhile.
    const accountId = this.runAccounts.get(session?.id) || this.state.bindings[session?.id]?.accountId;
    if (!accountId || this.closed || !this.isActive()) return;
    if (event?.type === 'quota' || event?.type === 'rate_limit') this.#monitor(accountId).observe?.(event);
  }

  // Routing is persisted before launch; no automatic replay occurs.
  onExit({ session } = {}) { this.runAccounts.delete(session?.id); }

  async close() {
    this.closed = true;
    await Promise.allSettled([...this.runtime.values()].map(runtime => runtime.monitor?.close?.()));
    await this.operations;
  }

  async #refresh(id, { force = false, usage = false } = {}) {
    this.#active();
    const runtime = this.#runtime(id);
    if (force || runtime.lastAuthAt === null || this.now() - runtime.lastAuthAt >= this.authTtlMs) {
      await this.#prepare(id);
      try {
        const configDir = this.#configDir(id), env = claudeEnvironment({ env: this.env, configDir });
        let result;
        if (this.authProvider) result = await this.authProvider({ accountId: id, configDir, binary: this.binary, cwd: this.workspaceRoot, env });
        else {
          let stdout;
          try { ({ stdout } = await this.exec(this.binary, ['auth', 'status'], { cwd: this.workspaceRoot, env, timeout: 15_000, maxBuffer: 32768, encoding: 'utf8' })); }
          catch (error) { if (typeof error.stdout !== 'string') throw error; stdout = error.stdout; }
          result = JSON.parse(stdout);
        }
        runtime.auth = { loggedIn: typeof result?.loggedIn === 'boolean' ? result.loggedIn : null,
          emailMask: maskEmail(result?.email), subscriptionType: bounded(result?.subscriptionType), authMethod: bounded(result?.authMethod) };
      } catch { runtime.auth = initialAuth(); }
      runtime.lastAuthAt = this.now();
    }
    this.#active();
    if (usage && this.#record(id).enabled && runtime.auth.loggedIn === true) await this.#monitor(id).refresh({ force });
  }

  #enqueue(operation) {
    const result = this.operations.catch(() => {}).then(operation);
    this.operations = result.catch(() => {});
    return result;
  }

  async #directory(directory) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail(500, '账号目录必须是独立的真实目录。');
  }

  async #file(filename) {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw fail(500, '账号配置必须是独立文件。');
    return stat;
  }

  async #prepare(id) {
    if (id === PRIMARY_ACCOUNT_ID) return;
    // Every controlled ancestor is checked on every operation, including after a
    // restart. No caller-provided filesystem path enters this hierarchy.
    await this.#directory(this.dataDir);
    await this.#directory(this.profilesRoot);
    await this.#directory(path.join(this.profilesRoot, id));
    await this.#directory(this.#configDir(id));
  }

  async #persist() {
    await this.#directory(this.dataDir);
    try { await this.#file(this.filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = path.join(this.dataDir, `.accounts-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(this.state, null, 2)}\n`);
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(temporary, this.filename);
    } finally { await handle?.close(); await fs.rm(temporary, { force: true }); }
  }
}
