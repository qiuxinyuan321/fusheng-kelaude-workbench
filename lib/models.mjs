import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { claudeEnvironment } from './claude-environment.mjs';

// Model choices come from the official CLI: its initialize response lists every alias it accepts
// (opus, sonnet, fable, haiku) with the exact model each resolves to, plus pinned versions
// (claude-fable-5-2, claude-opus-4-6 …) and optional [1m] context-window variants.
// The workbench stores the latest list per CLI login, refreshes it via a zero-turn initialize probe
// whenever a login is active or the CLI binary updates, and validates values strictly by shape.
export const MODEL_FAMILIES = ['opus', 'sonnet', 'fable', 'haiku'];
const ALIAS = /^(?:opus|sonnet|fable|haiku)(?:\[1m\])?$/;
const PINNED = /^claude-[a-z0-9]+(?:-[a-z0-9]+){1,6}(?:\[1m\])?$/;
export const stripModelWindow = value => typeof value === 'string' ? value.replace(/\[1m\]$/, '') : '';
export const isAliasModel = value => typeof value === 'string' && ALIAS.test(value);
export const isModel = value => typeof value === 'string' && value.length <= 64 && (ALIAS.test(value) || PINNED.test(value));
export const modelFamily = value => typeof value === 'string' ? MODEL_FAMILIES.find(family => value.toLowerCase().includes(family)) || null : null;
export const parseCliVersion = value => typeof value === 'string' ? (/(\d+\.\d+\.\d+(?:-[A-Za-z0-9._-]+)?)/.exec(value)?.[1] || null) : null;

// Before any CLI has reported its list (fresh install), offer the aliases without version names.
export const FALLBACK_MODELS = [
  { value: 'opus', displayName: 'Opus' }, { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'fable', displayName: 'Fable' }, { value: 'haiku', displayName: 'Haiku' },
];
const BOOL_FIELDS = ['supportsEffort', 'supportsAdaptiveThinking', 'supportsFastMode', 'supportsAutoMode', 'supportsThinkingOff'];
const FIELDS = ['value', 'resolvedModel', 'displayName', 'description', 'supportedEffortLevels', ...BOOL_FIELDS];
const text = (value, limit) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;

/** Keeps what the page needs from a CLI model entry. `default` duplicates an alias and is dropped. */
export function cleanModels(models) {
  const seen = new Set(), out = [];
  for (const item of Array.isArray(models) ? models : []) {
    if (!isModel(item?.value) || seen.has(item.value)) continue;
    seen.add(item.value);
    const entry = { value: item.value };
    for (const key of FIELDS.slice(1)) {
      const value = item[key];
      if (BOOL_FIELDS.includes(key) && typeof value === 'boolean') entry[key] = value;
      else if (key === 'supportedEffortLevels' && Array.isArray(value)) entry[key] = value.filter(level => typeof level === 'string').slice(0, 10);
      else if (key === 'resolvedModel' && isModel(value)) entry[key] = stripModelWindow(value);
      else if (['displayName', 'description'].includes(key) && text(value, 120)) entry[key] = text(value, 120);
    }
    out.push(entry);
    if (out.length >= 40) break;
  }
  return out;
}

