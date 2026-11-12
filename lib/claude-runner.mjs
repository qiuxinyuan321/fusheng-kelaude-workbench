import {claudeEnvironment} from './claude-environment.mjs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { isDeepStrictEqual } from 'node:util';
import { normalizeUsageReport, normalizeRateLimit } from './usage.mjs';
import { rootOperationsArgs } from './root-operations.mjs';
import { isModel, MODEL_FAMILIES } from './models.mjs';

export const DEFAULT_CLAUDE_BINARY = 'claude';
export const EFFORT_LEVELS = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
export const MODEL_ALIASES = MODEL_FAMILIES;
/** Print mode leaves thinking display unset, which the API treats as mostly empty
 * progress updates. `summarized` streams the readable official summary the
 * interactive CLI shows. The flag is hidden, so a CLI that rejects it is retried
 * once without the flag and remembered for the life of the process. */
export const THINKING_DISPLAYS = ['summarized', 'omitted', 'highlights'];
const thinkingDisplayUnsupported = new Set();
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_CHARS = 8192;
const MAX_TIMER_MS = 2 ** 31 - 1;
const SENSITIVE_KEY = /^(?:access_?token|refresh_?token|authorization|api_?key|client_?secret|password|credentials)$/i;

function redactText(value) {
  return String(value)
    .replace(/\bsk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(/((?:access_token|refresh_token|api_key|client_secret)["']?\s*[:=]\s*["']?)[^\s"',}\]]+/gi, '$1[REDACTED]');
}

// Never send authentication frames or credential-shaped fields to the web UI.
function safeValue(value, depth = 0) {
  if (depth > 30) return '[nested value omitted]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => safeValue(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
      SENSITIVE_KEY.test(k) ? '[REDACTED]' : safeValue(v, depth + 1)]));
  }
  return value;
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

