import {claudeEnvironment} from './claude-environment.mjs';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { MODEL_FAMILIES } from './models.mjs';

const SOURCE = 'official-cli-usage';
const DEFAULT_BINARY = 'claude';
const unknownWindow = () => ({ utilization: null, resetsAt: null });
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const label = value => typeof value === 'string' ? value.slice(0, 500) : null;
function isoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function unknownQuota(reason = '尚未读取官方套餐用量。') {
  return { fiveHour: unknownWindow(), sevenDay: unknownWindow(), scopes: [], source: SOURCE,
    updatedAt: null, stale: true, unavailableReason: reason, rateLimited: null, cooldownUntil: null, limitType: null };
}

/** SDKUsageReport is the documented structured output of Claude Code's /usage.
 * kind, not translated display text or is_active, identifies the meter.
 * https://code.claude.com/docs/en/agent-sdk/typescript#sdkusagereport
 */
export function normalizeUsageReport(report, observedAt = new Date().toISOString()) {
  const result = { ...unknownQuota(), updatedAt: isoDate(observedAt) };
  const limits = report?.rate_limits?.limits;
  if (!Array.isArray(limits)) {
    result.unavailableReason = 'Claude Code 未返回套餐用量；这不代表剩余额度为零。';
    return result;
  }
  result.stale = false;
  result.unavailableReason = limits.length ? null : '官方未返回适用的用量窗口。';
  let seenFive = false, seenSeven = false;
  for (const row of limits) {
    if (!row || typeof row.kind !== 'string') continue;
    const model = label(row.scope?.model?.display_name), surface = label(row.scope?.surface?.display_name);
    const meter = { utilization: percent(row.percent), resetsAt: isoDate(row.resets_at),
      severity: label(row.severity), isActive: typeof row.is_active === 'boolean' ? row.is_active : null };
    if (row.kind === 'session' && !model && !surface && !seenFive) { result.fiveHour = meter; seenFive = true; }
    else if (row.kind === 'weekly_all' && !model && !surface && !seenSeven) { result.sevenDay = meter; seenSeven = true; }
    else result.scopes.push({ kind: label(row.kind), group: label(row.group), model, surface, ...meter });
  }
  if (!seenFive && !seenSeven && !result.scopes.length) result.unavailableReason = '官方未返回可识别的套餐用量窗口。';
  return result;
}