/** Zero-turn official CLI initialize probe: reads the login's live model catalog without making any model API call. */
export function probeCliModels({ binary = 'claude', cwd = process.cwd(), configDir, env = {}, timeoutMs = 15_000 } = {}) {
  if (typeof binary !== 'string' || !binary || /[\x00-\x1f\x7f]/.test(binary)
    || (/[\\/]/.test(binary) && !path.isAbsolute(binary)) || typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
    return Promise.reject(new TypeError('binary must be absolute or a bare command name, and cwd must be an absolute path'));
  }
  let childEnv;
  try { childEnv = claudeEnvironment({ env, configDir }); }
  catch (error) { return Promise.reject(error); }
  childEnv.DISABLE_AUTOUPDATER = '1';
  const args = ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--permission-mode', 'manual', '--tools', '', '--no-session-persistence'];
  const requestId = `models_${randomUUID()}`;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const decoder = new StringDecoder('utf8');
    let buffer = '', found = null, failure = null, settled = false, forceTimer = null;
    const kill = signal => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
    };
    const stop = err => {
      if (err && !failure) failure = err;
      try { child.stdin.end(); } catch {}
      kill('SIGTERM');
      forceTimer ||= setTimeout(() => kill('SIGKILL'), 1000);
      forceTimer.unref?.();
    };
    const timer = setTimeout(() => stop('模型目录探测超时。'), timeoutMs);
    const consume = (chunk, end = false) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) { stop('模型目录探测输出过大。'); return; }
      const lines = buffer.split('\n');
      buffer = end ? '' : lines.pop();
      for (const line of lines) {
        if (!line.trim() || found) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg?.type === 'control_response' && msg.response?.request_id === requestId) {
          const payload = msg.response?.response || {};
          const models = cleanModels(payload.models);
          const version = parseCliVersion(payload.claude_code_version) || text(payload.claude_code_version, 40) || null;
          found = { models, version };
          stop(null);
          return;
        }
      }
    };
    child.stdout.on('data', chunk => consume(decoder.write(chunk)));
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => stop('无法启动 Claude Code 模型目录探测。'));
    child.on('spawn', () => {
      if (settled || failure) return;
      try {
        child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'initialize', hooks: null } })}\n`);
      } catch { stop('无法发送模型目录初始化请求。'); }
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      consume(decoder.end(), true);
      clearTimeout(timer);
      clearTimeout(forceTimer);
      if (found?.models?.length) resolve(found);
      else reject(new Error(failure || 'Claude Code 未返回可用模型列表。'));
    });
  });
}

/** Which CLI login reported a list: the server's own login, or a config directory a plugin chose.
 * Only a hash of the directory is kept, so models.json never records local paths. */
export const contextKey = configDir => typeof configDir === 'string' && configDir ? `cli-${createHash('sha256').update(configDir).digest('hex').slice(0, 16)}` : 'default';

export class ModelCatalog {
  constructor({ dataDir }) { this.file = path.join(dataDir, 'models.json'); this.contexts = new Map(); this.saving = Promise.resolve(); }
  /** Loads the saved lists; on first start, seeds the server's own login from capabilities saved with sessions. */
  async init(sessions = []) {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      for (const [key, value] of Object.entries(saved?.contexts || {})) {
        const models = cleanModels(value?.models);
        const ver = parseCliVersion(value?.version) || text(value?.version, 40) || null;
        if (models.length && /^(default|cli-[a-f0-9]{16})$/.test(key)) this.contexts.set(key, { models, version: ver, updatedAt: text(value.updatedAt, 40) || null });
      }
    } catch {}
    if (this.contexts.size) return;
    const latest = [...sessions].filter(s => s.capabilities?.models?.length).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if (latest && this.observe('default', latest.capabilities.models, latest.capabilities.version, latest.updatedAt, false)) await this.save().catch(() => {});
  }
  /** Returns true when that login's list or CLI version changed. */
  observe(key, models, version, at = new Date().toISOString(), persist = true) {
    const clean = cleanModels(models);
    if (!clean.length || typeof key !== 'string') return false;
    const ver = parseCliVersion(version) || text(version, 40) || null;
    const previous = this.contexts.get(key);
    const same = Boolean(previous && JSON.stringify(previous.models) === JSON.stringify(clean) && previous.version === ver);
    this.contexts.set(key, { models: clean, version: ver, updatedAt: at });
    if (persist && !same) void this.save().catch(() => console.error('Model catalog persistence failed'));
    return !same;
  }
  versionOf(key) { return this.contexts.get(key)?.version || null; }
  needsRefresh(key, { version = null, maxAgeMs = 6 * 3600_000, now = Date.now() } = {}) {
    const known = this.contexts.get(key);
    if (!known?.models?.length) return true;
    const ver = parseCliVersion(version) || text(version, 40) || null;
    if (ver && known.version !== ver) return true;
    const at = known.updatedAt ? Date.parse(known.updatedAt) : NaN;
    return !Number.isFinite(at) || now - at >= maxAgeMs;
  }
  /** Everything any login offers, newest report first, so a model one account adds (Fable on a
   * team plan) is selectable; before any report, the plain aliases. */
  list() {
    const seen = new Set(), out = [];
    for (const { models } of [...this.contexts.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))))
      for (const model of models) if (!seen.has(model.value)) { seen.add(model.value); out.push(model); }
    return out.length ? out : FALLBACK_MODELS;
  }
  resolve(key, value) {
    const own = this.contexts.get(key)?.models.find(model => model.value === value);
    return own?.resolvedModel || this.list().find(model => model.value === value)?.resolvedModel || (PINNED.test(value) ? stripModelWindow(value) : null);
  }
  save() {
    const next = this.saving.catch(() => {}).then(async () => {
      const payload = JSON.stringify({ version: 1, contexts: Object.fromEntries(this.contexts) });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, payload, { mode: 0o600 });
      await fs.rename(tmp, this.file);
    });
    this.saving = next;
    return next;
  }
}