// While a tool's input is still being generated, its short identifying fields are read from
// the head of the partial JSON so the UI can name the file or command early. Generated input
// follows the schema order, so these precede long content fields.
const PREVIEW_KEYS = new Set(['file_path', 'notebook_path', 'path', 'command', 'description', 'pattern', 'url', 'query', 'subagent_type', 'skill']);
const PREVIEW_HEAD_CHARS = 4096;
const FINISHED_TASK_STATUSES = ['completed', 'failed', 'killed', 'stopped', 'cancelled', 'error'];
const PREVIEW_INTERVAL_MS = 250;
export function previewToolInput(partialJson) {
  const input = {};
  for (const [, key, raw] of String(partialJson).slice(0, PREVIEW_HEAD_CHARS).matchAll(/"([a-z_]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    if (!PREVIEW_KEYS.has(key) || key in input) continue;
    try { input[key] = JSON.parse(`"${raw}"`); } catch {}
  }
  return input;
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('');
}

function allowedFields(value, fields) {
  return value && typeof value === 'object' ? Object.fromEntries(fields.filter(key => value[key] !== undefined)
    .map(key => [key, value[key]])) : {};
}

export function normalizeCapabilities(value = {}) {
  return compact({ type: 'capabilities',
    commands: (Array.isArray(value.commands) ? value.commands : []).filter(item => typeof item?.name === 'string')
      .map(item => allowedFields(item, ['name', 'description', 'argumentHint', 'aliases', 'builtin'])),
    models: (Array.isArray(value.models) ? value.models : []).filter(item => typeof item?.value === 'string')
      .map(item => allowedFields(item, ['value', 'resolvedModel', 'displayName', 'description', 'supportsEffort',
        'supportedEffortLevels', 'supportsAdaptiveThinking', 'supportsFastMode', 'supportsAutoMode', 'supportsThinkingOff'])),
    agents: (Array.isArray(value.agents) ? value.agents : []).filter(item => typeof item?.name === 'string')
      .map(item => allowedFields(item, ['name', 'description', 'model'])),
    version: typeof value.claude_code_version === 'string' ? value.claude_code_version : undefined,
  });
}

function questionInput(original, updated) {
  if (!updated || typeof updated !== 'object' || Array.isArray(updated)) throw new TypeError('updatedInput must be an object');
  for (const [key, value] of Object.entries(updated)) {
    if (key === 'answers') continue;
    if (!Object.hasOwn(original, key) || !isDeepStrictEqual(value, original[key])) {
      throw new TypeError(key === 'questions' ? 'The original questions cannot be changed' : 'Only question answers can be updated');
    }
  }
  const questions = original.questions;
  const answers = updated.answers;
  if (!Array.isArray(questions) || !answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new TypeError('Question answers must be an object');
  }
  const known = new Map(questions.map(question => [question.question, question]));
  const validated = Object.create(null);
  for (const [question, answer] of Object.entries(answers)) {
    if (!known.has(question)) throw new TypeError('Answer refers to an unknown question');
    if (typeof answer !== 'string' && !(known.get(question).multiSelect && Array.isArray(answer)
      && answer.every(item => typeof item === 'string'))) throw new TypeError('Question answer must be text');
    const text = Array.isArray(answer) ? answer.join(', ') : answer;
    if (!text.trim() || text.length > 10_000) throw new TypeError('Question answer is empty or too long');
    validated[question] = text;
  }
  if ([...known.keys()].some(question => !Object.hasOwn(validated, question))) throw new TypeError('All questions need an answer');
  return { ...original, questions, answers: validated };
}

function lastContext(usage) {
  if (!usage || number(usage.input_tokens) === undefined) return undefined;
  return (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0);
}

/** A result's modelUsage and cost are session snapshots, including restored resume totals.
 * Never add these snapshots together. `usage` alone is the main loop's per-turn usage.
 * Sources: code.claude.com/docs/en/agent-sdk/{typescript,cost-tracking}.
 */
export function normalizeResultUsage(result, { model, contextTokens } = {}) {
  const modelUsage = {};
  for (const [name, usage] of Object.entries(result.modelUsage || {})) {
    if (!usage || typeof usage !== 'object') continue;
    modelUsage[name] = compact({
      inputTokens: number(usage.inputTokens), outputTokens: number(usage.outputTokens),
      cacheReadTokens: number(usage.cacheReadInputTokens),
      cacheWriteTokens: number(usage.cacheCreationInputTokens),
      contextWindow: number(usage.contextWindow), costUsd: number(usage.costUSD),
      thinkingTokens: number(usage.thinkingTokens),
    });
  }
  const models = Object.entries(modelUsage);
  const totals = {};
  if (models.length) {
    for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
      const values = models.map(([, value]) => value[field]).filter((v) => v !== undefined);
      if (values.length) totals[field] = values.reduce((a, b) => a + b, 0);
    }
  } else {
    const usage = result.usage || {};
    Object.assign(totals, {
      inputTokens: number(usage.input_tokens), outputTokens: number(usage.output_tokens),
      cacheReadTokens: number(usage.cache_read_input_tokens),
      cacheWriteTokens: number(usage.cache_creation_input_tokens),
    });
  }
  const selected = modelUsage[model] || (models.length === 1 ? models[0][1] : undefined);
  return compact({
    type: 'usage', ...totals, scope: models.length ? 'session' : 'turn',
    cumulative: models.length > 0, final: true, source: models.length ? 'modelUsage' : 'usage',
    sessionId: result.session_id, model,
    contextTokens, contextSource: contextTokens === undefined ? undefined : 'last_response',
    contextWindow: selected?.contextWindow,
    costUsd: number(result.total_cost_usd), costScope: 'session', costEstimated: true,
    durationMs: number(result.duration_ms), apiDurationMs: number(result.duration_api_ms),
    tokensPerSecond: number(result.usage?.output_tokens) !== undefined && number(result.duration_api_ms) > 0
      ? result.usage.output_tokens / (result.duration_api_ms / 1000) : undefined,
    tokensPerSecondBasis: number(result.duration_api_ms) > 0 ? 'turn_output_per_api_second' : undefined,
    numTurns: number(result.num_turns), modelUsage,
  });
}

/** Spawn the installed, unmodified Claude Code CLI. No model API or token-file access.
 *
 * The NDJSON control channel follows Anthropic's public Python SDK implementation:
 * github.com/anthropics/claude-agent-sdk-python/tree/main/src/claude_agent_sdk/_internal
 * CLI flags: code.claude.com/docs/en/{cli-reference,headless}
 * `default` in this application maps to the current CLI's `manual` mode.
 * The configured default is the official `bypassPermissions` mode. Questions
 * remain interactive because approving a tool is not an answer to a question.
 *
 * `message` is the finalized assistant text, not another delta; `thinking` likewise replaces
 * the streamed thinking. `thinking_start`/`thinking_stop` bracket each thinking block and
 * `thinking_progress` carries the CLI's running token estimate. `usage` with final:false
 * describes only the latest response/context; final:true is the accounting snapshot.
 * The caller owns workspace authorization/creation and persists snapshots per session.
 */