// Each model family can have its own weekly meter (seven_day_opus, seven_day_fable …).
const LIMIT_TYPES = ['five_hour', 'seven_day', ...MODEL_FAMILIES.map(family => `seven_day_${family}`), 'seven_day_overage_included', 'overage'];
const WINDOWS = [['five_hour', 'fiveHour'], ['seven_day', 'sevenDay']];
const epochDate = value => {
  const date = typeof value === 'number' && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
// The CLI reports utilization as a 0–1 fraction (it shows Math.floor(utilization * 100)%).
const fraction = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 ? Math.min(100, value * 100) : null;

/** rate_limit_event is the limit decision for the request just served, not a complete usage report.
 * `rateLimitType` names the binding limit. `unifiedWindows` carries the same 5h/7d windows as
 * /usage, so it refreshes those meters between probes; a utilization without its limit type
 * stays unassigned, and model-scoped weekly meters wait for the next /usage.
 */
export function normalizeRateLimit(info, observedAt = new Date().toISOString()) {
  if (!info || !['allowed', 'allowed_warning', 'rejected'].includes(info.status)) return null;
  const reset = epochDate(info.resetsAt), limitType = LIMIT_TYPES.includes(info.rateLimitType) ? info.rateLimitType : null;
  const windows = {};
  for (const [key, name] of WINDOWS) {
    const value = info.unifiedWindows?.[key], utilization = fraction(value?.utilization);
    if (utilization !== null) windows[name] = { utilization, resetsAt: epochDate(value.resetsAt) };
  }
  const named = WINDOWS.find(([key]) => key === limitType)?.[1];
  if (named && !windows[named] && fraction(info.utilization) !== null) windows[named] = { utilization: fraction(info.utilization), resetsAt: reset };
  return { type: 'rate_limit', status: info.status, rateLimited: info.status === 'rejected', limitType,
    cooldownUntil: info.status === 'rejected' ? reset : null, windows,
    observedAt: isoDate(observedAt), source: 'official-cli-rate-limit' };
}

/** One instance per server: 90-second cached /usage, with a shared in-flight refresh.
 * Authentication stays inside the unmodified official CLI. No credential files or
 * private usage endpoints are accessed by this module. /usage is a local command:
 * its official result must report zero model turns and zero API duration.
 */
export class UsageMonitor {
  constructor({ binary = DEFAULT_BINARY, cwd = process.cwd(), onUpdate = () => {},
    ttlMs = 90_000, timeoutMs = 30_000, env = {}, configDir, now = Date.now } = {}) {
    if (typeof binary !== 'string' || !binary || (/[\\/]/.test(binary) && !isAbsolute(binary)) || !isAbsolute(cwd)) throw new TypeError('binary must be absolute or a bare command name, and cwd must be an absolute path');
    if (!(ttlMs > 0) || !(timeoutMs > 0)) throw new TypeError('timeouts must be positive');
    Object.assign(this, { binary, cwd, onUpdate, ttlMs, timeoutMs, env, configDir, now });
    this.snapshot = unknownQuota();
    this.lastAttemptAt = null;
    this.inFlight = null;
    this.rateLimitObservation = null;
    this.closed = false;
    this.queryStop = null;
  }

  read() {
    const snapshot = structuredClone(this.snapshot);
    if (snapshot.updatedAt && this.now() - Date.parse(snapshot.updatedAt) >= this.ttlMs) snapshot.stale = true;
    const expired = [snapshot.fiveHour, snapshot.sevenDay, ...snapshot.scopes]
      .some(window => window.resetsAt && Date.parse(window.resetsAt) <= this.now());
    if (expired) {
      snapshot.stale = true;
      snapshot.unavailableReason ||= '上次记录的用量窗口已重置，等待官方刷新。';
    }
    if (this.rateLimitObservation) {
      snapshot.rateLimited = this.rateLimitObservation.rateLimited;
      snapshot.cooldownUntil = this.rateLimitObservation.cooldownUntil;
      snapshot.limitType = this.rateLimitObservation.rateLimited ? this.rateLimitObservation.limitType : null;
      snapshot.rateLimitObservedAt = this.rateLimitObservation.observedAt;
      // A passed deadline is not proof of successful recovery. A fresh event
      // must confirm it; expose unknown rather than keep a stale block active.
      if (snapshot.cooldownUntil && Date.parse(snapshot.cooldownUntil) <= this.now()) {
        snapshot.rateLimited = null;
        snapshot.cooldownUntil = null;
        snapshot.limitType = null;
      }
    }
    return snapshot;
  }

  observe(event) {
    if (this.closed) return;
    if (event?.type === 'rate_limit') {
      if (typeof event.rateLimited !== 'boolean') return;
      this.rateLimitObservation = { rateLimited: event.rateLimited, limitType: LIMIT_TYPES.includes(event.limitType) ? event.limitType : null,
        cooldownUntil: isoDate(event.cooldownUntil), observedAt: isoDate(event.observedAt) };
      // Each served request carries the current 5h/7d windows: keep both meters live between probes.
      const live = WINDOWS.map(([, name]) => [name, event.windows?.[name]]).filter(([, value]) => percent(value?.utilization) !== null);
      if (live.length) {
        const snapshot = { ...this.snapshot };
        for (const [name, value] of live) snapshot[name] = { ...snapshot[name], utilization: value.utilization, resetsAt: isoDate(value.resetsAt) || snapshot[name]?.resetsAt || null };
        if (Array.isArray(snapshot.scopes) && snapshot.scopes.length) {
          snapshot.scopes = snapshot.scopes.map(scope => ({ ...scope, stale: true }));
        }
        if (live.length === WINDOWS.length) Object.assign(snapshot, { stale: false, unavailableReason: null, updatedAt: isoDate(event.observedAt) || snapshot.updatedAt });
        this.snapshot = snapshot;
      }
    } else if (event?.type === 'quota' && event.source === SOURCE) {
      const { type, ...snapshot } = event;
      this.snapshot = structuredClone(snapshot);
    } else return;
    this.onUpdate(this.read());
  }

  refresh({ force = false } = {}) {
    if (this.closed) return Promise.resolve(this.read());
    if (this.inFlight) return this.inFlight;
    if (!force && this.lastAttemptAt !== null && this.now() - this.lastAttemptAt < this.ttlMs) {
      return Promise.resolve(this.read());
    }
    this.lastAttemptAt = this.now();
    this.inFlight = this.#query().then(report => {
      const fresh = normalizeUsageReport(report, new Date(this.now()).toISOString());
      if (fresh.stale && this.snapshot.updatedAt) {
        this.snapshot = { ...this.snapshot, stale: true, unavailableReason: fresh.unavailableReason };
      } else this.snapshot = fresh;
      return this.read();
    }).catch(error => {
      this.snapshot = { ...this.snapshot, stale: true, unavailableReason: error.message };
      return this.read();
    }).then(snapshot => { if (!this.closed) this.onUpdate(snapshot); return snapshot; }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  close() {
    if (!this.closed) {
      this.closed = true;
      this.queryStop?.();
    }
    return this.inFlight ? this.inFlight.then(() => {}) : Promise.resolve();
  }

  #query() {
    const environment = claudeEnvironment({env:this.env,configDir:this.configDir});
    const args = ['-p', '/usage', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'manual',
      '--permission-prompts', 'none', '--tools', '', '--no-session-persistence', '--safe-mode'];
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, { cwd: this.cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      const decoder = new StringDecoder('utf8');
      let buffer = '', report, result, failure, settled = false, forceTimer;
      const kill = signal => { if (child.pid) { try { process.kill(-child.pid, signal); } catch {} } };
      const fail = message => {
        failure ||= message;
        kill('SIGTERM');
        forceTimer ||= setTimeout(() => kill('SIGKILL'), 1000);
      };
      this.queryStop = () => fail('用量查询已停止。');
      const timer = setTimeout(() => fail('官方用量查询超时，稍后可重试。'), this.timeoutMs);
      const consume = (text, end = false) => {
        buffer += text;
        if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { fail('官方用量输出过大，未读取。'); return; }
        const lines = buffer.split('\n');
        buffer = end ? '' : lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let message;
          try { message = JSON.parse(line); } catch { fail('官方用量输出格式不受支持。'); continue; }
          if (message.type === 'assistant' && message.usage_report) report = message.usage_report;
          if (message.type === 'rate_limit_event') {
            const event = normalizeRateLimit(message.rate_limit_info, new Date(this.now()).toISOString());
            if (event) this.observe(event);
          }
          if (message.type === 'result') result = message;
        }
      };
      child.stdout.on('data', chunk => consume(decoder.write(chunk)));
      // Drain stderr, but never expose arbitrary CLI/account diagnostics to the UI.
      child.stderr.resume();
      child.on('error', () => { failure ||= '无法启动官方 Claude Code 用量查询。'; });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        consume(decoder.end(), true);
        clearTimeout(timer);
        clearTimeout(forceTimer);
        this.queryStop = null;
        if (failure) { kill('SIGKILL'); reject(new Error(failure)); return; }
        if (code !== 0 || result?.is_error) { reject(new Error('官方 Claude Code 暂时无法读取用量；保留上次记录。')); return; }
        if (!result || result.num_turns !== 0 || result.duration_api_ms !== 0 || result.local_command !== 'usage') {
          reject(new Error('官方 CLI 未确认这是无模型调用的 /usage 命令，未采用返回值。')); return;
        }
        if (!report) { reject(new Error('当前官方 CLI 未返回结构化用量数据。')); return; }
        resolve(report);
      });
    });
  }
}