export function createClaudeRun({
  cwd, sessionId, model = 'sonnet', permissionMode = 'bypassPermissions', effort = 'auto', prompt,
  thinkingDisplay = 'summarized',
  onEvent = () => {}, onExit = () => {}, env = {}, configDir, binary = DEFAULT_CLAUDE_BINARY,
  timeoutMs = 0, initializationTimeoutMs = 60_000, killGraceMs = 3000,
  exitGraceMs = 5000, taskSettleMs = 2000, maxLineBytes = MAX_LINE_BYTES,
} = {}) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new TypeError('cwd must be an absolute workspace path');
  if (!isModel(model)) throw new TypeError('Unsupported model');
  if (!['default', 'plan', 'bypassPermissions'].includes(permissionMode)) throw new TypeError('Unsupported permission mode');
  if (!EFFORT_LEVELS.includes(effort)) throw new TypeError('Unsupported effort level');
  if (thinkingDisplay != null && !THINKING_DISPLAYS.includes(thinkingDisplay)) throw new TypeError('Unsupported thinking display');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('prompt must be a non-empty string');
  if (sessionId !== undefined && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) {
    throw new TypeError('sessionId must be a UUID');
  }
  if (typeof binary !== 'string' || !binary || (/[\\/]/.test(binary) && !isAbsolute(binary))) throw new TypeError('binary must be an absolute path or a bare command name resolved on PATH');
  // Long tasks and human input can legitimately remain quiet. A total execution
  // deadline is opt-in; zero disables it without disabling startup protection.
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_TIMER_MS) {
    throw new TypeError(`timeoutMs must be between 0 and ${MAX_TIMER_MS}`);
  }
  for (const [name, value] of Object.entries({ initializationTimeoutMs, killGraceMs, exitGraceMs, taskSettleMs })) {
    if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_MS) {
      throw new TypeError(`${name} must be positive and at most ${MAX_TIMER_MS}`);
    }
  }
  if (!Number.isFinite(maxLineBytes) || maxLineBytes <= 0) throw new TypeError('maxLineBytes must be positive');

  const childEnv = claudeEnvironment({env,configDir});
  // A result alone does not end a turn: a resumed session first reports an empty result for
  // work left over from the previous process, and a background task that finishes later wakes
  // the model again. The CLI's session state ('running', 'requires_action', 'idle') is the
  // authoritative turn-over signal.
  childEnv.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1';
  delete childEnv.CLAUDE_CODE_EFFORT_LEVEL;
  const args = ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--include-partial-messages', '--permission-prompt-tool', 'stdio',
    '--permission-mode', permissionMode === 'default' ? 'manual' : permissionMode, '--model', model];
  if (sessionId) args.push(`--resume=${sessionId}`);
  if (effort !== 'auto') args.push('--effort', effort);
  let thinkingArgs = thinkingDisplay && !thinkingDisplayUnsupported.has(binary) ? ['--thinking-display', thinkingDisplay] : [];
  const rootArgs = rootOperationsArgs(childEnv);

  let child;
  const initId = `init_${randomUUID()}`;
  const promptId = randomUUID();
  const pendingPermissions = new Map();
  const pendingControls = new Map();
  const tools = new Map();
  const toolInputs = new Map();
  const seenFrames = new Set();
  const errors = new Set();
  // Every background task (subagents, background Bash, Monitor) keeps the CLI alive: it
  // wakes the model again when the task reports back, so ending input early kills the task.
  const activeTasks = new Set();
  // The CLI sends one finalized assistant frame per content block, all with the same message id.
  const finalParts = new Map();
  // Guidance sent while the CLI works waits in its command queue: it reaches the model at the next
  // tool boundary, or as a follow-up turn right after the current reply. `command_lifecycle` frames
  // report when it is taken; until then the input stays open so the CLI can still read it.
  const steers = new Map();
  let lifecycleSeen = false, responded = false;
  // The account ran out of quota: an official rejection, then an error result. Nothing more can run on it,
  // so background tasks no longer hold the turn open (each one would only wake the model into the same limit).
  let limitRejected = false, limitReached = false;
  let decoder, stderrDecoder, stdoutSeen = false;
  let buffer = '', stderr = '', currentSessionId = sessionId, currentModel = model, emittedSessionId;
  let initialized = false, finished = false, stopped = false, timedOut = false, stopReason;
  let result, state, contextTokens, streamUsage, streamMessageId, streamBlocks = new Map(), capabilities, eofSent = false;
  let initTimer, runTimer, killTimer, exitTimer, settleTimer, closeScheduled = false, exitSignalled = false, endedIdle = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  function emit(event) {
    if (!finished) onEvent(safeValue(event));
  }

  function error(message) {
    const clean = redactText(message).slice(0, MAX_STDERR_CHARS);
    if (!errors.has(clean)) { errors.add(clean); emit({ type: 'error', message: clean }); }
  }

  function send(message) {
    if (finished || eofSent || child.stdin.destroyed || !child.stdin.writable) return false;
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  function signalGroup(signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (err) {
      if (err.code !== 'ESRCH') { try { child.kill(signal); } catch {} }
    }
  }

  function clearDeadlines() {
    clearTimeout(initTimer);
    clearTimeout(runTimer);
  }

  function stop(reason = 'user', timeoutMessage = 'Claude Code 执行超时，已中止本次任务。') {
    if (finished || stopped) return false;
    clearDeadlines();
    clearTimeout(exitTimer);
    clearTimeout(settleTimer);
    stopped = true;
    stopReason = reason;
    timedOut = reason === 'timeout';
    if (timedOut) error(timeoutMessage);
    for (const [id] of pendingPermissions) cancelPermission(id);
    for (const [id, tool] of tools) {
      if (['preparing', 'running', 'waiting_permission'].includes(tool.status)) {
        toolUpdate(id, { status: 'cancelled', durationMs: Date.now() - tool.startedAt });
      }
    }
    send({ type: 'control_request', request_id: `stop_${randomUUID()}`, request: { subtype: 'interrupt' } });
    signalGroup('SIGTERM');
    killTimer = setTimeout(() => signalGroup('SIGKILL'), killGraceMs);
    return true;
  }

  // The turn is over once a result has arrived, the CLI reports 'idle' (a CLI that never reports
  // state is taken to be idle after its result), and no approval or background task is open.
  function turnOver() {
    if (!result || finished || stopped || eofSent) return false;
    if (limitReached) return true;
    return !pendingPermissions.size && !activeTasks.size
      && ![...steers.values()].includes('queued') && (state === 'idle' || state === undefined);
  }

  // Ending input lets the CLI exit by itself. A background task that reports back while the CLI
  // is idle starts a follow-up turn a moment later, so that case first waits `taskSettleMs` for
  // the CLI to report 'running'; input stays open and that turn can still ask for approval.
  function endInputWhenIdle({ settle = false } = {}) {
    if (!turnOver()) return;
    if (settle) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => { settleTimer = undefined; endInputWhenIdle(); }, taskSettleMs);
      return;
    }
    if (closeScheduled || settleTimer) return;
    closeScheduled = true;
    setImmediate(() => {
      closeScheduled = false;
      if (!turnOver() || settleTimer) return;
      eofSent = true;
      clearDeadlines();
      child.stdin.end();
      armExit();
    });
  }

  function cancelEndInput() {
    clearTimeout(settleTimer);
    settleTimer = undefined;
  }

  // After its input ends the CLI still finishes its background tasks and any follow-up turn, then
  // exits by itself. Only a CLI that stays idle (or waits for an approval nobody can answer any
  // more) is ended, and the deadline restarts whenever it reports new activity.
  function armExit() {
    clearTimeout(exitTimer);
    if (!eofSent || finished || stopped || exitSignalled || (!limitReached && (state === 'running' || activeTasks.size))) return;
    exitTimer = setTimeout(() => {
      exitSignalled = true;
      endedIdle = state !== 'requires_action';
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => signalGroup('SIGKILL'), killGraceMs);
    }, exitGraceMs);
  }

  function toolUpdate(id, update) {
    if (typeof id !== 'string') return;
    const previous = tools.get(id) || { id, name: update.name || 'unknown', input: {}, startedAt: Date.now() };
    const next = { ...previous, ...compact(update) };
    // A denial/cancellation is the host's final decision for this tool ID.
    // Late CLI progress or its synthetic error result must not turn it back
    // into a running or generic failed operation. Keep any result text.
    if (['denied', 'cancelled'].includes(previous.status)) next.status = previous.status;
    // Durations measure execution, not the time the model spent writing the input.
    if (previous.status === 'preparing' && next.status !== 'preparing') { next.startedAt = Date.now(); delete next.inputBytes; }
    tools.set(id, next);
    emit(compact({ type: 'tool', id, name: next.name, input: next.input, status: next.status,
      output: next.output, durationMs: next.durationMs, inputBytes: next.inputBytes,
      startedAt: next.status === 'preparing' ? undefined : new Date(next.startedAt).toISOString() }));
  }

  // Input of a tool call streams as partial JSON; report its size and early fields, throttled.
  function toolInputProgress(index, chunk) {
    const pending = toolInputs.get(index), tool = pending && tools.get(pending.id);
    if (!tool || tool.status !== 'preparing' || typeof chunk !== 'string') return;
    pending.bytes += Buffer.byteLength(chunk);
    let input = tool.input;
    if (pending.head.length < PREVIEW_HEAD_CHARS) {
      pending.head += chunk.slice(0, PREVIEW_HEAD_CHARS - pending.head.length);
      const preview = previewToolInput(pending.head);
      if (!isDeepStrictEqual(preview, tool.input)) input = preview;
    }
    const now = Date.now();
    if (input === tool.input && now - pending.sentAt < PREVIEW_INTERVAL_MS) return;
    pending.sentAt = now;
    toolUpdate(pending.id, { input, inputBytes: pending.bytes });
  }

  function cancelPermission(id) {
    const request = pendingPermissions.get(id);
    if (!request) return false;
    pendingPermissions.delete(id);
    const tool = tools.get(request.tool_use_id);
    toolUpdate(request.tool_use_id, { name: request.tool_name, input: request.input,
      status: 'cancelled', durationMs: tool ? Date.now() - tool.startedAt : undefined });
    emit({ type: 'permission_cancelled', id, toolUseId: request.tool_use_id });
    return true;
  }

  function respondPermission(id, allow, updatedInput) {
    if (typeof allow !== 'boolean') throw new TypeError('allow must be a boolean');
    const request = pendingPermissions.get(id);
    if (!request || finished || stopped) return false;
    let input = request.input;
    if (allow && updatedInput !== undefined) {
      if (request.tool_name !== 'AskUserQuestion') throw new TypeError('Only AskUserQuestion accepts updated answers');
      input = questionInput(request.input, updatedInput);
    }
    const response = allow ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: '用户拒绝了本次工具操作。' };
    if (!send({ type: 'control_response', response: { subtype: 'success', request_id: id, response } })) return false;
    pendingPermissions.delete(id);
    toolUpdate(request.tool_use_id, { name: request.tool_name, input,
      status: allow ? 'running' : 'denied' });
    return true;
  }

  function stopTask(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new TypeError('Invalid task id');
    if (!initialized || finished || stopped || eofSent) return false;
    const requestId = `task_stop_${randomUUID()}`;
    pendingControls.set(requestId, { subtype: 'stop_task', taskId: id });
    if (!send({ type: 'control_request', request_id: requestId, request: { subtype: 'stop_task', task_id: id } })) {
      pendingControls.delete(requestId);
      return false;
    }
    return true;
  }

  // A CLI that reports no command lifecycle for the prompt cannot say whether guidance arrived.
  function steer(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 30_000) throw new TypeError('Guidance must be 1-30000 characters');
    if (finished || stopped || eofSent) return { ok: false, reason: 'ending' };
    if (!initialized || !lifecycleSeen) return { ok: false, reason: initialized && responded ? 'unsupported' : 'starting' };
    const id = randomUUID();
    if (!send({ type: 'user', uuid: id, session_id: currentSessionId || '', parent_tool_use_id: null,
      message: { role: 'user', content: text } })) return { ok: false, reason: 'ending' };
    steers.set(id, 'queued');
    cancelEndInput();
    clearTimeout(exitTimer);
    return { ok: true, id };
  }

  function steerUpdate(id, next) {
    if (!steers.has(id) || steers.get(id) === next) return;
    steers.set(id, next);
    emit({ type: 'steer', id, state: next });
  }

  function contextUsage(usage, modelName) {
    const count = lastContext(usage);
    if (count === undefined) return;
    contextTokens = count;
    emit(compact({ type: 'usage', scope: 'response', cumulative: true, final: false,
      source: 'assistant_usage', model: modelName || currentModel, contextTokens,
      contextSource: 'last_response', inputTokens: number(usage.input_tokens),
      outputTokens: number(usage.output_tokens), cacheReadTokens: number(usage.cache_read_input_tokens),
      cacheWriteTokens: number(usage.cache_creation_input_tokens) }));
  }

  function frame(message) {
    if (!message || typeof message !== 'object' || finished || stopped) return;
    if (message.uuid) {
      const key = `${message.type}:${message.uuid}`;
      if (seenFrames.has(key)) return;
      seenFrames.add(key);
    }
    if (typeof message.session_id === 'string' && message.session_id && message.session_id !== emittedSessionId) {
      currentSessionId = message.session_id;
      emittedSessionId = currentSessionId;
      emit({ type: 'session', sessionId: currentSessionId });
    }
    if (message.type === 'control_response') {
      const pending = pendingControls.get(message.response?.request_id);
      if (pending) {
        pendingControls.delete(message.response.request_id);
        if (message.response.subtype === 'error') error(message.response.error || 'Claude Code 未能停止该后台任务。');
        return;
      }
      if (message.response?.request_id !== initId || initialized) return;
      clearTimeout(initTimer);
      if (message.response.subtype === 'error') { error(message.response.error || 'Claude Code 初始化失败'); stop('error'); return; }
      initialized = true;
      capabilities = normalizeCapabilities(message.response.response);
      emit(capabilities);
      send({ type: 'user', uuid: promptId, session_id: currentSessionId || '',
        parent_tool_use_id: null, message: { role: 'user', content: prompt } });
      return;
    }
    if (message.type === 'control_request') {
      const request = message.request || {}, id = message.request_id;
      if (typeof id !== 'string') return;
      if (request.subtype !== 'can_use_tool' || typeof request.tool_name !== 'string'
        || !request.input || typeof request.input !== 'object' || Array.isArray(request.input)) {
        send({ type: 'control_response', response: { subtype: 'error', request_id: id,
          error: 'This host does not implement the requested control operation.' } });
        return;
      }
      if (pendingPermissions.has(id)) return;
      // Store the exact original input privately; the UI receives a redacted copy.
      pendingPermissions.set(id, request);
      // Some interactive tools still ask the host in bypass mode. Follow the
      // selected policy without substituting redacted UI input into the request.
      // AskUserQuestion is an input form and must receive the user's answers.
      if (permissionMode === 'bypassPermissions' && request.tool_name !== 'AskUserQuestion'
        && respondPermission(id, true)) {
        emit(compact({ type: 'approval', id, toolName: request.tool_name,
          toolUseId: request.tool_use_id, allow: true, automatic: true }));
        return;
      }
      toolUpdate(request.tool_use_id, { name: request.tool_name, input: request.input, status: 'waiting_permission' });
      emit(compact({ type: 'permission', id, toolName: request.tool_name, input: request.input,
        toolUseId: request.tool_use_id, description: request.description }));
      return;
    }
    if (message.type === 'control_cancel_request') {
      cancelPermission(message.request_id);
      endInputWhenIdle();
      return;
    }
    if (message.type === 'command_lifecycle') {
      lifecycleSeen = true;
      if (['started', 'completed'].includes(message.state)) {
        steerUpdate(message.command_uuid, 'delivered');
        endInputWhenIdle();
      }
      return;
    }
    if (['stream_event', 'assistant', 'result'].includes(message.type)) responded = true;
    if (message.type === 'system') {
      if (message.subtype === 'init' && typeof message.model === 'string') currentModel = message.model;
      if (message.subtype === 'init' && typeof message.claude_code_version === 'string') {
        capabilities = { ...(capabilities || normalizeCapabilities()), version: message.claude_code_version };
        emit(capabilities);
      }
      if (message.subtype === 'commands_changed' && Array.isArray(message.commands)) {
        capabilities = { ...(capabilities || normalizeCapabilities()), commands: normalizeCapabilities({ commands: message.commands }).commands };
        emit(capabilities);
      }
      if (message.subtype === 'thinking_tokens' && !message.parent_tool_use_id) emit(compact({ type: 'thinking_progress', estimated: true,
        estimatedTokens: number(message.estimated_tokens), estimatedTokensDelta: number(message.estimated_tokens_delta),
        messageId: streamMessageId }));
      if (message.subtype === 'session_state_changed') {
        state = message.state;
        if (state !== 'idle') cancelEndInput();
        endInputWhenIdle();
        armExit();
      }
      if (message.subtype === 'task_started' && typeof message.task_id === 'string') {
        activeTasks.add(message.task_id);
        cancelEndInput();
        armExit();
      }
      if (message.subtype === 'task_notification'
        || (message.subtype === 'task_updated' && FINISHED_TASK_STATUSES.includes(message.patch?.status))) {
        endInputWhenIdle({ settle: activeTasks.delete(message.task_id) });
        armExit();
      }
      if (['task_started', 'task_progress', 'task_notification', 'task_updated'].includes(message.subtype)) {
        const patch = message.subtype === 'task_updated' ? message.patch || {} : message;
        emit(compact({ type: 'task', id: message.task_id, runId: message.run_id,
          toolUseId: message.tool_use_id, kind: message.task_type,
          description: patch.description, summary: patch.summary, parentTaskId: message.parent_task_id,
          status: patch.status || (message.subtype === 'task_started' ? 'running' : undefined),
          usage: patch.usage ? allowedFields(patch.usage, ['total_tokens', 'tool_uses', 'duration_ms']) : undefined }));
      }
      if (message.subtype === 'permission_denied') {
        toolUpdate(message.tool_use_id, { name: message.tool_name, input: message.input, status: 'denied' });
      }
      return;
    }
    if (message.type === 'stream_event' && !message.parent_tool_use_id) {
      const event = message.event || {};
      if (event.type === 'message_start') {
        streamMessageId = event.message?.id;
        streamBlocks = new Map();
        toolInputs.clear();
        streamUsage = { ...(event.message?.usage || {}) };
        if (event.message?.model) currentModel = event.message.model;
        contextUsage(streamUsage);
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        emit(compact({ type: 'text_delta', text: event.delta.text || '', messageId: streamMessageId }));
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
        emit(compact({ type: 'thinking_delta', text: event.delta.thinking || '', messageId: streamMessageId }));
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
        toolInputProgress(event.index, event.delta.partial_json);
      } else if (event.type === 'content_block_start') {
        // Block boundaries time the thinking phase; redacted blocks have no readable text.
        const block = event.content_block || {}, type = block.type;
        streamBlocks.set(event.index, type);
        if (type === 'thinking' || type === 'redacted_thinking') emit(compact({ type: 'thinking_start', messageId: streamMessageId }));
        if (type === 'redacted_thinking') emit(compact({ type: 'thinking', text: '', redacted: true, id: streamMessageId }));
        // A tool call is shown as soon as it starts; long inputs (file writes) take a while to generate.
        if (type === 'tool_use' && typeof block.id === 'string') {
          toolInputs.set(event.index, { id: block.id, head: '', bytes: 0, sentAt: 0 });
          if (!tools.has(block.id)) toolUpdate(block.id, { name: block.name, input: {}, status: 'preparing' });
        }
      } else if (event.type === 'content_block_stop') {
        toolInputs.delete(event.index);
        if (['thinking', 'redacted_thinking'].includes(streamBlocks.get(event.index))) {
          emit(compact({ type: 'thinking_stop', messageId: streamMessageId }));
        }
      } else if (event.type === 'message_delta' && event.usage) {
        streamUsage = { ...streamUsage, ...event.usage };
        contextUsage(streamUsage);
      }
      return;
    }
    if (message.type === 'assistant') {
      const assistant = message.message || {}, text = textContent(assistant.content);
      if (!message.parent_tool_use_id) {
        const id = assistant.id || message.uuid;
        const parts = finalParts.get(id) || { text: '', thinking: '' };
        finalParts.set(id, parts);
        // Frames usually carry one block each; a frame that repeats earlier blocks replaces them.
        const merge = (previous, next, separator) => !previous || next.startsWith(previous) ? next : previous + separator + next;
        if (assistant.model) currentModel = assistant.model;
        if (text) {
          parts.text = merge(parts.text, text, '');
          emit(compact({ type: 'message', role: 'assistant', text: parts.text, id, model: assistant.model || currentModel }));
        }
        contextUsage(assistant.usage, assistant.model);
        const thinking = (Array.isArray(assistant.content) ? assistant.content : []).filter(block => block.type === 'thinking')
          .map(block => block.thinking || '').filter(Boolean).join('\n\n');
        if (thinking) {
          parts.thinking = merge(parts.thinking, thinking, '\n\n');
          emit(compact({ type: 'thinking', text: parts.thinking, id }));
        }
        if (assistant.content?.some?.(block => block.type === 'redacted_thinking')) {
          emit(compact({ type: 'thinking', text: '', redacted: true, id }));
        }
      }
      if (message.usage_report) emit({ type: 'quota', ...normalizeUsageReport(message.usage_report) });
      for (const block of Array.isArray(assistant.content) ? assistant.content : []) {
        if (block.type === 'tool_use') toolUpdate(block.id, { name: block.name, input: block.input, status: 'running' });
      }
      if (message.error === 'rate_limit') limitRejected = true;
      if (message.error) error(`Claude Code: ${message.error}${text ? ` — ${text}` : ''}`);
      return;
    }
    if (message.type === 'rate_limit_event') {
      const event = normalizeRateLimit(message.rate_limit_info);
      if (event?.rateLimited) limitRejected = true;
      if (event) emit(event);
      return;
    }
    if (message.type === 'user') {
      for (const block of Array.isArray(message.message?.content) ? message.message.content : []) {
        if (block.type !== 'tool_result') continue;
        const previous = tools.get(block.tool_use_id);
        toolUpdate(block.tool_use_id, { status: block.is_error ? 'error' : 'completed',
          output: textContent(block.content), durationMs: previous ? Date.now() - previous.startedAt : undefined });
      }
      return;
    }
    if (message.type === 'tool_progress') {
      toolUpdate(message.tool_use_id, { name: message.tool_name, status: 'running',
        durationMs: number(message.elapsed_time_seconds) === undefined ? undefined : message.elapsed_time_seconds * 1000 });
      return;
    }
    if (message.type === 'result') {
      result = message;
      emit(normalizeResultUsage(message, { model: currentModel, contextTokens }));
      if (message.is_error || message.subtype?.startsWith('error')) {
        error((message.errors || []).join('\n') || message.result || `Claude Code: ${message.subtype}`);
        if (limitRejected) { limitReached = true; cancelEndInput(); }
      }
      endInputWhenIdle();
    }
  }

  function consume(chunk, end = false) {
    buffer += end ? decoder.end() : decoder.write(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line) > maxLineBytes) { error('Claude Code 输出行超过大小限制。'); stop('error'); return; }
      let parsed;
      try { parsed = JSON.parse(line); } catch { error('Claude Code 返回了无效的流式 JSON。'); stop('error'); return; }
      frame(parsed);
    }
    if (Buffer.byteLength(buffer) > maxLineBytes) { error('Claude Code 输出行超过大小限制。'); stop('error'); return; }
    if (end && buffer.trim()) {
      try { frame(JSON.parse(buffer)); } catch { error('Claude Code 的流式输出不完整。'); }
      buffer = '';
    }
  }

  // Every listener ignores a superseded child, so a retried launch never sees stale output.
  function launch() {
    const proc = spawn(binary, [...args, ...thinkingArgs, ...rootArgs], { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    child = proc;
    decoder = new StringDecoder('utf8');
    stderrDecoder = new StringDecoder('utf8');
    buffer = ''; stderr = ''; stdoutSeen = false;
    proc.stdout.on('data', (chunk) => { if (proc !== child) return; stdoutSeen = true; consume(chunk); });
    proc.stderr.on('data', (chunk) => { if (proc === child) stderr = (stderr + stderrDecoder.write(chunk)).slice(-MAX_STDERR_CHARS); });
    proc.stdin.on('error', (err) => {
      if (proc === child && !stopped && !result && err.code !== 'EPIPE') error(`Claude Code 输入通道错误: ${err.message}`);
    });
    proc.on('error', (err) => { if (proc === child) error(`无法启动 Claude Code: ${err.message}`); });
    proc.on('spawn', () => {
      if (proc !== child) return;
      if (stopped) { signalGroup('SIGTERM'); return; }
      send({ type: 'control_request', request_id: initId, request: { subtype: 'initialize', hooks: null } });
    });
    proc.on('close', (code, signal) => { if (proc === child) closed(code, signal); });
  }

  function closed(code, signal) {
    if (finished) return;
    consume(null, true);
    stderr = redactText((stderr + stderrDecoder.end()).slice(-MAX_STDERR_CHARS));
    // A CLI without the hidden display flag fails while parsing options, before any output.
    if (thinkingArgs.length && !stopped && !initialized && !stdoutSeen && code !== 0 && /thinking-display/.test(stderr)) {
      thinkingDisplayUnsupported.add(binary);
      thinkingArgs = [];
      launch();
      return;
    }
    if (stopped) signalGroup('SIGKILL');
    for (const timer of [initTimer, runTimer, killTimer, exitTimer, settleTimer]) clearTimeout(timer);
    // A CLI that stays idle after a successful result and the end of input is ended by the host; not a failure.
    const endedAfterResult = endedIdle && Boolean(result) && !result.is_error && !result.subtype?.startsWith('error');
    if (!stopped && !errors.size && (code !== 0 || !result) && !endedAfterResult) {
      error(stderr || (exitSignalled && !endedIdle ? 'Claude Code 在输入结束后仍在等待确认，已结束进程。'
        : code === 0 ? 'Claude Code 在返回结果前退出。' : `Claude Code 退出 (${signal || code})。`));
    }
    for (const [id] of pendingPermissions) cancelPermission(id);
    for (const [id, tool] of tools) {
      if (['preparing', 'running', 'waiting_permission'].includes(tool.status)) toolUpdate(id, { status: 'cancelled' });
    }
    for (const [id, value] of steers) if (value === 'queued') steerUpdate(id, 'dropped');
    emit(compact({ type: 'done', result: result?.result, stopped, timedOut, isError: errors.size > 0 }));
    finished = true;
    const exit = compact({ code, signal, stopped, timedOut, stopReason, endedAfterResult: endedAfterResult || undefined,
      limitReached: (limitReached && !stopped) || undefined, result: safeValue(result), stderr });
    resolveDone(exit);
    onExit(exit);
  }

  launch();
  initTimer = setTimeout(() => stop('timeout', 'Claude Code 初始化超时，未启动本次任务。'), initializationTimeoutMs);
  if (timeoutMs > 0) runTimer = setTimeout(() => stop('timeout'), timeoutMs);
  return { stop, stopTask, respondPermission, steer, done, get pid() { return child.pid; },
    get sessionId() { return currentSessionId; }, get pendingPermissionIds() { return [...pendingPermissions.keys()]; } };
}
