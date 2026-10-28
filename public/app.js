import { createThemeController, cssToHex, xtermTheme, monacoTheme } from './themes.js';
import { createPluginHost } from './plugin-host.js';
import { createWorkshop } from './workshop.js';
import { createUsageState } from './usage-state.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const icons = {
  puzzle: '<path d="M5.4 7.6h3.7a2.3 2.3 0 1 1 4.6 0h2.7v3.7a2.3 2.3 0 1 1 0 4.6v2.7h-11Z"/>', palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.9-.8 1.9-1.8 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.4 0-1 .8-1.8 1.8-1.8H17a3.5 3.5 0 0 0 3.5-3.5c0-3.9-3.8-7.1-8.5-7.1Z"/><circle cx="7.7" cy="11.6" r="1.1"/><circle cx="10.4" cy="7.7" r="1.1"/><circle cx="15" cy="8.1" r="1.1"/>',
  store: '<path d="M4 9.5 5.5 4h13L20 9.5a2.7 2.7 0 0 1-5.3.6 2.7 2.7 0 0 1-5.4 0A2.7 2.7 0 0 1 4 9.5Z"/><path d="M5.5 12.4V20h13v-7.6M10 20v-4.5h4V20"/>', grip: '<circle cx="9" cy="6" r=".9"/><circle cx="15" cy="6" r=".9"/><circle cx="9" cy="12" r=".9"/><circle cx="15" cy="12" r=".9"/><circle cx="9" cy="18" r=".9"/><circle cx="15" cy="18" r=".9"/>',
  command: '<path d="M9 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V7Z"/>', panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>', brain: '<path d="M12 4a3 3 0 0 0-5-1 3 3 0 0 0-3 5 4 4 0 0 0 0 7 3 3 0 0 0 3 5 3 3 0 0 0 5-1V4Zm0 0a3 3 0 0 1 5-1 3 3 0 0 1 3 5 4 4 0 0 1 0 7 3 3 0 0 1-3 5 3 3 0 0 1-5-1M7 7l3 2M17 7l-3 2M7 16l3-2M17 16l-3-2"/>', paperclip: '<path d="m21 11-8 8a6 6 0 0 1-8-8l9-9a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>', save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8"/>', branch: '<circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 6v12M18 8c0 5-12 2-12 8"/>', 'file-plus': '<path d="M14 2H6a2 2 0 0 0-2 2v16h16V8l-6-6Zm0 0v6h6M8 14h8M12 10v8"/>', 'folder-plus': '<path d="M3 7V5h7l2 2h9v13H3V7ZM12 10v7M8.5 13.5h7"/>', code: '<path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18"/>', at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v6a2 2 0 0 0 4 0v-2a8 8 0 1 0-4 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="m16 16 4.2 4.2"/>',
  message: '<path d="M21 11.5a8.6 8.6 0 0 1-.9 3.8 8.8 8.8 0 0 1-7.9 4.9 8.6 8.6 0 0 1-3.8-.9L3 21l1.7-5.4a8.6 8.6 0 0 1-.9-3.8 8.8 8.8 0 0 1 4.9-7.9 8.6 8.6 0 0 1 3.8-.9h.5a8.8 8.8 0 0 1 8 8z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M16 6.5h1M16 17.5h1"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  sparkles: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3ZM20 3v4M18 5h4"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>', 'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'arrow-up': '<path d="M12 20V4m-6 6 6-6 6 6"/>', 'arrow-down': '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
  terminal: '<path d="m4 6 6 6-6 6M13 18h7"/>', logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 19.4 9L20 12M4 12l.6 3A8 8 0 0 0 17.9 17.9"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M10 12h4"/>', restore: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l3 2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A12 12 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3.1 3.9M6.2 6.2A20 20 0 0 0 2 12s4 7 10 7c1.8 0 3.5-.6 5-1.5"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="2"/>', layers: '<path d="m12 3 10 6-10 6L2 9l10-6Zm-10 12 10 6 10-6M2 12l10 6 10-6"/>',
  files: '<path d="M14 3H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M2 8v12a2 2 0 0 0 2 2h10"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h5"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  coins: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  tool: '<path d="M14.7 6.3a5.5 5.5 0 0 0-7 7L3 18a2.1 2.1 0 0 0 3 3l4.7-4.7a5.5 5.5 0 0 0 7-7L14 13l-3-3 3.7-3.7Z"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  memory: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 18v3M12 18v3M17 18v3M7 10v4M12 10v4M17 10v4"/>',
  disk: '<path d="m5 4-3 9v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5l-3-9H5ZM2 13h20M6 17h.01M10 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>', 'wifi-off': '<path d="m2 2 20 20M8.5 16.5a5 5 0 0 1 7 0M12 20h.01M5 13a10 10 0 0 1 5-2.8M16.8 12a10 10 0 0 1 2.2 1M2 9a16 16 0 0 1 4.2-2.5M10.5 5.1A16 16 0 0 1 22 9"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', 'list-check': '<path d="M11 6h9M11 12h9M11 18h9M3.5 6l1.5 1.5L8 4.5M3.5 12l1.5 1.5L8 10.5M3.5 18l1.5 1.5L8 16.5"/>', list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>', steps: '<path d="M6 8.5v7"/><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M12 6h8M12 18h8M12 12h5"/>',
  plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5"/>', bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/>', alert: '<path d="M12 3 2 20h20L12 3ZM12 10v4M12 17h.01"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', 'message-plus': '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z"/><path d="M12 8.5v7M8.5 12h7"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>', ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>', reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/>', steer: '<path d="M3 11 22 2l-9 19-2-8z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const assistantMark = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.9 5.1 3.9 8.1 9 9-5.1.9-8.1 3.9-9 9-.9-5.1-3.9-8.1-9-9 5.1-.9 8.1-3.9 9-9Z"/><path d="M19.5 2v4M17.5 4h4"/></svg>';
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });

const storage = { get(key) { try { return localStorage.getItem(key); } catch { return null; } }, set(key, value) { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch {} } };
const state = { csrf: '', sessions: [], session: null, activeId: null, system: null, account: null, execution: null, config: {}, archived: false, view: 'chat', source: null, connected: false, authenticated: false, busy: false, renameId: null, sessionRequest: 0, selectionVersion: 0, refreshPending: false, refreshTimer: null, lastBootstrap: 0, syncNeeded: false, draftLoaded: false, pendingSend: null, pendingSteer: null, steering: false };
const ide = { usage: null, workspaceOpen: false, directory: '', explorer: 'files', entries: [], documents: new Map(), activeDocument: null, editor: null, monacoLoading: null, syncingEditor: false, preview: false, fileRequest: 0, attachments: new Map(), pathAction: null, terminal: null, terminalSource: null, xterm: null, fit: null, terminalKind: 'shell', inputBuffer: '', inputTimer: null, inputPending: false, terminalStarting: false, commandIndex: 0, commands: [], slashIndex: 0 };
// View state that survives live re-renders: keyed transcript rows, streaming reveal and scroll-follow state,
// expanded activities/steps, loaded full tool records, sync timers.
const ui = { renderedFor: null, items: new Map(), pending: new Set(), reveal: new Map(), fresh: new Set(), patchLog: [], entryGroups: new Map(), stuck: true, pointerDown: false, touching: false, autoScrollTop: null, lastScrollTop: 0, skew: 0, lastProgressAt: 0, raf: 0, lastFrameAt: 0, renderPending: false, resyncTimer: null, monitorTimer: null, openGroups: new Set(), openSteps: new Set(), openThinking: new Set(), closedThinking: new Set(), fullTools: new Map(), loadingTools: new Set(), unseen: false, activeDocBySession: new Map(), usageKey: '', usageCollapsed: storage.get('cloud-ops-workbench-usage-collapsed') === '1', notify: storage.get('cloud-ops-workbench-notify') === '1', attention: null, favicon: '', syncTimer: null, syncPaths: null, syncAll: false, todoOpen: false, noticesHTML: '', effortHTML: '', sessionsHTML: '' };
// Steps live in the activity panel by default; the transcript keeps one summary row per stretch of work.
Object.assign(ui, { stepsInline: storage.get('cloud-ops-workbench-steps') === 'inline', activityPref: storage.get('cloud-ops-workbench-activity'), activityOpen: false, activitySuspended: false, activityTab: 'steps', activityFor: null, activityItems: new Map(), activityStuck: true, activityTimer: 0, openTurns: new Set(), closedTurns: new Set(), openFiles: new Set(), panelThinking: new Set() });
const nf = new Intl.NumberFormat('zh-CN');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const formatNumber = value => finite(value) ? nf.format(value) : '未提供';
const compact = value => !finite(value) ? '未提供' : Math.abs(value) >= 1e6 ? `${(value / 1e6).toFixed(value >= 1e7 ? 1 : 2)}M` : Math.abs(value) >= 1e3 ? `${(value / 1e3).toFixed(value >= 1e5 ? 0 : 1)}k` : String(Math.round(value));
const bytes = value => !finite(value) ? '未提供' : value >= 2 ** 30 ? `${(value / 2 ** 30).toFixed(1)} GB` : value >= 2 ** 20 ? `${(value / 2 ** 20).toFixed(1)} MB` : value >= 1024 ? `${Math.round(value / 1024)} KB` : `${value} B`;
const duration = ms => { if (!finite(ms)) return '未提供'; const s = Math.max(0, Math.floor(ms / 1000)); if (s < 60) return `${s} 秒`; if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`; return `${Math.floor(s / 3600)} 小时 ${Math.floor(s % 3600 / 60)} 分`; };
const shortDuration = ms => !finite(ms) ? '' : ms < 1000 ? `${Math.max(0.1, ms / 1000).toFixed(1)}s` : ms < 60000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` : `${Math.floor(ms / 60000)}m${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}s`;
const dateValue = value => { const n = new Date(value).getTime(); return Number.isFinite(n) ? n : 0; };
const time = value => dateValue(value) ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) : '';
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonText = value => { if (typeof value === 'string') return value; try { return JSON.stringify(value, null, 2) ?? ''; } catch { return String(value); } };
const oneLine = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
// One-line preview of a markdown reply: headings, list marks, emphasis, code fences and link targets removed.
const plainLine = value => oneLine(String(value ?? '').replace(/```[^\n]*\n?/g, ' ').replace(/^\s{0,3}(?:#{1,6}|[-*+>]|\d+[.)])\s+/gm, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|`)/g, '').replace(/^\s*\|?[-:| ]+\|?\s*$/gm, ' '));
const running = session => ['running', 'awaiting_approval', 'stopping'].includes(session?.status);
// Guidance sent during a turn belongs to that turn; only the user's own prompt starts one.
const turnStart = m => m.role === 'user' && !m.steer;
const activeDraftKey = () => `cloud-ops-workbench-draft:${state.activeId || 'new'}`;
const isDirectory = entry => ['directory', 'dir'].includes(entry?.type);
const shanghaiDay = value => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)).split('-').map(Number); return Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000; };
function relativeTime(value) {
  const t = dateValue(value); if (!t) return '';
  const diff = Date.now() - t; if (diff < 60000) return '刚刚'; if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  const days = shanghaiDay(Date.now()) - shanghaiDay(t);
  if (days <= 0) return time(value); if (days === 1) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).format(new Date(t));
}
function dayBucket(value) { const t = dateValue(value); if (!t) return '更早'; const days = shanghaiDay(Date.now()) - shanghaiDay(t); return days <= 0 ? '今天' : days === 1 ? '昨天' : days < 7 ? '近 7 天' : '更早'; }

function toast(message, error = false, action = null) {
  const el = document.createElement('div'); el.className = `toast${error ? ' error' : ''}`;
  const mark = document.createElement('span'); mark.className = 'toast-icon'; mark.innerHTML = icon(error ? 'alert' : 'check');
  const text = document.createElement('span'); text.textContent = message; el.append(mark, text);
  if (action) { const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label; button.addEventListener('click', () => { el.remove(); action.run(); }); el.append(button); el.classList.add('has-action'); }
  $('#toast-region').append(el); setTimeout(() => el.remove(), action ? 9000 : error ? 6500 : 3500);
}
class ApiError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
async function api(path, options = {}) {
  const mutation = options.method && options.method !== 'GET';
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...(mutation ? { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf } : {}), ...options.headers }, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
  let data; try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    if (response.status === 401 && state.authenticated && path !== '/api/login') showLogin('登录已过期，请重新输入工作台口令。');
    throw new ApiError(data.error || `请求未完成（${response.status}）`, response.status, data.code);
  }
  if (data.csrfToken) state.csrf = data.csrfToken;
  return data;
}
function showLogin(error = '') {
  preserveDraft(); state.activeId = null; state.session = null; state.sessions = []; state.selectionVersion++; ui.renderedFor = null; resetLive(); state.draftLoaded = false;
  $('#message-input').value = ''; $('#session-search').value = ''; $('#messages').replaceChildren(); $('#session-list').replaceChildren();
  state.authenticated = false; state.source?.close(); state.source = null; state.connected = false;
  usageContextKey = null; quotaState.select(null);
  ide.terminalSource?.close(); ide.terminalSource = null; ide.xterm?.dispose(); ide.xterm = null; ide.fit = null; ide.terminal = null;
  clearTimeout(state.refreshTimer); state.refreshTimer = null; ui.attention = null; document.title = '浮生氪劳德工作台'; setFavicon(null);
  plugins.unload(); workshop.close(); switchView('chat');
  $('#boot').hidden = true; $('#app').hidden = true; $('#login-view').hidden = false;
  $('#login-error').textContent = error; $('#login-error').hidden = !error;
  $('#login-password').value = ''; $('#login-totp').value = '';
  setTimeout(() => $('#login-password').focus(), 80);
}
async function showApp(auth) {
  state.authenticated = true; if (auth?.csrfToken) state.csrf = auth.csrfToken;
  await refreshBootstrap();
  plugins.load().then(renderSafeBanner, error => toast(`插件暂时没有加载：${error.message}`, true));
  $('#boot').hidden = true; $('#login-view').hidden = true; $('#app').hidden = false;
  $('#login-password').value = ''; $('#login-totp').value = '';
  ui.activityOpen = ui.activityPref === 'open' || (ui.activityPref == null && innerWidth >= 1280); layoutActivity();
  const storedId = storage.get('cloud-ops-workbench-active');
  const initial = state.sessions.find(s => s.id === storedId && !s.archived) || state.sessions.find(s => !s.archived);
  if (initial) await selectSession(initial.id); else newSessionView();
  connectEvents();
  refreshTerminals().catch(error => toast(`终端状态暂未同步：${error.message}`, true));
}
// The page keeps the version it loaded with; after a deploy the server reports a newer one until the page reloads.
function renderVersion() {
  const { version, release } = state.config; if (!version) return;
  if (!ui.pageVersion) ui.pageVersion = version;
  const label = $('#app-version'); label.textContent = `v${ui.pageVersion}`;
  label.title = version === ui.pageVersion ? `版本 ${version}${release ? ` · 发布 ${release}` : ''}` : `页面版本 ${ui.pageVersion}，服务器已更新到 ${version}，刷新页面即可使用`;
}
async function refreshBootstrap() {
  const data = await api('/api/bootstrap');
  if (!state.authenticated) return;
  state.sessions = Array.isArray(data.sessions) ? data.sessions : []; state.system = data.system ?? state.system;
  state.account = data.account ?? state.account; state.execution = data.execution ?? null; state.config = data.config || state.config; state.lastBootstrap = Date.now(); renderVersion();
  if (data.usage) quotaState.acceptDefault(data.usage);
  if (state.activeId || plugins.usageChoices(state.activeId)) void quotaState.refresh().catch(() => {});
  configureEffort(); renderUsage();
  renderSessions(); renderServer(); renderTitleMeta(); updateControls();
  return data;
}
function setConnected(value) {
  state.connected = value;
  $('#connection-label').textContent = value ? '云端已连接' : '重新连接中';
  $('#connection-badge').classList.toggle('offline', !value);
  $('#connection-badge .status-dot').classList.toggle('offline', !value);
  $('#host-dot').classList.toggle('offline', !value);
  $('#connection-banner').hidden = value;
  $('#sidebar-host-status').textContent = value ? '云端连接正常' : '连接中，云端任务仍会继续';
  $('#monitor-live').style.opacity = value ? '1' : '.3';
}
function connectEvents() {
  state.source?.close();
  if (!state.authenticated) return;
  // patches=1: this page applies session-patch frames; pages without it get session-updated refetch hints.
  const source = new EventSource('/api/events?patches=1'); state.source = source;
  source.onopen = async () => {
    if (source !== state.source) return;
    setConnected(true);
    try { await refreshBootstrap(); if (state.activeId) await refreshSession(); } catch (error) { if (error.status !== 401) toast('连接已恢复，状态同步暂未完成。', true); }
  };
  source.onerror = () => { if (source === state.source && state.authenticated) setConnected(false); };
  source.onmessage = event => {
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'session-patch') { onPatch(data); return; }
    if (data.type === 'runtime-updated') { refreshBootstrap().catch(() => {}); plugins.runtimeChanged(); }
    if (data.type === 'system') { state.system = data.system; renderServer(); plugins.system(); }
    if (data.type === 'usage') { if (state.activeId || plugins.usageChoices(state.activeId)) void quotaState.refresh().catch(() => {}); else quotaState.acceptDefault(data.usage); }
    if (data.type === 'usage-invalidated') void quotaState.refresh().catch(() => {});
    if (data.type === 'models' && Array.isArray(data.models)) { state.config.models = data.models; configureEffort(); }
    if (data.type === 'terminal-updated' || data.type === 'terminal' || data.type === 'terminals') refreshTerminals().catch(() => {});
    if (data.type === 'session-updated') { if (data.summary) applySummary(data.summary); scheduleSnapshot(data.sessionId, Boolean(data.summary)); }
  };
}
// List summaries arrive with every update, so status badges and cross-session notices stay live without refetching.
function applySummary(summary) {
  if (!summary?.id || !state.authenticated) return;
  const index = state.sessions.findIndex(s => s.id === summary.id); const previous = index >= 0 ? state.sessions[index] : null;
  if (index < 0) state.sessions.unshift(summary); else state.sessions[index] = { ...state.sessions[index], ...summary };
  noteTransition(summary.id, previous?.status, summary.status, summary.title); noteActivity(summary.id, previous?.status, summary.status); plugins.session(summary);
  renderSessions(); updateControls();
}
function scheduleSnapshot(id, summarized = false) {
  if (!state.authenticated) return;
  if (id === state.activeId) state.syncNeeded = true;
  else if (summarized && Date.now() - state.lastBootstrap < 60000) return;
  if (state.refreshTimer || state.refreshPending) return;
  state.refreshTimer = setTimeout(async () => {
    state.refreshTimer = null; state.refreshPending = true;
    const sync = state.syncNeeded; state.syncNeeded = false;
    try {
      if (sync && state.activeId) await refreshSession();
      if (!summarized && (Date.now() - state.lastBootstrap > 2500 || !running(state.session))) await refreshBootstrap();
      else if (Date.now() - state.lastBootstrap > 60000) await refreshBootstrap();
    } catch (error) { if (error.status !== 401) console.warn('Snapshot unavailable:', error.message); }
    finally { state.refreshPending = false; if (state.syncNeeded) scheduleSnapshot(state.activeId, summarized); }
  }, 140);
}
async function refreshSession() {
  const id = state.activeId; if (!id) return;
  const selection = state.selectionVersion; const request = ++state.sessionRequest;
  const session = await api(`/api/sessions/${encodeURIComponent(id)}?view=live`);
  if (id !== state.activeId || selection !== state.selectionVersion || request !== state.sessionRequest) return;
  acceptSession(session);
}
function acceptSession(session) {
  const previous = state.session?.id === session.id ? state.session : null;
  if (session.live) { replayPatches(session); noteServerTime(session.live.now); }
  if (!previous) ui.lastProgressAt = performance.now();
  state.session = session; syncAccountSelection();
  if (previous && previous.status !== session.status) void quotaState.refresh().catch(() => {});
  const index = state.sessions.findIndex(s => s.id === session.id);
  const { messages, tools, events, permissions, tasks, metrics, capabilities, ...summary } = session;
  summary.activeAt = messages?.findLast(m => m.role === 'user')?.createdAt || session.createdAt;
  if (index < 0) state.sessions.unshift(summary); else state.sessions[index] = { ...state.sessions[index], ...summary };
  $('#current-title').textContent = session.title || '未命名会话';
  renderModelOptions(session.model || 'sonnet');
  $('#mode-select').value = session.permissionMode || 'bypassPermissions';
  configureEffort(session.effort || 'auto'); renderUsage();
  renderTitleMeta();
  renderSessions(); renderMessages(); if (state.view === 'monitor') renderMonitor(); renderTodos(); updateControls();
  $('#workspace-session-label').textContent = session.title || '当前会话';
  if (previous) detectWorkspaceChanges(previous, session); else plugins.activeChanged();
}
function preserveDraft() { if (state.draftLoaded) storage.set(activeDraftKey(), $('#message-input').value); }
function loadDraft() { $('#message-input').value = storage.get(activeDraftKey()) || ''; state.draftLoaded = true; resizeInput(); updateControls(); }
function newSessionView() {
  preserveDraft(); state.selectionVersion++; state.activeId = null; state.session = null; ui.renderedFor = null; resetLive();
  storage.set('cloud-ops-workbench-active', ''); $('#current-title').textContent = '新会话';
  syncAccountSelection(); renderUsage();
  renderModelOptions(storage.get('cloud-ops-workbench-model') || 'sonnet'); $('#mode-select').value = 'bypassPermissions';
  configureEffort(storage.get('cloud-ops-workbench-effort') || 'auto'); ide.directory = ''; ide.activeDocument = null; renderEditor(); renderAttachments(); renderTitleMeta(); if (ide.workspaceOpen) loadDirectory().catch(() => {});
  renderSessions(); renderMessages(); renderActivity(); renderMonitor(); renderTodos(); loadDraft(); closeSidebar(); switchView('chat'); plugins.activeChanged();
  $('#message-input').focus();
}
async function selectSession(id) {
  if (id === state.activeId) { closeSidebar(); return; }
  preserveDraft(); state.selectionVersion++; state.activeId = id; state.session = null; ui.renderedFor = null; resetLive();
  if (ui.attention?.id === id) { ui.attention = null; }
  syncAccountSelection(); renderUsage(); storage.set('cloud-ops-workbench-active', id); loadDraft(); renderSessions(); closeSidebar();
  const remembered = ui.activeDocBySession.get(id);
  ide.directory = ''; ide.activeDocument = remembered && ide.documents.has(remembered) ? remembered : null; renderEditor(); renderAttachments(); renderTodos();
  $('#current-title').textContent = state.sessions.find(s => s.id === id)?.title || '正在载入'; renderTitleMeta();
  $('#messages').innerHTML = '<div class="empty-card loading-card"><span class="working-pulse"></span><p>正在恢复这段对话</p></div>';
  renderActivity(); updateControls();
  try { await refreshSession(); ui.stuck = true; stickToBottom(); if (ide.workspaceOpen) await loadDirectory(); }
  catch (error) { if (id === state.activeId) { $('#messages').innerHTML = `<div class="empty-card"><strong>暂时无法载入会话</strong><p>${escape(error.message)}</p></div>`; toast(error.message, true); } }
}
const statusText = { running: '运行中', awaiting_approval: '待确认', stopping: '正在停止', error: '出错' };
function renderSessions() {
  const query = $('#session-search').value.trim().toLocaleLowerCase();
  // Order by the last message you sent, not updatedAt: every streamed save bumps updatedAt, so parallel runs would keep swapping places.
  const activeAt = s => s.activeAt || s.updatedAt || s.createdAt;
  const sessions = state.sessions.filter(s => Boolean(s.archived) === state.archived && (!query || (s.title || '').toLocaleLowerCase().includes(query))).sort((a, b) => dateValue(activeAt(b)) - dateValue(activeAt(a)));
  $('#session-list-label').textContent = state.archived ? '已归档会话' : '最近会话';
  $('#toggle-archived').classList.toggle('active', state.archived); $('#toggle-archived').title = state.archived ? '查看最近会话' : '查看归档';
  if (!sessions.length) { ui.sessionsHTML = ''; $('#session-list').innerHTML = `<div class="session-list-empty">${query ? '没有找到匹配的会话。' : state.archived ? '归档会话会保留在这里。' : '留一点空间，给下一个好想法。<br>从新会话开始。'}</div>`; return; }
  let bucket = null;
  const html = sessions.map(s => {
    const label = state.archived || query ? null : dayBucket(activeAt(s));
    const header = label && label !== bucket ? `<div class="session-group-label">${label}</div>` : ''; if (label) bucket = label;
    const status = s.status === 'awaiting_approval' ? 'wait' : running(s) ? 'run' : s.status === 'error' ? 'fail' : 'idle';
    const trailing = status === 'wait' ? '<span class="session-badge wait">待确认</span>' : status === 'run' ? '<span class="session-badge run">运行中</span>' : `<span class="session-time">${escape(relativeTime(s.updatedAt || s.createdAt))}</span>`;
    return `${header}<div class="session-item status-${status}${s.id === state.activeId ? ' active' : ''}" data-session-id="${escape(s.id)}"><button class="session-main" aria-current="${s.id === state.activeId ? 'page' : 'false'}" aria-label="${escape(s.title || '未命名会话')}${statusText[s.status] ? `，${statusText[s.status]}` : ''}"><span class="session-icon">${status === 'idle' ? icon('message') : `<span class="session-state ${status}" title="${escape(statusText[s.status] || '')}"></span>`}</span><span class="session-item-title">${escape(s.title || '未命名会话')}</span>${trailing}</button><button class="session-item-action" data-session-action="rename" aria-label="重命名会话" title="重命名">${icon('edit')}</button><button class="session-item-action" data-session-action="archive" aria-label="${state.archived ? '恢复会话' : '归档会话'}" title="${state.archived ? '恢复' : '归档'}">${icon(state.archived ? 'restore' : 'archive')}</button></div>`;
  }).join('');
  // Live updates arrive several times a second; leave the list (and any hover/focus) alone when nothing changed.
  if (html !== ui.sessionsHTML || !$('#session-list').firstElementChild?.matches('.session-item, .session-group-label')) { $('#session-list').innerHTML = html; ui.sessionsHTML = html; }
}

/* ---------- Chat rendering: turn timeline, streamed markdown, live patches ---------- */
let welcomeHTML = $('#welcome').outerHTML;
const markdownOptions = { breaks: true, gfm: true };
const purifyOptions = { ALLOW_DATA_ATTR: false, FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'iframe', 'object', 'embed', 'img', 'video', 'audio', 'source'], FORBID_ATTR: ['style', 'srcset', 'id', 'name'] };
const markdownReady = () => Boolean(globalThis.marked?.lexer && globalThis.DOMPurify?.sanitize);
function safeMarkdown(text) {
  if (!markdownReady()) return `<div class="plain-text">${escape(text)}</div>`;
  return DOMPurify.sanitize(marked.parse(text || '', markdownOptions), purifyOptions);
}
const doneStatuses = new Set(['completed', 'complete', 'done', 'success', 'approved']);
const failStatuses = new Set(['error', 'failed']);
const activeStatuses = new Set(['preparing', 'running', 'pending', 'waiting_permission', 'awaiting_approval']);
const fileTools = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const toolCatalog = {
  Bash: ['terminal', '运行命令'], BashOutput: ['terminal', '查看命令输出'], KillShell: ['square', '结束后台命令'], KillBash: ['square', '结束后台命令'],
  Read: ['file', '读取'], Write: ['file-plus', '写入'], Edit: ['edit', '编辑'], MultiEdit: ['edit', '批量编辑'], NotebookEdit: ['edit', '编辑笔记本'],
  Grep: ['search', '搜索内容'], Glob: ['search', '查找文件'], LS: ['folder', '列出目录'], WebFetch: ['globe', '读取网页'], WebSearch: ['globe', '联网搜索'],
  TodoWrite: ['list-check', '更新任务清单'], Task: ['layers', '委派子任务'], Agent: ['layers', '委派子任务'], AskUserQuestion: ['message', '询问你的选择'],
  ExitPlanMode: ['shield', '提交计划'], Skill: ['sparkles', '使用技能'], SlashCommand: ['command', '执行命令'],
};
function toolInfo(name = '') {
  if (name.startsWith('mcp__')) { const [, server = '', ...rest] = name.split('__'); return { icon: 'plug', verb: `${rest.join('__') || '工具'}`, badge: `MCP · ${server}` }; }
  const known = toolCatalog[name]; return known ? { icon: known[0], verb: known[1] } : { icon: 'tool', verb: name || '工具调用' };
}
function sessionRoot(id = state.activeId) { const base = state.config.workspaceRoot; return base && id ? `${base.replace(/\/+$/, '')}/${id}` : null; }
// Map a tool or message path onto the session workspace; null means the web file API cannot open it.
function relPath(p, id = state.activeId) {
  if (typeof p !== 'string' || !p.trim()) return null;
  const value = p.trim(), root = sessionRoot(id);
  if (value.startsWith('/')) { if (!root) return null; if (value === root) return ''; return value.startsWith(`${root}/`) ? value.slice(root.length + 1).replace(/\/+$/, '') : null; }
  if (/^~|^[a-z][a-z0-9+.-]*:/i.test(value) || value.split('/').some(part => part === '..')) return null;
  return value.replace(/^\.\//, '').replace(/\/+$/, '');
}
function displayPath(p, id = state.activeId) { const rel = relPath(p, id); if (rel === '') return '工作区根目录'; if (rel != null) return rel; return String(p ?? '').replace(/^\/(?:root|home\/[^/]+)(?=\/|$)/, '~'); }
function toolPath(t) { const input = t?.input || {}; const p = input.file_path || input.notebook_path || (['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'LS'].includes(t?.name) ? input.path : null); return typeof p === 'string' ? p : null; }
function toolSubject(t) {
  const input = t.input || {}, name = t.name || '', path = toolPath(t);
  if (path) return { text: displayPath(path), mono: true, title: path };
  if (name === 'Bash') return input.description ? { text: oneLine(input.description), title: input.command } : { text: oneLine(input.command), mono: true, title: input.command };
  if (name === 'Grep') return { text: input.pattern ? `“${input.pattern}”${input.path ? ` · ${displayPath(input.path)}` : ''}` : '', title: input.pattern };
  if (name === 'Glob') return { text: input.pattern || '', mono: true };
  if (name === 'WebFetch') return { text: input.url || '', mono: true, title: input.url };
  if (name === 'WebSearch') return { text: input.query || '' };
  if (name === 'TodoWrite') { const todos = Array.isArray(input.todos) ? input.todos : []; return { text: todos.length ? `${todos.filter(x => x.status === 'completed').length}/${todos.length} 已完成` : '' }; }
  if (name === 'Task' || name === 'Agent') return { text: input.description || input.subagent_type || '' };
  if (name === 'AskUserQuestion') return { text: input.questions?.[0]?.question || '' };
  if (name === 'ExitPlanMode') return { text: '计划待批准' };
  const fallback = input.description || input.command || input.pattern || input.query || input.url || input.prompt || '';
  return { text: oneLine(typeof fallback === 'string' ? fallback : jsonText(fallback)) };
}
function stepState(status) {
  if (doneStatuses.has(status)) return { cls: 'done', label: '完成' };
  if (failStatuses.has(status)) return { cls: 'fail', label: '失败' };
  if (status === 'denied') return { cls: 'deny', label: '已拒绝' };
  if (['cancelled', 'canceled', 'stopped'].includes(status)) return { cls: 'cancel', label: status === 'stopped' ? '已停止' : '已取消' };
  if (['waiting_permission', 'awaiting_approval'].includes(status)) return { cls: 'wait', label: '等待确认' };
  if (status === 'preparing') return { cls: 'run', label: '生成中' };
  if (activeStatuses.has(status)) return { cls: 'run', label: '进行中' };
  return { cls: 'done', label: '已记录' };
}
const statusMark = cls => cls === 'run' ? '<span class="spinner" aria-hidden="true"></span>' : icon({ done: 'check', fail: 'close', deny: 'ban', cancel: 'square', wait: 'shield' }[cls] || 'check');
// Timeline dots show the tool itself once it has finished; problems override the tool icon.
const dotMark = (cls, name) => cls === 'run' ? '<span class="spinner"></span>' : icon({ fail: 'close', deny: 'ban', cancel: 'square', wait: 'shield' }[cls] || name);
const clockText = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; };
// Durations from server timestamps use the server clock, so a skewed device clock cannot show negative timers.
function serverNow() { return Date.now() + ui.skew; }
function noteServerTime(value) { const t = dateValue(value); if (t) ui.skew = t - Date.now(); }
function lineDiff(a = '', b = '') {
  const A = a === '' ? [] : String(a).split('\n'), B = b === '' ? [] : String(b).split('\n');
  if (A.length * B.length > 160000) return [...A.map(line => ['-', line]), ...B.map(line => ['+', line])];
  const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push([' ', A[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['-', A[i++]]); else out.push(['+', B[j++]]); }
  while (i < n) out.push(['-', A[i++]]); while (j < m) out.push(['+', B[j++]]);
  return out;
}
function diffMarkup(oldText, newText, limit = 300) {
  const rows = lineDiff(oldText ?? '', newText ?? ''); const shown = rows.slice(0, limit);
  return `<div class="diff-view">${shown.map(([op, line]) => `<div class="diff-line ${op === '+' ? 'add' : op === '-' ? 'del' : 'ctx'}"><span class="diff-op">${op.trim()}</span><span class="diff-text">${escape(line) || ' '}</span></div>`).join('')}${rows.length > limit ? `<div class="diff-more">还有 ${rows.length - limit} 行未显示</div>` : ''}</div>`;
}
const statsCache = new Map();
function editStats(t) {
  if (!['Edit', 'MultiEdit', 'Write'].includes(t.name)) return null;
  const input = t.input || {}, key = `${t.id}:${JSON.stringify(input).length}`; if (statsCache.has(key)) return statsCache.get(key);
  const pairs = t.name === 'Write' ? [['', input.content || '']] : t.name === 'Edit' ? [[input.old_string || '', input.new_string || '']] : (Array.isArray(input.edits) ? input.edits : []).map(e => [e?.old_string || '', e?.new_string || '']);
  let add = 0, del = 0; for (const [a, b] of pairs) for (const [op] of lineDiff(a, b)) { if (op === '+') add++; else if (op === '-') del++; }
  const result = { add, del }; statsCache.set(key, result); if (statsCache.size > 400) statsCache.delete(statsCache.keys().next().value); return result;
}
function todoListMarkup(todos) { return `<ol class="todo-list">${(Array.isArray(todos) ? todos : []).map(todo => `<li class="${escape(todo.status || 'pending')}"><span class="todo-check">${todo.status === 'completed' ? icon('check') : todo.status === 'in_progress' ? '<span class="spinner"></span>' : ''}</span><span>${escape(todo.content || todo.activeForm || '')}</span></li>`).join('')}</ol>`; }
function outputMarkup(t, label) {
  if (t.output == null || t.output === '') return '';
  const truncated = t.outputTruncated && !ui.fullTools.has(t.id);
  return `<div class="tool-details-label">${escape(label || (failStatuses.has(t.status) ? '错误信息' : '输出'))}</div><pre class="tool-pre${failStatuses.has(t.status) ? ' error' : ''}">${escape(jsonText(t.output))}</pre>${truncated ? `<button type="button" class="mini-button" data-load-tool="${escape(t.id)}">${ui.loadingTools.has(t.id) ? '正在载入…' : `显示完整输出（共 ${formatNumber(t.outputLength)} 字符）`}</button>` : ''}`;
}
function stepDetails(t) {
  const input = t.input || {}, name = t.name || '', rel = relPath(toolPath(t)); let body = '';
  if (t.status === 'preparing') return `<p class="flow-note">Claude 正在生成这一步的参数${finite(t.inputBytes) && t.inputBytes > 0 ? `，已接收 ${escape(bytes(t.inputBytes))}` : ''}…</p>`;
  if (name === 'Bash') body = `<pre class="term-block"><span class="term-prompt">$</span> ${escape(input.command || '')}</pre>${outputMarkup(t)}`;
  else if (name === 'Edit') body = `${diffMarkup(input.old_string, input.new_string)}${failStatuses.has(t.status) ? outputMarkup(t) : ''}`;
  else if (name === 'MultiEdit') body = `${(Array.isArray(input.edits) ? input.edits : []).map(e => diffMarkup(e?.old_string, e?.new_string)).join('')}${failStatuses.has(t.status) ? outputMarkup(t) : ''}`;
  else if (name === 'Write') body = `${diffMarkup('', input.content || '', 120)}${failStatuses.has(t.status) ? outputMarkup(t) : ''}`;
  else if (name === 'TodoWrite') body = todoListMarkup(input.todos);
  else if (name === 'AskUserQuestion') body = `<div class="qa-list">${(input.questions || []).map(q => `<div class="qa-item"><strong>${escape(q.question || q.header || '')}</strong><span>${escape(input.answers?.[q.question] ?? '未回答')}</span></div>`).join('')}</div>`;
  else if (name === 'ExitPlanMode') body = `<div class="message-body plan-body">${safeMarkdown(input.plan || '')}</div>`;
  else if (['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'BashOutput'].includes(name)) body = `${name === 'Read' || name === 'LS' ? '' : `<div class="tool-details-label">输入</div><pre class="tool-pre">${escape(jsonText(input))}</pre>`}${outputMarkup(t, name === 'Read' ? '内容' : '结果')}`;
  else body = `<div class="tool-details-label">输入</div><pre class="tool-pre">${escape(jsonText(input))}</pre>${outputMarkup(t)}`;
  const actions = [];
  if (rel && toolPath(t) && name !== 'LS') actions.push(`<button type="button" class="mini-button" data-open-path="${escape(rel)}"${finite(input.offset) ? ` data-open-line="${Math.max(1, input.offset)}"` : ''}>${icon('external')}在编辑器打开</button>`);
  if (t.inputTruncated && !ui.fullTools.has(t.id)) actions.push(`<button type="button" class="mini-button" data-load-tool="${escape(t.id)}">载入完整输入</button>`);
  return `${body}${actions.length ? `<div class="step-actions">${actions.join('')}</div>` : ''}`;
}
// A loaded full record replaces only the clipped fields; status and timing keep following the live record.
function toolView(tool) { const full = ui.fullTools.get(tool.id); return full ? { ...tool, input: full.input ?? tool.input, output: full.output ?? tool.output, inputTruncated: false, outputTruncated: false } : tool; }
function toolMeta(t, status) {
  if (t.status === 'preparing') return `生成中${finite(t.inputBytes) && t.inputBytes > 0 ? ` · ${escape(bytes(t.inputBytes))}` : ''}`;
  const since = t.startedAt || t.createdAt;
  if (status.cls === 'run' && dateValue(since)) return `<span data-since="${escape(since)}">${clockText(serverNow() - dateValue(since))}</span>`;
  return escape(status.cls === 'done' ? shortDuration(t.durationMs) : status.label);
}
function toolMarkup(item) {
  const t = toolView(item.tool), info = toolInfo(t.name || t.toolName), subject = toolSubject(t), status = stepState(t.status), stats = t.status === 'preparing' ? null : editStats(t);
  return `<button type="button" class="flow-head" data-toggle-step="${escape(t.id)}" aria-expanded="${item.open}"><span class="flow-dot" aria-hidden="true">${dotMark(status.cls, info.icon)}</span><span class="flow-verb">${escape(info.verb)}</span>${info.badge ? `<span class="step-badge">${escape(info.badge)}</span>` : ''}<span class="flow-subject${subject.mono ? ' mono' : ''}" title="${escape(subject.title || subject.text)}">${escape(subject.text)}</span>${stats && (stats.add || stats.del) ? `<span class="step-stats"><b>+${stats.add}</b>${stats.del ? `<i>−${stats.del}</i>` : ''}</span>` : ''}<span class="flow-meta">${toolMeta(t, status)}</span><span class="flow-chevron">${icon('chevron-right')}</span></button>${item.open ? `<div class="flow-body">${stepDetails(t)}</div>` : ''}`;
}
// Tool records are replaced (never mutated) on every update, so their signature is computed once per version.
const toolSigs = new WeakMap();
function toolSig(t) {
  let sig = toolSigs.get(t);
  if (sig === undefined) { sig = JSON.stringify([t.name, t.status, t.durationMs, t.startedAt, t.inputBytes, String(t.output ?? '').length, t.outputTruncated, t.inputTruncated, JSON.stringify(t.input ?? '').length, toolSubject(t).text]); toolSigs.set(t, sig); }
  return sig;
}
function summarizeTools(tools) {
  if (tools.length === 1) { const t = tools[0]; return `${toolInfo(t.name).verb} ${toolSubject(t).text}`.trim(); }
  const count = { cmd: 0, read: 0, search: 0, web: 0, other: 0 }, edited = new Set();
  for (const t of tools) { if (['Bash', 'BashOutput'].includes(t.name)) count.cmd++; else if (fileTools.has(t.name)) edited.add(toolPath(t) || t.id); else if (['Read', 'LS'].includes(t.name)) count.read++; else if (['Grep', 'Glob'].includes(t.name)) count.search++; else if (['WebFetch', 'WebSearch'].includes(t.name)) count.web++; else if (t.name !== 'TodoWrite') count.other++; }
  const parts = [count.cmd && `运行 ${count.cmd} 条命令`, edited.size && `修改 ${edited.size} 个文件`, count.read && `读取 ${count.read} 个文件`, count.search && `搜索 ${count.search} 次`, count.web && `联网 ${count.web} 次`, count.other && `调用 ${count.other} 个工具`].filter(Boolean);
  return parts.join(' · ') || `更新任务清单`;
}
// Intermediate TodoWrite snapshots repeat the live progress panel; keep only the latest one per activity.
function compactSteps(steps) { let last = -1; steps.forEach((step, i) => { if (step.tool?.name === 'TodoWrite') last = i; }); return steps.filter((step, i) => step.tool?.name !== 'TodoWrite' || i === last); }
function activitySummary(entries) {
  const tools = entries.filter(e => e.tool).map(e => e.tool), failed = tools.filter(t => failStatuses.has(t.status)).length;
  const total = tools.reduce((sum, t) => sum + (finite(t.durationMs) ? t.durationMs : 0), 0) + entries.reduce((sum, e) => sum + (e.m ? thinkingMs(e.m) || 0 : 0), 0);
  return { cls: failed ? 'fail' : 'done', title: tools.length ? summarizeTools(tools) : '思考过程', meta: `${entries.length} 步${total >= 1000 ? ` · ${escape(shortDuration(total))}` : ''}${failed ? ` · <em>${failed} 个失败</em>` : ''}` };
}
function groupMarkup(item) { return `<button type="button" class="flow-head" data-toggle-group="${escape(item.key)}" aria-expanded="${item.open}"><span class="flow-dot" aria-hidden="true">${dotMark(item.cls, 'layers')}</span><span class="flow-verb">${escape(item.title)}</span><span class="flow-meta">${item.meta}</span><span class="flow-chevron">${icon('chevron-down')}</span></button>`; }
const thinkingText = m => typeof m.thinking === 'string' ? m.thinking : m.thinking ? jsonText(m.thinking) : '';
const hasThinking = m => Boolean(thinkingText(m).trim() || m.thinkingStartedAt || m.thinkingRedacted);
function thinkingMs(m) { const start = dateValue(m.thinkingStartedAt), end = dateValue(m.thinkingEndedAt); return start && end >= start ? end - start : null; }
function thinkingLabel(m, live) { if (live) return '正在思考'; const ms = thinkingMs(m); return ms === null ? '思考过程' : `已思考 ${duration(Math.max(1000, ms))}`; }
function thinkingMeta(m, live) {
  const parts = live && dateValue(m.thinkingStartedAt) ? [`<span data-since="${escape(m.thinkingStartedAt)}">${clockText(serverNow() - dateValue(m.thinkingStartedAt))}</span>`] : [];
  if (finite(m.thinkingTokens) && m.thinkingTokens > 0) parts.push(`约 ${escape(compact(m.thinkingTokens))} tokens`);
  return parts.join(' · ');
}
function thinkingItem(m, sessionLive, lastOfLive) {
  const live = sessionLive && Boolean(m.thinkingStartedAt) && !m.thinkingEndedAt, expandable = Boolean(thinkingText(m).trim() || m.thinkingRedacted);
  // Like ai-elements' Reasoning: open while thinking (or while it is the newest step), folded once work moves on.
  const open = expandable && (ui.openThinking.has(m.id) || (!ui.closedThinking.has(m.id) && (live || lastOfLive)));
  return { kind: 'thinking', key: `k:${m.id}`, m, live, open, expandable };
}
function thinkingMarkup(item) {
  const head = `<span class="flow-dot" aria-hidden="true">${icon('brain')}</span><span class="flow-verb think-label">${escape(thinkingLabel(item.m, item.live))}</span><span class="flow-meta think-meta"></span>${item.expandable ? `<span class="flow-chevron">${icon('chevron-right')}</span>` : ''}`;
  return `${item.expandable ? `<button type="button" class="flow-head" data-toggle-thinking="${escape(item.m.id)}" aria-expanded="${item.open}">${head}</button>` : `<div class="flow-head">${head}</div>`}${item.open ? `<div class="flow-body thinking-body"><div class="thinking-text message-body"></div>${item.m.thinkingRedacted ? '<p class="thinking-note">部分思考内容已由官方加密，无法显示。</p>' : ''}</div>` : ''}`;
}
function splitReferences(text) {
  const marker = '\n\n引用当前工作区文件：\n', index = text.lastIndexOf(marker);
  if (index < 0) return { body: text, refs: [] };
  const lines = text.slice(index + marker.length).split('\n').filter(Boolean);
  if (!lines.length || !lines.every(line => /^- @\S/.test(line))) return { body: text, refs: [] };
  return { body: text.slice(0, index), refs: lines.map(line => line.slice(3)) };
}
const steerStates = { queued: ['待送达', 'Claude 会在下一步读到这条引导'], delivered: ['已送达', 'Claude 已读到这条引导'], dropped: ['未送达', '任务结束前没能送达，可放回输入框重新发送'] };
function userMarkup(m) {
  const { body, refs } = splitReferences(m.text || ''), [label, hint] = steerStates[m.steer] || steerStates.queued;
  return `${m.steer ? `<div class="steer-tag ${escape(m.steer)}" title="${escape(hint)}">${icon('steer')}<span>引导 · ${escape(label)}</span></div>` : ''}<div class="message-content">${escape(body)}${refs.length ? `<div class="message-refs">${refs.map(ref => `<button type="button" class="ref-chip" data-open-path="${escape(ref)}" title="${escape(ref)}">${icon('file')}<span>${escape(ref.split('/').at(-1))}</span></button>`).join('')}</div>` : ''}</div><div class="message-actions"><time>${escape(time(m.createdAt))}</time><button type="button" data-copy-user="${escape(m.id)}" title="复制">${icon('copy')}</button><button type="button" data-reuse-message="${escape(m.id)}" title="放回输入框再次编辑">${icon('reply')}</button></div>`;
}
function questionMarkup(permission) {
  return `<div class="approval-card question-card" data-permission-id="${escape(permission.id)}"><div class="approval-top"><span class="approval-icon">${icon('message')}</span><div><strong>Claude 想了解你的选择</strong><small>回答后 Claude 会继续工作</small></div></div>${permission.input.questions.map((question, index) => `<fieldset class="question-field" data-question-index="${index}"><legend>${question.header ? `<span class="question-tag">${escape(question.header)}</span>` : ''}${escape(question.question || `问题 ${index + 1}`)}</legend>${(question.options || []).map((option, n) => `<label class="question-option"><input type="${question.multiSelect ? 'checkbox' : 'radio'}" name="question-${escape(permission.id)}-${index}" value="${escape(option.label || option.value || String(n))}"><span><strong>${escape(option.label || option.value)}</strong>${option.description ? `<small>${escape(option.description)}</small>` : ''}</span></label>`).join('')}<input class="question-freeform" type="text" placeholder="或输入自己的回答" aria-label="自由回答" maxlength="5000"></fieldset>`).join('')}<div class="approval-actions"><button type="button" data-allow="false">暂不回答</button><button type="button" class="allow" data-allow="true">提交回答</button></div></div>`;
}
function permissionMarkup(permission) {
  const name = permission.toolName || permission.name || '工具操作', input = permission.input || {};
  if (name === 'AskUserQuestion' && Array.isArray(input.questions)) return questionMarkup(permission);
  const info = toolInfo(name), path = toolPath({ name, input }); let title = `Claude 想使用 ${name}`, body = '', deny = '拒绝', allow = '允许本次操作', tone = '';
  if (name === 'Bash') { title = 'Claude 想运行一条命令'; body = `${input.description ? `<p class="approval-desc">${escape(input.description)}</p>` : ''}<pre class="term-block"><span class="term-prompt">$</span> ${escape(input.command || '')}</pre>`; }
  else if (fileTools.has(name) && path) { title = name === 'Write' ? 'Claude 想写入文件' : 'Claude 想修改文件'; body = `<div class="approval-path">${icon('file')}<code>${escape(displayPath(path))}</code></div>${name === 'Write' ? diffMarkup('', input.content || '', 120) : name === 'Edit' ? diffMarkup(input.old_string, input.new_string) : (Array.isArray(input.edits) ? input.edits : []).map(e => diffMarkup(e?.old_string, e?.new_string)).join('')}`; }
  else if (name === 'ExitPlanMode') { title = 'Claude 拟好了计划，等你批准'; body = `<div class="message-body plan-body">${safeMarkdown(input.plan || '')}</div>`; deny = '继续完善计划'; allow = '批准并开始执行'; tone = ' plan'; }
  else if (name === 'WebFetch' || name === 'WebSearch') { title = name === 'WebFetch' ? 'Claude 想访问网页' : 'Claude 想联网搜索'; body = `<pre class="approval-code">${escape(input.url || input.query || '')}${input.prompt ? `\n\n${escape(input.prompt)}` : ''}</pre>`; }
  else body = `<pre class="approval-code">${escape(jsonText(input))}</pre>`;
  // The tailored view may omit fields (timeouts, background flags); what is approved stays fully inspectable.
  const raw = body.includes('approval-code') ? '' : `<details class="approval-raw"><summary>查看完整输入</summary><pre class="approval-code">${escape(jsonText(input))}</pre></details>`;
  return `<div class="approval-card${tone}" data-permission-id="${escape(permission.id)}"><div class="approval-top"><span class="approval-icon">${icon(info.icon)}</span><div><strong>${escape(title)}</strong><small>需要你的确认 · ${escape(name)}</small></div></div>${body}${raw}<div class="approval-actions"><button type="button" data-allow="false">${deny}</button><button type="button" class="allow" data-allow="true">${allow}</button></div></div>`;
}
const taskStatusText = { running: '执行中', completed: '已完成', failed: '失败', stopped: '已停止' };
async function stopTask(id) {
  const task = state.session?.tasks?.find(t => t.id === id && t.status === 'running'); if (!task) return;
  try { await api(sessionApi(`tasks/${encodeURIComponent(task.id)}/stop`), { method: 'POST', body: {} }); await refreshSession(); } catch (error) { toast(error.message, true); }
}
const taskMarkup = task => `<div class="task-item ${escape(task.status || '')}"><span class="task-icon">${task.status === 'running' ? '<span class="spinner"></span>' : icon(task.status === 'completed' ? 'check' : task.status === 'failed' ? 'close' : 'layers')}</span><div><strong>${escape(task.description || task.name || task.id)}</strong><small>${escape(taskStatusText[task.status] || '已记录')}${task.summary ? ` · ${escape(oneLine(task.summary))}` : ''}</small></div>${task.status === 'running' ? `<button type="button" data-task-stop="${escape(task.id)}">停止子任务</button>` : ''}</div>`;
function currentActivity(session) {
  if (session?.status === 'awaiting_approval') return '等待你的确认';
  if (session?.status === 'stopping') return '正在停止…';
  const tools = session?.tools || [], tool = tools.findLast(t => activeStatuses.has(t.status));
  if (tool) return `正在${toolInfo(tool.name).verb} ${toolSubject(tool).text}`.trim();
  // Reply text newer than the last tool step is being written; otherwise Claude is between steps.
  const messages = session?.messages || [], reply = messages.slice(messages.findLastIndex(m => m.role === 'user') + 1).findLast(m => m.role === 'assistant');
  return reply?.text?.trim() && dateValue(reply.createdAt) >= dateValue(tools.at(-1)?.createdAt) ? '正在回复' : '正在思考';
}
// Messages and tool records in time order, cut into blocks: user and system messages, reply texts, and
// activities (the thinking and tool steps between two replies). The transcript and the activity panel share these.
const entryKey = entry => entry.tool ? `s:${entry.tool.id}` : `k:${entry.m.id}`;
function sessionBlocks(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [], tools = Array.isArray(session?.tools) ? session.tools : [];
  const ordered = [...messages.map((value, index) => ({ kind: 'message', value, index, date: dateValue(value.createdAt) })), ...tools.map((value, index) => ({ kind: 'tool', value, index, date: dateValue(value.createdAt) }))];
  ordered.sort((a, b) => a.date && b.date ? a.date - b.date || (a.kind === b.kind ? a.index - b.index : a.kind === 'message' ? -1 : 1) : a.kind === b.kind ? a.index - b.index : a.kind === 'message' ? -1 : 1);
  const blocks = []; let activity = null;
  const step = entry => { if (!activity) blocks.push(activity = { type: 'activity', entries: [] }); activity.entries.push(entry); };
  for (const { kind, value } of ordered) {
    if (kind === 'tool') { step({ tool: value }); continue; }
    if (value.role !== 'assistant') { blocks.push({ type: value.role === 'user' ? 'user' : 'system', m: value }); activity = null; continue; }
    if (hasThinking(value)) step({ m: value });
    if ((value.text || '').trim()) { blocks.push({ type: 'text', m: value }); activity = null; }
  }
  for (const block of blocks) if (block.type === 'activity') block.key = `a:${entryKey(block.entries[0])}`;
  return blocks;
}
// File edits in a set of tool records: distinct paths and added / removed lines.
function changeStats(tools) {
  const files = new Set(); let add = 0, del = 0;
  for (const t of tools) { if (!fileTools.has(t.name) || failStatuses.has(t.status) || t.status === 'preparing') continue; files.add(toolPath(t) || t.id); const stats = editStats(t); if (stats) { add += stats.add; del += stats.del; } }
  return { files: files.size, add, del };
}
// A stretch of tool work collapses to one transcript row; its steps are listed in the activity panel.
function activityItem(block, entries, live) {
  const tools = entries.filter(e => e.tool).map(e => e.tool), summary = activitySummary(entries), stats = changeStats(tools);
  const active = tools.findLast(t => activeStatuses.has(t.status)), last = entries.at(-1);
  const thinking = live && last.m && last.m.thinkingStartedAt && !last.m.thinkingEndedAt ? last.m : null;
  const since = entries[0].tool?.createdAt || entries[0].m?.thinkingStartedAt || entries[0].m?.createdAt;
  const title = !live ? summary.title : active ? `${['waiting_permission', 'awaiting_approval'].includes(active.status) ? '等待确认' : `正在${toolInfo(active.name).verb}`} ${toolSubject(active).text}`.trim() : thinking ? '正在思考' : '继续处理中';
  const meta = live ? `第 ${entries.length} 步${dateValue(since) ? ` · <span data-since="${escape(since)}">${clockText(serverNow() - dateValue(since))}</span>` : ''}` : summary.meta;
  return { kind: 'activity', key: block.key, live, cls: live ? 'run' : summary.cls, title, meta, thinking, ...stats };
}
// One assistant turn reads as: header, a timeline of thinking and tool steps, the reply, a footer.
// Steps between two replies form one activity; once the reply moves past it, it folds into a summary row.
function chatItems(session) {
  const blocks = sessionBlocks(session), compactMode = !ui.stepsInline;
  const live = running(session), lastUser = blocks.findLastIndex(b => b.type === 'user' && !b.m.steer), items = [];
  let turn = 'start', head = null, texts = 0, asked = null; ui.entryGroups = new Map();
  const moved = session?.history;
  if (moved?.messages) items.push({ kind: 'system', key: 'm:history', m: { id: 'history', createdAt: moved.until, text: `较早的 ${moved.turns || 0} 轮对话已移出页面以保持流畅，导出会话可查看完整记录；不影响 Claude 继续这段对话。` } });
  const closeTurn = () => { if (head && texts && !head.live) items.push({ kind: 'foot', key: `f:${turn}`, turn }); };
  const noteModel = m => { if (head && !head.model && m?.model) head.model = m.model; };
  blocks.forEach((block, index) => {
    if (block.type === 'user' && block.m.steer) { items.push({ kind: 'user', key: `m:${block.m.id}`, m: block.m }); return; }
    if (block.type === 'user') { closeTurn(); items.push({ kind: 'user', key: `m:${block.m.id}`, m: block.m }); turn = block.m.id; head = null; texts = 0; asked = block.m.resolvedModel || (block.m.model ? resolvedOf(block.m.model) : null); return; }
    if (block.type === 'system') { items.push({ kind: 'system', key: `m:${block.m.id}`, m: block.m }); return; }
    const turnLive = live && index > lastUser, last = index === blocks.length - 1, first = block.m || block.entries[0].tool || block.entries[0].m;
    if (!head) items.push(head = { kind: 'head', key: `h:${turn}`, at: first.createdAt, live: turnLive, asked, model: null });
    if (block.type === 'text') { texts++; noteModel(block.m); items.push({ kind: 'text', key: `t:${block.m.id}`, m: block.m, live: turnLive && last }); return; }
    const entries = compactSteps(block.entries), key = block.key;
    const activityLive = (turnLive && last) || entries.some(e => e.tool && activeStatuses.has(e.tool.status));
    for (const entry of block.entries) { ui.entryGroups.set(entryKey(entry), key); noteModel(entry.m); }
    if (compactMode && entries.some(e => e.tool)) { items.push(activityItem(block, entries, activityLive)); return; }
    const grouped = !activityLive && entries.length > 1, open = !grouped || ui.openGroups.has(key);
    if (grouped) items.push({ kind: 'group', key, open, ...activitySummary(entries) });
    if (open) entries.forEach((entry, i) => items.push(entry.tool ? { kind: 'tool', key: `s:${entry.tool.id}`, tool: entry.tool, open: ui.openSteps.has(entry.tool.id) } : thinkingItem(entry.m, turnLive, activityLive && i === entries.length - 1)));
  });
  closeTurn();
  const permissions = (session?.permissions || []).filter(p => !p.status || ['pending', 'awaiting_approval'].includes(p.status));
  // The working row covers silent gaps only: between steps, before the first token, or a reply that has paused.
  const current = items.slice(items.findLastIndex(item => item.kind === 'user' && !item.m.steer) + 1);
  if (live && !permissions.length && !current.some(item => (item.kind === 'tool' && activeStatuses.has(item.tool.status)) || ((item.kind === 'thinking' || item.kind === 'activity') && item.live)) && (items.at(-1)?.kind !== 'text' || performance.now() - ui.lastProgressAt > 1500)) {
    const label = session.status === 'stopping' ? '正在停止…' : head ? '继续处理中' : '正在思考';
    if (!head) items.push(head = { kind: 'head', key: `h:${turn}`, at: null, live: true });
    items.push({ kind: 'working', key: 'working', label });
  }
  const runningTasks = live && ui.stepsInline ? (session.tasks || []).filter(t => t.status === 'running') : [];
  if (runningTasks.length) items.push({ kind: 'tasks', key: 'tasks', tasks: runningTasks });
  if (permissions.length) items.push({ kind: 'permissions', key: 'permissions', permissions });
  const error = session?.lastError || session?.error;
  if (error) items.push({ kind: 'error', key: 'error', error: typeof error === 'string' ? error : error.message || jsonText(error) });
  return items;
}
// The model that answered a turn, flagged when it is not the one that was asked for (no access, overload fallback).
function turnModelMarkup(item) {
  if (!item.model) return '';
  const mismatch = item.asked && item.asked !== item.model;
  const title = mismatch ? `所选 ${modelName(item.asked)}（${item.asked}），Claude Code 实际使用 ${modelName(item.model)}（${item.model}）` : `本轮由 ${item.model} 回复`;
  return `<span class="turn-model${mismatch ? ' mismatch' : ''}" title="${escape(title)}">${mismatch ? icon('alert') : ''}${escape(modelName(item.model))}</span>`;
}
const messageSigs = new WeakMap();
function rowSig(item) {
  switch (item.kind) {
    case 'user': case 'system': { let sig = messageSigs.get(item.m); if (sig === undefined) { sig = JSON.stringify([item.m.text, item.m.createdAt, item.m.steer]); messageSigs.set(item.m, sig); } return sig; }
    case 'head': return `h|${item.at ? time(item.at) : ''}|${item.model || ''}|${item.asked || ''}`;
    case 'activity': return `v|${item.cls}|${item.live}|${item.title}|${item.meta.replace(/<span data-since[^>]*>[^<]*<\/span>/, '')}|${item.add}|${item.del}|${Boolean(item.thinking)}`;
    case 'thinking': return `k|${item.open}|${item.expandable}|${Boolean(item.m.thinkingRedacted)}`;
    case 'tool': return `s|${toolSig(item.tool)}|${item.open}|${ui.fullTools.has(item.tool.id)}|${ui.loadingTools.has(item.tool.id)}`;
    case 'group': return `a|${item.open}|${item.cls}|${item.title}|${item.meta}`;
    case 'permissions': return JSON.stringify(item.permissions.map(p => [p.id, p.toolName, p.input]));
    case 'tasks': return JSON.stringify(item.tasks.map(t => [t.id, t.status, t.description, t.summary]));
    case 'error': return `e|${item.error}`;
    default: return item.kind;
  }
}
function rowClass(item) {
  switch (item.kind) {
    case 'user': return item.m.steer ? 'message message-user message-steer' : 'message message-user';
    case 'system': return 'message message-system';
    case 'head': return `message a-row turn-head${item.live ? ' live' : ''}`;
    case 'text': return `message a-row text-row${item.live ? ' streaming' : ''}`;
    case 'thinking': return `message a-row flow-row think-row${item.live ? ' live' : ''}${item.open ? ' open' : ''}`;
    case 'tool': return `message a-row flow-row step-row ${stepState(item.tool.status).cls}${item.open ? ' open' : ''}`;
    case 'group': return `message a-row flow-row group-row ${item.cls}${item.open ? ' open' : ''}`;
    case 'activity': return `message a-row flow-row group-row activity-row ${item.cls}${item.live ? ' live' : ''}`;
    case 'working': return 'message a-row flow-row working-row';
    case 'foot': return 'message a-row turn-foot';
    case 'permissions': return 'message a-row approvals';
    case 'tasks': return 'message a-row task-list';
    default: return 'message a-row message-error-row';
  }
}
function rowMarkup(item) {
  switch (item.kind) {
    case 'user': return userMarkup(item.m);
    case 'system': return escape(item.m.text || '');
    case 'head': return `<span class="assistant-avatar">${assistantMark}</span><strong>Claude</strong>${turnModelMarkup(item)}${item.at ? `<time>${escape(time(item.at))}</time>` : ''}`;
    case 'activity': return activityRowMarkup(item);
    case 'text': return '<div class="message-body"></div>';
    case 'thinking': return thinkingMarkup(item);
    case 'tool': return toolMarkup(item);
    case 'group': return groupMarkup(item);
    case 'working': return `<div class="flow-head"><span class="flow-dot" aria-hidden="true"></span><span class="flow-verb shimmer">${escape(item.label)}</span></div>`;
    case 'foot': return `<button type="button" data-copy-turn="${escape(item.turn)}" aria-label="复制本轮回复">${icon('copy')}复制</button>`;
    case 'permissions': return item.permissions.map(permissionMarkup).join('');
    case 'tasks': return item.tasks.map(taskMarkup).join('');
    default: return `<div class="message-error">${icon('alert')}<div><strong>本轮没有顺利完成</strong><p>${escape(item.error)}</p></div></div>`;
  }
}
// Returns true while the row still needs animation frames (text left to reveal or a deferred render).
function syncRow(item, el) {
  if (item.kind === 'text') {
    const r = revealOf(item.key, item.m.text || '', ui.fresh.has(item.m.id)), pending = r.shown < r.text.length;
    const busy = item.live || pending; if (el.getAttribute('aria-busy') !== String(busy)) el.setAttribute('aria-busy', String(busy));
    return syncMarkdown(el.firstElementChild, pending ? r.text.slice(0, r.shown) : r.text, busy) || pending;
  }
  if (item.kind === 'thinking') {
    const label = el.querySelector('.think-label'), meta = el.querySelector('.think-meta'), text = label && thinkingLabel(item.m, item.live), metaHTML = thinkingMeta(item.m, item.live);
    if (label && label.textContent !== text) label.textContent = text;
    if (meta && meta._html !== metaHTML) { meta.innerHTML = metaHTML; meta._html = metaHTML; }
    const body = el.querySelector('.thinking-text'), r = revealOf(item.key, thinkingText(item.m), ui.fresh.has(item.m.id));
    if (!body) { r.shown = r.text.length; return false; }
    const box = body.parentElement, pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 24, pending = r.shown < r.text.length;
    const deferred = syncMarkdown(body, pending ? r.text.slice(0, r.shown) : r.text, item.live || pending);
    if (item.live && pinned) box.scrollTop = box.scrollHeight;
    // Fade the top edge only once earlier thinking has scrolled out of the live window.
    if (box.classList.contains('clipped') !== box.scrollTop > 0) box.classList.toggle('clipped', box.scrollTop > 0);
    return deferred || pending;
  }
  if (item.kind === 'working') { const label = el.querySelector('.flow-verb'); if (label.textContent !== item.label) label.textContent = item.label; }
  if (item.kind === 'activity') { const peek = el.querySelector('.activity-peek'); if (peek) { const text = item.thinking ? thinkingText(item.thinking).replace(/\s+/g, ' ').trim().slice(-160) : ''; if (peek.textContent !== text) peek.textContent = text; peek.hidden = !text; } }
  return false;
}
// Smooth typing: the visible prefix eases toward the received text, so bursty chunks read as a steady
// stream (the idea behind ai-sdk's smoothStream and LobeChat's animated output), and catches up fast when done.
function revealOf(key, text, fresh) {
  let r = ui.reveal.get(key);
  if (!r) { r = { text, shown: fresh ? 0 : text.length }; ui.reveal.set(key, r); }
  else if (r.text !== text) {
    if (r.shown > text.length || !text.startsWith(r.text.slice(0, r.shown))) { const n = Math.min(r.shown, text.length); let i = 0; while (i < n && text.charCodeAt(i) === r.text.charCodeAt(i)) i++; r.shown = i; }
    r.text = text;
  }
  return r;
}
function advanceReveal(r, dt, live) {
  if (r.shown >= r.text.length) return;
  if (r.text.length - r.shown > 4000) r.shown = r.text.length - 800;
  let next = Math.min(r.text.length, r.shown + Math.max(live ? 1 : 4, Math.ceil((r.text.length - r.shown) * (1 - Math.exp(-dt / (live ? 140 : 60))))));
  const code = r.text.charCodeAt(next - 1); if (code >= 0xd800 && code <= 0xdbff && next < r.text.length) next++;
  r.shown = next;
}
// Close the syntax a stream is in the middle of, so the tail renders as it will once complete (same idea as
// Streamdown's remend), and hold back what has no final form yet, so streamed text only ever grows.
function healMarkdown(text) {
  // Inside an open fence everything is code already; only a closing fence still being typed is held back.
  if ((text.match(/^ {0,3}(?:`{3,}|~{3,})/gm) || []).length % 2) return text.replace(/\n {0,3}(?:`+|~+)$/, '\n');
  // Hold back a trailing run of emphasis markers (an opener with nothing after it yet, or half a closer), a lone
  // backslash or "!" (maybe an image), a bare block marker, task box or fence start, and a table header until a
  // delimiter row with as many cells confirms it.
  const bare = md => md.replace(/(^|\n)[ \t]*(?:[-*+=#>]+(?:[ \t]+[-*+=#>]+)*|\d{1,9}[.)]?|`{1,2}|~{1,2})(?:[ \t]+\[[ xX]?\]?)?[ \t]*$/, '$1');
  let out = bare(text.replace(/(?:\*+|_+|\\|!|([^\n~])~+)$/, '$1'));
  const head = /(^|\n)( {0,3}\|[^\n]*(?:\n {0,3}[|:\- ]*)?)$/.exec(out);
  if (head && !/(^|\n) {0,3}\|[^\n]*$/.test(out.slice(0, head.index)) && marked.lexer(head[2], markdownOptions)[0]?.type !== 'table') out = out.slice(0, head.index + head[1].length);
  // Fenced blocks blanked (positions still match out); a code span pairs a run of n backticks with the next run of n.
  const prose = () => out.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n(?:[\s\S]*?\n)? {0,3}\1[^\n]*$/gm, block => block.replace(/[^\n]/g, ' '));
  const scan = text => { const spans = []; let open = null; for (const run of text.matchAll(/`+/g)) if (!open) open = run; else if (run[0].length === open[0].length) { spans.push([open.index, run.index + run[0].length]); open = null; } return { open, spans }; };
  const code = scan(prose()).open;
  // An unfinished tag or autolink shows nothing yet (attributes only briefly), an unfinished link its label, an
  // image nothing (DOMPurify drops <img>).
  if (!code) out = out.replace(/<(?:\/?[A-Za-z][^<>\s]*(?:[ \t][^<>\n]{0,80})?|\/)?$/, '');
  const link = /(!?)\[([^\]\n]*)(?:\](?:\([^)\s`]*)?)?$/.exec(out);
  if (link && !(code && link.index > code.index)) out = out.slice(0, link.index) + (link[1] ? '' : link[2]);
  const left = code && scan(prose()).open;
  if (left) out = left.index + left[0].length === out.length ? out.slice(0, left.index) : out.replace(/`*$/, left[0]);
  out = bare(out);
  // Emphasis: delimiters with whitespace on both sides are literal; of the rest, an odd last one that can open is
  // still waiting for its closer. Close those innermost first, i.e. in reverse order of where they sit.
  const base = prose(); let plain = '', at = 0;
  for (const [from, to] of scan(base).spans) { plain += base.slice(at, from) + base.slice(from, to).replace(/[^`\n]/g, 'x'); at = to; }
  plain = (plain + base.slice(at)).replace(/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, line => ' '.repeat(line.length));
  // "_" never opens or closes inside a word (snake_case).
  const single = plain.replace(/\*{2,}|_{2,}/g, run => ' '.repeat(run.length)), word = /[\p{L}\p{N}]/u, open = [];
  for (const [s, marker, lead] of [[single, '*', /[\s([{"'“‘（`]|[^\x00-\x7f]/], [plain, '**', /[^]/], [single, '_', /[^\p{L}\p{N}]/u], [plain, '__', /[^\p{L}\p{N}]/u], [plain, '~~', /[^]/]]) {
    let count = 0, last = 0;
    for (let i = s.indexOf(marker); i >= 0; i = s.indexOf(marker, i + marker.length)) {
      const before = s[i - 1] || ' ', after = s[i + marker.length] || ' ';
      if ((/\S/.test(before) || /\S/.test(after)) && !(marker[0] === '_' && word.test(before) && word.test(after))) { count++; last = i; }
    }
    if (count % 2 && /\S/.test(s[last + marker.length] || '') && (!last || lead.test(s[last - 1]))) open.push([last, marker]);
  }
  return open.length ? out.replace(/\s*$/, space => open.sort((a, b) => b[0] - a[0]).map(([, marker]) => marker).join('') + space) : out;
}
// Streamed markdown keeps finished top-level blocks as-is and re-parses only the open tail, like
// Streamdown's block memoization: earlier paragraphs never flicker and text selections in them survive.
function syncMarkdown(body, source, live) {
  let md = body._md;
  if (md && md.source === source && md.live === live) return false;
  if (!markdownReady()) { body.innerHTML = safeMarkdown(source); return false; }
  const text = source.includes('\r') ? source.replace(/\r\n?/g, '\n') : source, now = performance.now();
  if (!md || !text.startsWith(md.frozen)) { body.replaceChildren(); md = body._md = { frozen: '', tail: Object.assign(document.createElement('div'), { className: 'md-block md-tail' }), tailHTML: '', caret: null, source: null, live: null, nextAt: 0 }; }
  else if (live && now < md.nextAt) return true;
  const tokens = marked.lexer(text.slice(md.frozen.length), markdownOptions);
  // Everything before the last block is final, except a list whose next block may still become its item
  // ("2" before "2. "). The raw check keeps this exact even if the lexer ever rewrites its input.
  let last = tokens.length - 1; while (last >= 0 && tokens[last].type === 'space') last--;
  for (let prev = last - 1; prev >= 0; prev--) if (tokens[prev].type !== 'space') { if (tokens[prev].type === 'list') last = prev; break; }
  const raw = tokens.slice(0, Math.max(0, last)).map(token => token.raw).join(''), split = raw && text.startsWith(raw, md.frozen.length) ? last : 0;
  for (let i = 0; i < split; i++) {
    if (tokens[i].type === 'space') continue;
    const block = document.createElement('div'); block.className = 'md-block';
    block.innerHTML = DOMPurify.sanitize(marked.parser([tokens[i]], markdownOptions), purifyOptions);
    if (block.firstChild) { body.insertBefore(block, md.tail.parentNode === body ? md.tail : null); enhanceMarkdown(block); }
  }
  if (split) md.frozen = text.slice(0, md.frozen.length + raw.length);
  const tail = text.slice(md.frozen.length), healed = live ? healMarkdown(tail) : tail;
  const html = !healed.trim() ? '' : DOMPurify.sanitize(healed === tail ? marked.parser(tokens.slice(split), markdownOptions) : marked.parse(healed, markdownOptions), purifyOptions);
  if (html !== md.tailHTML) { md.tailHTML = html; md.tail.innerHTML = html; if (html) { body.append(md.tail); enhanceMarkdown(md.tail); } else md.tail.remove(); }
  if (live) {
    md.caret ||= Object.assign(document.createElement('span'), { className: 'stream-caret' });
    const host = caretHost(body, md), last = host.lastChild === md.caret ? md.caret.previousSibling : host.lastChild;
    // marked ends code with a newline, which would drop the caret onto an empty line under the code.
    if (last?.nodeType === Node.TEXT_NODE && last.data.endsWith('\n') && host.matches('pre > code')) last.data = last.data.slice(0, -1);
    if (md.caret.parentNode !== host || host.lastChild !== md.caret) host.append(md.caret);
  } else md.caret?.remove();
  // A very long open block (a big table or code listing) is re-rendered less often instead of every frame.
  const cost = performance.now() - now; md.nextAt = live && cost > 6 ? performance.now() + Math.min(cost * 4, 250) : 0;
  md.source = source; md.live = live;
  return false;
}
// The caret sits at the end of the last text-bearing element, never inside itself or after a closed block.
function caretHost(body, md) {
  let scope = md.tail.parentNode === body ? md.tail : body.lastElementChild; if (scope === md.caret) scope = scope.previousElementSibling; if (!scope) return body;
  const hosts = scope.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, pre > code'); return hosts[hosts.length - 1] || scope;
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function renderMessages() {
  const session = state.session, container = $('#messages');
  const messages = Array.isArray(session?.messages) ? session.messages : [], tools = Array.isArray(session?.tools) ? session.tools : [];
  $('#message-count').textContent = (session?.history?.turns || 0) + (session?.history?.replies || 0) + messages.filter(m => m.role === 'user' || (m.role === 'assistant' && (m.text || '').trim())).length;
  ui.renderPending = false;
  if (!session || (!messages.length && !tools.length && !(session.permissions || []).length)) {
    if (!container.querySelector(':scope > #welcome')) container.innerHTML = welcomeHTML;
    ui.renderedFor = null; ui.items = new Map(); ui.pending.clear(); updateScrollButton(); scheduleActivity(); return false;
  }
  const first = ui.renderedFor !== session.id;
  if (first) { container.replaceChildren(); ui.renderedFor = session.id; ui.unseen = false; }
  $$(':scope > :not([data-key])', container).forEach(el => el.remove());
  const existing = new Map($$(':scope > [data-key]', container).map(el => [el.dataset.key, el]));
  const items = chatItems(session), appeared = []; let added = false, busy = false;
  ui.items = new Map(); ui.pending.clear();
  items.forEach((item, index) => {
    const sig = rowSig(item); let el = existing.get(item.key);
    if (!el || el.dataset.sig !== sig) {
      const row = document.createElement(item.kind === 'user' ? 'article' : 'div');
      row.innerHTML = rowMarkup(item); row.dataset.key = item.key; row.dataset.sig = sig;
      if (item.kind === 'tool' || item.kind === 'permissions') enhanceMarkdown(row);
      if (el) el.replaceWith(row); else { added = true; if (item.kind === 'permissions') ui.stuck = true; if (!first) appeared.push(row); }
      el = row;
    }
    const cls = rowClass(item); if (el.className !== cls) el.className = cls;
    existing.delete(item.key); item.el = el; ui.items.set(item.key, item);
    if (container.children[index] !== el) container.insertBefore(el, container.children[index] || null);
    if (syncRow(item, el)) { ui.pending.add(item.key); busy = true; }
  });
  for (const el of existing.values()) el.remove();
  if (!reduceMotion.matches) for (const row of appeared) row.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
  if (ui.stuck) stickToBottom(); else if (added || busy) ui.unseen = true;
  updateScrollButton(); scheduleActivity();
  if (busy) requestFrame();
  return busy;
}
// All streaming work happens in animation frames: patches only mark the transcript dirty,
// so a burst of patches costs one reconcile, and hidden tabs do no rendering at all.
function scheduleRender() { ui.renderPending = true; requestFrame(); }
function requestFrame() { if (!ui.raf) ui.raf = requestAnimationFrame(frame); }
function frame(now) {
  ui.raf = 0;
  const dt = ui.lastFrameAt ? Math.min(1000, now - ui.lastFrameAt) : 16; ui.lastFrameAt = now;
  for (const key of ui.pending) { const item = ui.items.get(key), r = ui.reveal.get(key); if (r && item) advanceReveal(r, dt, item.live); }
  let busy = false;
  if (ui.renderPending) busy = renderMessages();
  else {
    for (const key of [...ui.pending]) { const item = ui.items.get(key); if (item?.el.isConnected && syncRow(item, item.el)) busy = true; else ui.pending.delete(key); }
    if (ui.stuck) stickToBottom(); else if (busy) { ui.unseen = true; updateScrollButton(); }
  }
  if (busy) requestFrame(); else ui.lastFrameAt = 0;
}
// Stick-to-bottom (after use-stick-to-bottom): follow new output until the reader scrolls up, resume at the bottom.
function stickToBottom() {
  if (ui.pointerDown || ui.touching) return;
  const box = $('#messages'), top = box.scrollHeight - box.clientHeight;
  if (top - box.scrollTop > 1) { box.scrollTop = top; ui.autoScrollTop = box.scrollTop; }
}
function enhanceMarkdown(root) {
  const markdown = el => el.closest('.message-body, .md-block');
  for (const a of root.querySelectorAll('a')) if (markdown(a)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer'; }
  for (const pre of root.querySelectorAll('pre')) {
    const code = $('code', pre); if (!code || !markdown(pre) || pre.querySelector('.copy-code')) continue;
    const lang = [...code.classList].find(c => c.startsWith('language-'))?.replace('language-', '') || 'code';
    const label = document.createElement('span'); label.className = 'code-language'; label.textContent = lang;
    const button = document.createElement('button'); button.className = 'copy-code'; button.type = 'button'; button.innerHTML = `${icon('copy')}复制`;
    button.addEventListener('click', async () => { if (await copy(code.textContent)) { button.innerHTML = `${icon('check')}已复制`; setTimeout(() => { if (button.isConnected) button.innerHTML = `${icon('copy')}复制`; }, 1800); } });
    pre.prepend(label); pre.append(button);
  }
  for (const table of root.querySelectorAll('table')) { if (!markdown(table) || table.parentElement?.classList.contains('table-wrap')) continue; const wrapper = document.createElement('div'); wrapper.className = 'table-wrap'; table.replaceWith(wrapper); wrapper.append(table); }
  linkPaths(root);
}
// Inline `code` that names a workspace file becomes a link into the editor (only paths Claude touched or slash-qualified file names).
const pathShape = /^(?:[\w.@一-龥-]+\/)*[\w.@一-龥-]+\.[A-Za-z][\w]{0,9}$/;
let pathMemo = null;
function knownPaths() {
  const tools = state.session?.tools || [];
  if (pathMemo?.tools === tools && pathMemo.count === tools.length && pathMemo.entries === ide.entries && pathMemo.id === state.activeId) return pathMemo.set;
  const set = new Set(); for (const t of tools) { const rel = relPath(toolPath(t)); if (rel) set.add(rel); } for (const entry of ide.entries) set.add(entry.path);
  pathMemo = { tools, count: tools.length, entries: ide.entries, id: state.activeId, set }; return set;
}
function linkPaths(container) {
  if (!state.activeId) return;
  const codes = [...container.querySelectorAll('code')].filter(code => !code.closest('pre, a') && code.closest('.message-body, .md-block'));
  if (!codes.length) return;
  const known = knownPaths();
  for (const code of codes) {
    const raw = code.textContent.trim(); if (!raw || raw.length > 260) continue;
    const match = raw.match(/^(.*?)(?::(\d+))?$/), rel = relPath(match[1]);
    if (!rel || !(known.has(rel) || (rel.includes('/') && pathShape.test(rel)) || (raw.startsWith('/') && pathShape.test(rel.split('/').at(-1))))) continue;
    code.classList.add('path-link'); code.dataset.openPath = rel; if (match[2]) code.dataset.openLine = match[2];
    code.title = `在编辑器中打开 ${rel}`; code.tabIndex = 0; code.setAttribute('role', 'button');
  }
}
/* Live patches: streaming arrives as small ordered `session-patch` frames (lib/live.mjs). A frame
   applies only on top of the seq it follows; a gap or a server restart falls back to one snapshot. */
const metaKeys = ['role', 'createdAt', 'thinkingStartedAt', 'thinkingEndedAt', 'thinkingTokens', 'thinkingRedacted', 'model'];
function applyPatch(session, frame) {
  const messages = session.messages ||= [], tools = session.tools ||= [], changed = { tools: false, todos: false, metrics: false };
  for (const op of frame.ops || []) {
    if (op.op === 'message') {
      let m = messages.findLast(x => x.id === op.id);
      if (!m) { m = { id: op.id, text: '' }; messages.push(m); ui.fresh.add(op.id); }
      for (const key of metaKeys) if (op.meta?.[key] === undefined) delete m[key]; else m[key] = op.meta[key];
    } else if (op.op === 'append' || op.op === 'set') {
      const m = messages.findLast(x => x.id === op.id); if (!m) return null;
      m[op.field] = op.op === 'append' ? `${typeof m[op.field] === 'string' ? m[op.field] : ''}${op.value}` : op.value;
    } else if (op.op === 'tool' && op.tool?.id) {
      const index = tools.findIndex(t => t.id === op.tool.id); if (index < 0) tools.push(op.tool); else tools[index] = op.tool;
      ui.fullTools.delete(op.tool.id); changed.tools = true; if (op.tool.name === 'TodoWrite') changed.todos = true;
    } else if (op.op === 'metrics') { session.metrics = op.metrics; changed.metrics = true; }
  }
  session.live = { ...session.live, seq: frame.seq, now: frame.now }; session.updatedAt = frame.now;
  return changed;
}
function onPatch(frame) {
  if (!state.authenticated || frame.sessionId !== state.activeId) return;
  // Kept so a snapshot that was requested before these frames can be brought forward when it lands.
  ui.patchLog.push(frame); if (ui.patchLog.length > 400) ui.patchLog.splice(0, ui.patchLog.length - 400);
  const session = state.session; if (!session || session.id !== frame.sessionId) return;
  if (session.live?.epoch !== frame.epoch || frame.seq > session.live.seq + 1) { resyncSession(); return; }
  if (frame.seq <= session.live.seq) return;
  const before = frame.ops?.some(op => op.op === 'tool') ? (session.tools || []).map(t => ({ id: t.id, status: t.status })) : null;
  const changed = applyPatch(session, frame); if (!changed) { resyncSession(); return; }
  noteServerTime(frame.now); if (frame.ops?.some(op => op.op !== 'metrics')) ui.lastProgressAt = performance.now();
  // toolCalls mirrors lib/state.mjs (tools.length); the server sends metrics ops only after usage events.
  if (changed.tools) { session.metrics ||= {}; session.metrics.toolCalls = (session.history?.tools || 0) + session.tools.length; detectWorkspaceChanges({ tools: before, status: session.status }, session); if (changed.todos) renderTodos(); updateControls(); }
  else if (running(session) && $('#active-run-label').textContent !== currentActivity(session)) updateControls();
  if (changed.tools || changed.metrics) { scheduleMonitor(); plugins.metrics(); }
  if (changed.tools && before) { const known = new Set(before.map(t => t.id)); for (const tool of session.tools || []) if (!known.has(tool.id)) plugins.activity({ kind: 'tool', sessionId: session.id, current: true, tool: String(tool.name || tool.toolName || '').slice(0, 64) }); }
  scheduleRender();
}
function replayPatches(session) {
  const live = session.live; if (!live) return;
  for (const frame of ui.patchLog) {
    if (frame.sessionId !== session.id || frame.epoch !== live.epoch || frame.seq <= session.live.seq) continue;
    if (frame.seq !== session.live.seq + 1 || !applyPatch(session, frame)) { resyncSession(); return; }
  }
}
function resyncSession() { if (ui.resyncTimer) return; ui.resyncTimer = setTimeout(() => { ui.resyncTimer = null; refreshSession().catch(error => { if (error.status !== 401) console.warn('Session resync unavailable:', error.message); }); }, 80); }
function scheduleMonitor() { if (state.view !== 'monitor' || ui.monitorTimer) return; ui.monitorTimer = setTimeout(() => { ui.monitorTimer = null; if (state.view === 'monitor') renderMonitor(); }, 400); }
// A different session (or none) starts with a clean slate: no frames, no half-revealed text, follow the bottom.
function resetLive() {
  ui.patchLog = []; ui.reveal.clear(); ui.fresh.clear(); ui.pending.clear(); ui.items = new Map(); ui.stuck = true; ui.renderPending = false;
  if (ui.raf) cancelAnimationFrame(ui.raf); ui.raf = 0; ui.lastFrameAt = 0; clearTimeout(ui.resyncTimer); ui.resyncTimer = null;
}
async function copy(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else { const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;opacity:0;pointer-events:none'; document.body.append(area); area.select(); const ok = document.execCommand('copy'); area.remove(); if (!ok) throw new Error('copy failed'); }
    return true;
  } catch { toast('复制未完成，请选中文字后复制。', true); return false; }
}
function turnText(turn) {
  const messages = state.session?.messages || [], start = turn === 'start' ? 0 : messages.findIndex(m => m.id === turn) + 1, parts = [];
  if (!start && turn !== 'start') return '';
  for (let i = start; i < messages.length && !turnStart(messages[i]); i++) if (messages[i].role === 'assistant' && (messages[i].text || '').trim()) parts.push(messages[i].text.trim());
  return parts.join('\n\n');
}
async function loadFullTool(id) {
  const sessionId = state.activeId; if (!sessionId || ui.loadingTools.has(id)) return;
  ui.loadingTools.add(id); renderMessages(); renderActivity();
  try { const record = await api(sessionApi(`tools/${encodeURIComponent(id)}`, sessionId)); ui.fullTools.set(id, record); if (ui.fullTools.size > 40) ui.fullTools.delete(ui.fullTools.keys().next().value); }
  catch (error) { toast(error.message, true); }
  finally { ui.loadingTools.delete(id); if (sessionId === state.activeId) { renderMessages(); renderActivity(); } }
}
// Expanding a step while its activity is live keeps that activity expanded after it folds.
function keepGroupOpen(entryKey) { const group = ui.entryGroups.get(entryKey); if (group) ui.openGroups.add(group); }
// A toggled row stays where it was on screen; following the bottom would otherwise move it away from the pointer.
function toggleRow(control, change) {
  const box = $('#messages'), row = control.closest('#messages > [data-key]'), top = row?.getBoundingClientRect().top, unseen = ui.unseen;
  change(); ui.stuck = false; renderMessages(); ui.unseen = unseen;
  const el = row && ui.items.get(row.dataset.key)?.el; if (el) box.scrollTop += el.getBoundingClientRect().top - top;
  ui.stuck = box.scrollHeight - box.scrollTop - box.clientHeight <= 48; ui.lastScrollTop = box.scrollTop; updateScrollButton();
}
function jumpToTool(id) {
  switchView('chat'); if (!state.session) return;
  if (!ui.stepsInline) { revealInActivity({ tool: id }); return; }
  chatItems(state.session); if (!ui.entryGroups.has(`s:${id}`)) return;
  keepGroupOpen(`s:${id}`); ui.openSteps.add(id); ui.stuck = false; renderMessages();
  requestAnimationFrame(() => { const el = (ui.items.get(`s:${id}`) || ui.items.get(ui.entryGroups.get(`s:${id}`)))?.el; if (!el?.isConnected) return; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); const flash = cssToHex('var(--amber-soft)', '#fdf3d8'); el.animate?.([{ backgroundColor: flash }, { backgroundColor: flash, offset: .3 }, { backgroundColor: 'transparent' }], { duration: 1800, easing: 'ease-out' }); });
}
function emptyMarkup(symbol, title, description) { return `<div class="empty-card">${icon(symbol)}<strong>${escape(title)}</strong><p>${escape(description)}</p></div>`; }

/* ---------- Activity panel: every step and file change, outside the transcript ---------- */
function activityRowMarkup(item) {
  const stats = item.add || item.del ? `<span class="step-stats"><b>+${item.add}</b>${item.del ? `<i>−${item.del}</i>` : ''}</span>` : '';
  return `<button type="button" class="flow-head" data-open-activity="${escape(item.key)}" title="在右侧「执行过程」查看每一步"><span class="flow-dot" aria-hidden="true">${dotMark(item.cls, 'layers')}</span><span class="flow-verb">${escape(item.title)}</span>${stats}<span class="flow-meta">${item.meta}</span><span class="activity-link">${icon('panel')}<span>详情</span></span></button>${item.live ? '<p class="activity-peek" hidden></p>' : ''}`;
}
const narrowLayout = () => matchMedia('(max-width: 1100px)').matches;
const activityVisible = () => ui.activityOpen && !ui.activitySuspended;
// Turns of the session with what Claude did in each: the activities (steps) and the replies between them.
function activityTurns(session) {
  const turns = []; let turn = null, number = session?.history?.turns || 0;
  for (const block of sessionBlocks(session)) {
    if (block.type === 'user' && !block.m.steer) { turns.push(turn = { id: block.m.id, m: block.m, number: ++number, seq: [] }); continue; }
    if (block.type !== 'activity' && block.type !== 'text') continue;
    if (!turn) turns.push(turn = { id: 'start', m: null, number: 0, seq: [] });
    turn.seq.push(block.type === 'activity' ? { type: 'activity', key: block.key, entries: compactSteps(block.entries) } : { type: 'reply', m: block.m });
  }
  for (const t of turns) { t.activities = t.seq.filter(x => x.type === 'activity'); t.tools = t.activities.flatMap(a => a.entries.filter(e => e.tool).map(e => e.tool)); }
  return turns.filter(t => t.activities.length);
}
function fileChanges(session) {
  const files = new Map(), turnOf = new Map();
  for (const t of activityTurns(session)) for (const tool of t.tools) turnOf.set(tool.id, t.number);
  for (const t of session?.tools || []) {
    const path = toolPath(t); if (!fileTools.has(t.name) || !path || t.status === 'preparing') continue;
    const entry = files.get(path) || { path, rel: relPath(path), name: path.split('/').filter(Boolean).at(-1) || path, ops: [], add: 0, del: 0, failed: 0, created: t.name === 'Write' };
    const stats = failStatuses.has(t.status) ? null : editStats(t); if (stats) { entry.add += stats.add; entry.del += stats.del; }
    if (failStatuses.has(t.status) || t.status === 'denied') entry.failed++;
    entry.ops.push(t); entry.at = t.createdAt; entry.turn = turnOf.get(t.id); files.set(path, entry);
  }
  return [...files.values()].sort((a, b) => dateValue(b.at) - dateValue(a.at));
}
function panelThinkingMarkup(item) {
  const m = item.m, label = thinkingLabel(m, item.live), expandable = Boolean(thinkingText(m).trim() || m.thinkingRedacted), meta = finite(m.thinkingTokens) && m.thinkingTokens > 0 ? `约 ${compact(m.thinkingTokens)} tokens` : '';
  const head = `<span class="flow-dot" aria-hidden="true">${icon('brain')}</span><span class="flow-verb think-label">${escape(label)}</span><span class="flow-meta">${escape(meta)}</span>${expandable ? `<span class="flow-chevron">${icon('chevron-right')}</span>` : ''}`;
  return `${expandable ? `<button type="button" class="flow-head" data-toggle-pthinking="${escape(m.id)}" aria-expanded="${item.open}">${head}</button>` : `<div class="flow-head">${head}</div>`}${item.open ? `<div class="flow-body thinking-body"><div class="thinking-text message-body">${safeMarkdown(thinkingText(m))}</div>${m.thinkingRedacted ? '<p class="thinking-note">部分思考内容已由官方加密，无法显示。</p>' : ''}</div>` : ''}`;
}
function activityPanelItems(session) {
  const items = [], live = running(session);
  if (ui.activityTab === 'files') {
    const files = fileChanges(session);
    for (const f of files) {
      const open = ui.openFiles.has(f.path);
      items.push({ kind: 'file', key: `pf:${f.path}`, f, open });
      if (open) for (const t of [...f.ops].reverse()) items.push({ kind: 'tool', key: `pfs:${t.id}`, tool: t, open: ui.openSteps.has(t.id) });
    }
    return { items, empty: ['files', '还没有文件变更', 'Claude 写入或编辑文件后，会按文件汇总在这里，可展开看每次修改的差异。'] };
  }
  const turns = activityTurns(session), latest = turns.at(-1)?.id;
  // The CLI also reports long Bash commands as background tasks; those already appear as steps.
  const toolIds = new Set((session.tools || []).map(t => t.id)), tasks = session.tasks || [];
  const busyTasks = live ? tasks.filter(t => t.status === 'running') : [];
  if (busyTasks.length) { items.push({ kind: 'tasks-head', key: 'pq-head', count: busyTasks.length }); busyTasks.forEach(task => items.push({ kind: 'task', key: `pq:${task.id}`, task })); }
  const looseTasks = new Map();
  for (const task of tasks) {
    if (task.status === 'running' || toolIds.has(task.toolUseId)) continue;
    const at = dateValue(task.createdAt), turn = turns.findLast(t => !t.m || dateValue(t.m.createdAt) <= at) || turns[0];
    if (turn) looseTasks.set(turn.id, [...(looseTasks.get(turn.id) || []), task]);
  }
  for (const t of turns) {
    const turnLive = live && t.id === latest, open = ui.openTurns.has(t.id) || (!ui.closedTurns.has(t.id) && (t.id === latest || turnLive));
    items.push({ kind: 'turn', key: `pt:${t.id}`, t, open, live: turnLive, ...changeStats(t.tools) });
    if (!open) continue;
    t.seq.forEach((x, i) => {
      if (x.type === 'reply') { items.push({ kind: 'reply', key: `pr:${x.m.id}`, m: x.m }); return; }
      const activityLive = (turnLive && i === t.seq.length - 1) || x.entries.some(e => e.tool && activeStatuses.has(e.tool.status));
      if (t.activities.length > 1) items.push({ kind: 'block', key: `pb:${x.key}`, block: x.key, ...activitySummary(x.entries) });
      x.entries.forEach((e, n) => items.push(e.tool ? { kind: 'tool', key: `ps:${e.tool.id}`, tool: e.tool, open: ui.openSteps.has(e.tool.id), anchor: n === 0 ? x.key : null }
        : { kind: 'pthinking', key: `pk:${e.m.id}`, m: e.m, live: activityLive && n === x.entries.length - 1 && Boolean(e.m.thinkingStartedAt) && !e.m.thinkingEndedAt, open: ui.panelThinking.has(e.m.id), anchor: n === 0 ? x.key : null }));
    });
    for (const task of looseTasks.get(t.id) || []) items.push({ kind: 'task', key: `pq:${task.id}`, task });
  }
  return { items, empty: ['steps', '工作开始后，每一步都在这里', 'Claude 运行命令、读写文件时，步骤按轮次列在这里；对话区只保留一行摘要，阅读不受打扰。'] };
}
function activitySig(item) {
  switch (item.kind) {
    case 'turn': return `t|${item.open}|${item.live}|${item.t.tools.length}|${item.files}|${item.add}|${item.del}|${item.t.m?.text?.length || 0}`;
    case 'block': return `b|${item.cls}|${item.title}|${item.meta}`;
    case 'reply': return `r|${plainLine(item.m.text).slice(0, 120)}`;
    case 'pthinking': return `k|${item.open}|${item.live}|${thinkingLabel(item.m, item.live)}|${item.m.thinkingTokens || 0}|${item.open ? thinkingText(item.m).length : 0}`;
    case 'tool': return `s|${toolSig(item.tool)}|${item.open}|${ui.fullTools.has(item.tool.id)}|${ui.loadingTools.has(item.tool.id)}`;
    case 'file': return `f|${item.open}|${item.f.ops.length}|${item.f.add}|${item.f.del}|${item.f.failed}|${item.f.at}`;
    case 'tasks-head': return `q|${item.count}`;
    case 'task': return `q|${item.task.status}|${item.task.description}|${item.task.summary}`;
    default: return item.kind;
  }
}
function activityClass(item) {
  switch (item.kind) {
    case 'turn': return `activity-turn${item.open ? ' open' : ''}${item.live ? ' live' : ''}`;
    case 'block': return `activity-block ${item.cls}`;
    case 'reply': return 'activity-reply';
    case 'pthinking': return `a-row flow-row think-row${item.live ? ' live' : ''}${item.open ? ' open' : ''}`;
    case 'tool': return `a-row flow-row step-row ${stepState(item.tool.status).cls}${item.open ? ' open' : ''}`;
    case 'file': return `activity-file${item.open ? ' open' : ''}${item.f.failed ? ' has-failed' : ''}`;
    case 'tasks-head': return 'activity-section';
    case 'task': return 'activity-task task-list';
    default: return '';
  }
}
function activityMarkup(item) {
  switch (item.kind) {
    case 'turn': {
      const t = item.t, prompt = t.m ? (t.m.handoff ? `换号续传 · ${t.m.handoff.toLabel || ''}` : oneLine(splitReferences(t.m.text || '').body)) : '会话开始';
      const files = item.files ? ` · ${item.files} 个文件` : '';
      return `<button type="button" class="activity-turn-head" data-toggle-turn="${escape(t.id)}" aria-expanded="${item.open}"><span class="turn-number">${t.number ? `#${t.number}` : '·'}</span><span class="turn-prompt" title="${escape(prompt)}">${escape(prompt)}</span><span class="turn-meta">${item.live ? '<span class="spinner"></span>' : ''}${t.tools.length} 步${files}</span><span class="flow-chevron">${icon('chevron-down')}</span></button>`;
    }
    case 'block': return `<button type="button" class="activity-block-head" data-goto-row="${escape(item.block)}" title="在对话中定位这一段"><span class="block-dot"></span><span class="block-title">${escape(item.title)}</span><span class="flow-meta">${item.meta}</span></button>`;
    case 'reply': return `<button type="button" data-goto-row="t:${escape(item.m.id)}" title="在对话中定位这段回复">${icon('message')}<span>${escape(plainLine(item.m.text).slice(0, 120))}</span></button>`;
    case 'pthinking': return panelThinkingMarkup(item);
    case 'tool': return toolMarkup(item);
    case 'file': {
      const f = item.f, dir = displayPath(f.path).split('/').slice(0, -1).join('/');
      return `<button type="button" class="activity-file-head" data-toggle-file="${escape(f.path)}" aria-expanded="${item.open}"><span class="file-icon">${icon(f.created ? 'file-plus' : 'edit')}</span><span class="file-name"><strong>${escape(f.name)}</strong><small title="${escape(f.path)}">${escape(dir || '工作区根目录')}</small></span><span class="file-change"><span class="step-stats"><b>+${f.add}</b>${f.del ? `<i>−${f.del}</i>` : ''}</span><small>${f.ops.length} 次${f.failed ? ` · <em>${f.failed} 次未完成</em>` : ''}${f.turn ? ` · #${f.turn}` : ''}</small></span><span class="flow-chevron">${icon('chevron-down')}</span></button>${item.open && f.rel != null ? `<div class="file-actions"><button type="button" class="mini-button" data-open-path="${escape(f.rel)}">${icon('external')}在编辑器打开</button></div>` : ''}`;
    }
    case 'tasks-head': return `<span class="spinner"></span><strong>后台任务</strong><small>${item.count} 个运行中</small>`;
    case 'task': return taskMarkup(item.task);
    default: return '';
  }
}
function renderActivity() {
  clearTimeout(ui.activityTimer); ui.activityTimer = 0;
  const panel = $('#activity-panel'), list = $('#activity-list'), session = state.session;
  updateActivityBadge();
  if (!activityVisible()) return;
  if (ui.activityFor !== (session?.id || null)) { list.replaceChildren(); ui.activityItems = new Map(); ui.activityFor = session?.id || null; ui.activityStuck = true; }
  const files = session ? fileChanges(session) : [], steps = (session?.tools || []).length;
  $('#activity-steps-count').textContent = steps || ''; $('#activity-files-count').textContent = files.length || '';
  const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
  $('#activity-caption').textContent = !session ? '' : ui.activityTab === 'files' ? (files.length ? `${files.length} 个文件 · +${add} −${del}` : '') : steps ? `${steps} 步${running(session) ? ' · 运行中' : ''}` : '';
  $('#activity-inline').classList.toggle('active', ui.stepsInline); $('#activity-inline').setAttribute('aria-pressed', String(ui.stepsInline));
  const { items, empty } = session ? activityPanelItems(session) : { items: [], empty: ['steps', '选择或开始一段对话', '执行步骤和文件变更会出现在这里。'] };
  if (!items.length) { const html = emptyMarkup(...empty); if (list._empty !== html) { list.innerHTML = html; list._empty = html; ui.activityItems = new Map(); } return; }
  if (list._empty) { list.replaceChildren(); list._empty = null; }
  const pinned = ui.activityStuck, existing = new Map($$(':scope > [data-key]', list).map(el => [el.dataset.key, el]));
  ui.activityItems = new Map();
  items.forEach((item, index) => {
    const sig = activitySig(item); let el = existing.get(item.key);
    if (!el || el.dataset.sig !== sig) {
      const row = document.createElement('div'); row.innerHTML = activityMarkup(item); row.dataset.key = item.key; row.dataset.sig = sig;
      if (item.kind === 'tool') enhanceMarkdown(row);
      if (el) el.replaceWith(row); el = row;
    }
    if (item.anchor) el.dataset.anchor = item.anchor; else delete el.dataset.anchor;
    const cls = activityClass(item); if (el.className !== cls) el.className = cls;
    existing.delete(item.key); item.el = el; ui.activityItems.set(item.key, item);
    if (list.children[index] !== el) list.insertBefore(el, list.children[index] || null);
  });
  for (const el of existing.values()) el.remove();
  if (pinned && running(session) && ui.activityTab === 'steps') list.scrollTop = list.scrollHeight;
}
function scheduleActivity() { updateActivityBadge(); if (!activityVisible() || ui.activityTimer) return; ui.activityTimer = setTimeout(renderActivity, 150); }
function updateActivityBadge() {
  const session = state.session, live = running(session), badge = $('#activity-badge');
  const since = live ? dateValue(session.messages?.findLast(turnStart)?.createdAt) : 0, count = live ? (session.tools || []).filter(t => dateValue(t.createdAt) >= since).length : 0;
  const text = live && count ? String(count) : '';
  if (badge.textContent !== text) badge.textContent = text;
  badge.hidden = !text; $('#activity-toggle').classList.toggle('live', live);
  $('#activity-toggle').classList.toggle('active', activityVisible()); $('#activity-toggle').setAttribute('aria-expanded', String(activityVisible()));
}
// Three columns only fit on wide screens; below that the activity panel and the workspace take turns.
function setActivityOpen(open, { remember = true } = {}) {
  ui.activityOpen = open; ui.activitySuspended = false;
  if (remember) { ui.activityPref = open ? 'open' : 'closed'; storage.set('cloud-ops-workbench-activity', ui.activityPref); }
  if (open && ide.workspaceOpen && !matchMedia('(min-width: 1700px)').matches && !narrowLayout()) closeWorkspace({ keepActivity: true });
  layoutActivity(); if (open) renderActivity();
}
function layoutActivity() {
  const visible = activityVisible(), overlay = visible && narrowLayout();
  $('#activity-panel').hidden = !visible; $('.ide-body').classList.toggle('with-activity', visible && !overlay);
  $('#activity-panel').classList.toggle('overlay', overlay); $('#activity-scrim').hidden = !overlay;
  updateActivityBadge();
}
function setStepsInline(inline) {
  ui.stepsInline = inline; storage.set('cloud-ops-workbench-steps', inline ? 'inline' : '');
  ui.stuck = false; renderMessages(); renderActivity();
  toast(inline ? '执行步骤改为在对话中逐条展开。' : '对话区只保留每段工作的一行摘要，步骤在「执行过程」中查看。');
}
function flash(el) { el?.animate?.([{ backgroundColor: '#fdf3d8' }, { backgroundColor: '#fdf3d8', offset: .3 }, { backgroundColor: 'transparent' }], { duration: 1800, easing: 'ease-out' }); }
// Bring an activity or step into view in the panel, opening the turn that holds it.
function revealInActivity({ activity, tool }) {
  const session = state.session; if (!session) return;
  const turn = activityTurns(session).find(t => t.activities.some(a => a.key === activity || (tool && a.entries.some(e => e.tool?.id === tool))));
  if (!turn) return;
  ui.activityTab = 'steps'; syncActivityTabs(); ui.openTurns.add(turn.id); ui.closedTurns.delete(turn.id); if (tool) ui.openSteps.add(tool);
  if (!activityVisible()) setActivityOpen(true, { remember: !narrowLayout() }); else renderActivity();
  ui.activityStuck = false;
  requestAnimationFrame(() => {
    const el = tool ? ui.activityItems.get(`ps:${tool}`)?.el : ui.activityItems.get(`pb:${activity}`)?.el || $(`#activity-list > [data-anchor="${CSS.escape(activity)}"]`);
    if (!el?.isConnected) return; el.scrollIntoView({ block: tool ? 'center' : 'start', behavior: reduceMotion.matches ? 'auto' : 'smooth' }); flash(el);
  });
}
function syncActivityTabs() { $$('[data-activity-tab]').forEach(b => { const on = b.dataset.activityTab === ui.activityTab; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); }); }
// Rows clicked in the panel stay put on screen while the list re-renders around them.
function toggleActivityRow(control, change) {
  const list = $('#activity-list'), row = control.closest('#activity-list > [data-key]'), top = row?.getBoundingClientRect().top;
  change(); renderActivity();
  const el = row && ui.activityItems.get(row.dataset.key)?.el; if (el && top != null) list.scrollTop += el.getBoundingClientRect().top - top;
  ui.activityStuck = list.scrollHeight - list.scrollTop - list.clientHeight <= 48;
}
function gotoRow(key) {
  const el = ui.items.get(key)?.el; if (!el?.isConnected) return;
  switchView('chat'); ui.stuck = false; if (narrowLayout()) setActivityOpen(false, { remember: false });
  el.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' }); flash(el);
}


/* ---------- Monitor ---------- */
function renderMonitor() {
  const session = state.session; const metrics = session?.metrics || {}; const tools = session?.tools || [];
  const tokenValues = [metrics.inputTokens, metrics.cacheReadTokens, metrics.cacheWriteTokens, metrics.outputTokens];
  const total = tokenValues.every(finite) ? tokenValues.reduce((a, b) => a + b, 0) : null;
  const cost = finite(metrics.costUsd) ? `$${metrics.costUsd.toFixed(metrics.costUsd >= 1 ? 2 : 4)}` : '未提供';
  const stats = [
    { icon: 'layers', label: '累计 Token', value: compact(total), note: finite(metrics.turns) ? `${formatNumber(metrics.turns)} 轮交互${finite(metrics.tokensPerSecond) ? ` · 平均 ${metrics.tokensPerSecond.toFixed(1)} tok/s` : ''}` : '等待 Claude 提供用量', title: '平均输出速度 = 本轮输出 Token / API 调用时间，包含等待与思考时间，不代表纯解码速度。' },
    { icon: 'coins', label: 'API 等价估算', value: cost, note: '参考 API 定价 · 非 Pro 账单' },
    { icon: 'clock', label: '累计执行耗时', value: finite(metrics.durationMs) ? duration(metrics.durationMs) : '未提供', note: finite(metrics.apiDurationMs) ? `模型调用 ${duration(metrics.apiDurationMs)}` : '模型调用耗时未提供', small: true },
    { icon: 'tool', label: '工具调用', value: formatNumber(metrics.toolCalls), unit: finite(metrics.toolCalls) ? '次' : '', note: running(session) ? (session.status === 'awaiting_approval' ? '等待你的操作确认' : '当前会话正在运行') : session ? '当前会话的执行记录' : '开始会话后显示记录' },
  ];
  $('#monitor-stats').innerHTML = stats.map(s => `<article class="stat-card"><div class="stat-top">${icon(s.icon)}<span>${s.label}</span></div><div class="stat-value${s.value === '未提供' ? ' unavailable' : ''}${s.small ? ' small' : ''}">${escape(s.value)}${s.unit ? `<small>${s.unit}</small>` : ''}</div><div class="stat-note"${s.title ? ` title="${escape(s.title)}"` : ''}>${escape(s.note)}</div></article>`).join('');
  renderContext(metrics); renderTokens(tokenValues, total);
  $('#tool-count').textContent = `${formatNumber(finite(metrics.toolCalls) ? metrics.toolCalls : tools.length)} 次工具调用`;
  $('#timeline-content').innerHTML = tools.length ? `<div class="timeline">${[...tools].reverse().slice(0, 120).map(tool => { const status = stepState(tool.status), info = toolInfo(tool.name || tool.toolName); return `<button type="button" class="timeline-item ${status.cls}" data-jump-tool="${escape(tool.id)}" title="在对话中定位这一步"><span class="timeline-icon">${statusMark(status.cls)}</span><div><strong>${escape(info.verb)}<small>${escape(tool.name || '')}</small></strong><p>${escape(toolSubject(tool).text || '输入详情见对话中的执行步骤')}</p></div><span class="timeline-duration">${finite(tool.durationMs) ? shortDuration(tool.durationMs) : time(tool.createdAt) || '—'}</span></button>`; }).join('')}</div>` : emptyMarkup('activity', '工作开始后，轨迹会出现在这里', '每次工具调用都有迹可循。');
  renderFiles(tools); renderServer();
  $('#monitor-updated').textContent = session?.updatedAt ? `最近更新 ${time(session.updatedAt)}` : '等待运行数据';
}
function renderContext(metrics) {
  const current = finite(metrics.contextTokens) ? metrics.contextTokens : null;
  const limit = finite(metrics.contextWindow) && metrics.contextWindow > 0 ? metrics.contextWindow : null;
  const percent = current !== null && limit !== null ? Math.min(100, Math.max(0, current / limit * 100)) : null;
  const history = (Array.isArray(metrics.contextHistory) ? metrics.contextHistory : []).filter(h => finite(h.tokens)).slice(-80);
  let chart = '<div class="chart-empty">运行后显示实际上下文变化</div>';
  if (history.length) {
    const max = limit || Math.max(...history.map(h => h.tokens), 1) * 1.15;
    const points = history.map((h, i) => [history.length === 1 ? 240 : i / (history.length - 1) * 480, 65 - Math.max(0, Math.min(h.tokens / max, 1)) * 58]);
    const line = points.map(p => p.join(',')).join(' ');
    chart = `<svg class="context-trend" viewBox="0 0 480 72" preserveAspectRatio="none" role="img" aria-label="最近 ${history.length} 次上下文用量记录"><path class="grid" d="M0 15h480M0 40h480M0 65h480"/><polygon class="area" points="${points[0][0]},70 ${line} ${points.at(-1)[0]},70"/><polyline class="line" points="${line}"/>${points.length === 1 ? `<circle cx="${points[0][0]}" cy="${points[0][1]}" r="2.5" style="fill:var(--brand)" stroke="none"/>` : ''}</svg>`;
  }
  $('#context-content').innerHTML = `<div class="context-numbers"><strong>${compact(current)}</strong><span>/</span><span>${compact(limit)}</span>${limit !== null ? '<small>tokens</small>' : ''}<span class="context-percentage">${percent === null ? '未提供' : `${percent.toFixed(1)}%`}</span></div><div class="context-track"${percent !== null ? ` role="progressbar" aria-label="上下文使用率" aria-valuenow="${percent.toFixed(1)}" aria-valuemin="0" aria-valuemax="100"` : ' aria-hidden="true"'}><div class="context-fill${percent >= 80 ? ' warning' : ''}" style="width:${percent || 0}%"></div></div><div class="context-track-labels"><span>${current === null ? '等待模型提供上下文数据' : '当前上下文占用'}</span><span>${limit === null ? '容量未提供' : `容量 ${compact(limit)}`}</span></div><div class="context-trend-label"><span>上下文变化趋势</span><span>${history.length ? `最近 ${history.length} 次记录` : '尚无记录'}</span></div>${chart}`;
}
function renderTokens(values, total) {
  const colors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
  const labels = ['输入 Input', '缓存读取', '缓存写入', '输出 Output'];
  const knownTotal = values.reduce((sum, v) => sum + (finite(v) && v > 0 ? v : 0), 0);
  let offset = 0;
  const circles = knownTotal > 0 ? values.map((v, i) => { if (!finite(v) || v <= 0) return ''; const length = v / knownTotal * 100; const circle = `<circle cx="60" cy="60" r="47" pathLength="100" style="stroke:${colors[i]}" stroke-dasharray="${length} ${100 - length}" stroke-dashoffset="${-offset}"/>`; offset += length; return circle; }).join('') : '';
  $('#token-content').innerHTML = `<div class="token-breakdown"><div class="token-donut"><svg viewBox="0 0 120 120" role="img" aria-label="输入、缓存读取、缓存写入和输出 Token 构成"><circle cx="60" cy="60" r="47" style="stroke:var(--track)"/>${circles}</svg><div class="donut-center"><strong>${compact(total)}</strong><span>TOTAL TOKENS</span></div></div><div class="token-legend">${values.map((v, i) => `<div class="legend-row"><span class="legend-dot" style="background:${colors[i]}"></span><span>${labels[i]}</span><strong title="${escape(formatNumber(v))}">${finite(v) ? compact(v) : '未提供'}${finite(v) && knownTotal > 0 ? `<small>${(v / knownTotal * 100).toFixed(0)}%</small>` : ''}</strong></div>`).join('')}</div></div>${total === null ? '<p class="token-empty-note">未收到的用量细项将保留为空。</p>' : ''}`;
}
function renderFiles(tools) {
  const files = new Map();
  for (const tool of tools) {
    const name = tool.name || tool.toolName || '', path = toolPath(tool); if (!path) continue;
    const editing = fileTools.has(name), success = doneStatuses.has(tool.status), failed = ['error', 'failed', 'denied'].includes(tool.status);
    const entry = files.get(path) || { path, name: path.split('/').filter(Boolean).at(-1) || path, writes: 0, reads: 0 };
    if (success) editing ? entry.writes++ : entry.reads++;
    entry.action = failed ? '未完成' : editing ? (success ? '已修改' : '写入中') : '读取'; entry.edited = entry.writes > 0;
    files.delete(path); files.set(path, entry);
  }
  const list = [...files.values()].reverse().slice(0, 40);
  $('#files-content').innerHTML = list.length ? `<div class="file-list">${list.map(f => { const rel = relPath(f.path); return `<${rel ? `button type="button" data-open-path="${escape(rel)}" title="在编辑器中打开"` : 'div'} class="file-activity${rel ? ' linked' : ''}"><span class="file-icon">${icon(f.edited ? 'edit' : 'file')}</span><span class="file-name"><strong>${escape(f.name)}</strong><small>${escape(displayPath(f.path))}</small></span><span class="file-action${f.edited ? ' edit' : ''}">${escape(f.edited ? `已修改${f.writes > 1 ? ` ×${f.writes}` : ''}` : f.action)}</span></${rel ? 'button' : 'div'}>`; }).join('')}</div>` : emptyMarkup('files', '这里还没有文件活动', 'Claude 读取或修改文件时，会留下记录。');
}
function renderServer() {
  const system = state.system || {};
  const metrics = [
    { label: 'CPU', icon: 'cpu', percent: system.cpuPercent, note: Array.isArray(system.load) ? `系统负载 ${system.load.map(v => finite(v) ? v.toFixed(2) : '—').join(' / ')}` : '系统负载未提供' },
    { label: '内存', icon: 'memory', percent: system.memory?.percent, note: finite(system.memory?.usedBytes) && finite(system.memory?.totalBytes) ? `${bytes(system.memory.usedBytes)} / ${bytes(system.memory.totalBytes)}` : '容量信息未提供' },
    { label: '磁盘', icon: 'disk', percent: system.disk?.percent, note: finite(system.disk?.usedBytes) && finite(system.disk?.totalBytes) ? `${bytes(system.disk.usedBytes)} / ${bytes(system.disk.totalBytes)}` : '容量信息未提供' },
  ];
  $('#server-content').innerHTML = `<div class="server-metrics">${metrics.map(m => `<div class="server-metric"><div class="server-metric-label">${icon(m.icon)}<span>${m.label}</span><strong>${finite(m.percent) ? `${m.percent.toFixed(1)}%` : '未提供'}</strong></div><div class="server-track"><span class="${m.percent > 90 ? 'danger' : m.percent > 75 ? 'warning' : ''}" style="width:${finite(m.percent) ? Math.max(0, Math.min(m.percent, 100)) : 0}%"></span></div><div class="server-metric-note">${escape(m.note)}</div></div>`).join('')}</div>`;
}

/* ---------- Controls, run status, cross-session awareness ---------- */
function renderTitleMeta() {
  const root = state.activeId ? sessionRoot() : null;
  $('#workspace-path').textContent = root ? displayPath(root, null) : state.activeId ? 'Claude Code 云端会话' : '发送第一条消息后创建独立工作目录';
  $('#workspace-path').title = root ? `${root}${state.account?.version ? ` · Claude Code ${state.account.version}` : ''} · 点击打开工作区` : '';
  $('#workspace-path').classList.toggle('linked', Boolean(root));
}
function renderRunPill() {
  const s = state.session, pill = $('#run-pill');
  const kind = s?.archived ? ['muted', '已归档'] : ({ running: ['run', 'Claude 正在工作'], stopping: ['run', '正在停止'], awaiting_approval: ['wait', '等待你的确认'], error: ['fail', '上一轮未完成'] })[s?.status];
  pill.hidden = !kind; if (!kind) return;
  pill.className = `run-pill ${kind[0]}`; $('#run-pill-label').textContent = kind[1];
}
function renderTodos() {
  const panel = $('#todo-panel'), session = state.session, tools = session?.tools || [];
  // Only this turn's plan: a finished list from an earlier request must not look like current progress.
  const since = dateValue(session?.messages?.findLast(turnStart)?.createdAt);
  let todos = null; for (let i = tools.length - 1; i >= 0 && !todos; i--) if (tools[i].name === 'TodoWrite' && Array.isArray(tools[i].input?.todos) && dateValue(tools[i].createdAt) >= since) todos = tools[i].input.todos;
  const live = running(session);
  if (!todos?.length || (!live && todos.every(t => t.status === 'completed'))) { panel.hidden = true; panel.dataset.key = ''; return; }
  const key = JSON.stringify([todos, ui.todoOpen, live]); if (panel.dataset.key === key && !panel.hidden) return; panel.dataset.key = key;
  const done = todos.filter(t => t.status === 'completed').length, current = todos.find(t => t.status === 'in_progress');
  panel.hidden = false; panel.classList.toggle('open', ui.todoOpen); panel.classList.toggle('paused', !live);
  panel.innerHTML = `<button type="button" class="todo-head" data-toggle-todos aria-expanded="${ui.todoOpen}"><span class="todo-icon">${live && current ? '<span class="spinner"></span>' : icon('list-check')}</span><span class="todo-title">${escape(current ? current.activeForm || current.content : live ? '任务清单' : '任务清单未全部完成')}</span><span class="todo-count">${done}/${todos.length}</span><span class="step-chevron">${icon('chevron-down')}</span></button><div class="todo-bar"><span style="width:${(done / todos.length * 100).toFixed(1)}%"></span></div>${ui.todoOpen ? todoListMarkup(todos) : ''}`;
}
const limitName = type => { const known = { five_hour: '5 小时额度', seven_day: '本周额度', seven_day_overage_included: '本周额度', overage: '额外用量' }[type]; const family = !known && /^seven_day_/.test(type || '') ? familyOf(type) : null; return known || (family ? `${prettyModel(family)} 本周额度` : '额度'); };
function titleOf(id) { return state.sessions.find(s => s.id === id)?.title || '未命名会话'; }
function renderNotices() {
  const notices = [], session = state.session, waiting = state.sessions.find(s => s.id !== state.activeId && s.status === 'awaiting_approval'), slots = runSlots();
  if (waiting) notices.push({ tone: 'info', icon: 'activity', text: `「${escape(waiting.title || '未命名会话')}」在等你确认，确认后它会继续运行。`, action: `<button type="button" data-goto-session="${escape(waiting.id)}">前往查看</button>` });
  if (slots.full && !running(session)) notices.push({ tone: 'info', icon: 'activity', text: `已有 ${slots.count} 个任务在并行运行（上限 ${slots.max} 个），其中一个完成后即可发送。` });
  const term = ide.terminal?.status === 'running' ? ide.terminal : null;
  if (term) notices.push({ tone: 'info', icon: 'terminal', text: `${term.kind === 'claude' ? '原生 Claude' : 'Shell'} 终端运行中${term.sessionId && term.sessionId !== state.activeId ? `（属于「${escape(titleOf(term.sessionId))}」），不影响这里的对话；同一时间只能开一个终端。` : '，结束进程后可继续对话。'}`, action: '<button type="button" data-open-terminal>打开终端</button>' });
  if (session?.archived) notices.push({ tone: 'muted', icon: 'archive', text: '这个会话已归档，记录完整保留。', action: '<button type="button" data-restore-session>恢复会话</button>' });
  const metrics = session?.metrics || {}, ctx = finite(metrics.contextTokens) && finite(metrics.contextWindow) && metrics.contextWindow > 0 ? metrics.contextTokens / metrics.contextWindow * 100 : null;
  if (ctx !== null && ctx >= 80 && !running(session) && !session?.archived) notices.push({ tone: 'warn', icon: 'layers', text: `上下文已用 ${ctx.toFixed(0)}%，接近上限，可先压缩再继续。`, action: '<button type="button" data-native-command="/compact">原生终端 /compact</button>' });
  if (!accountReady()) notices.push({ tone: 'warn', icon: 'lock', text: escape(state.execution?.detail || '工作台尚未登录 Claude 账号，请在服务器上用官方 Claude Code 完成登录后再使用。'), action: '<button type="button" data-reload-page>刷新页面</button>' });
  if (state.config.version && ui.pageVersion && state.config.version !== ui.pageVersion) notices.push({ tone: 'info', icon: 'refresh', text: `工作台已更新到 v${escape(state.config.version)}，刷新页面即可使用新版本。`, action: '<button type="button" data-reload-page>刷新页面</button>' });
  const usage = selectedUsage(), near = [['5 小时额度', usage.fiveHour], ['本周额度', usage.sevenDay]].find(([, w]) => finite(w?.utilization) && w.utilization >= 90 && !(w.resetsAt && dateValue(w.resetsAt) <= Date.now()));
  const switching = '';
  if (usage.rateLimited && usage.cooldownUntil) notices.push({ tone: 'danger', icon: 'clock', text: `${limitName(usage.limitType)}已触发官方限流，约 <b data-countdown="${escape(usage.cooldownUntil)}">${remainingTime(usage.cooldownUntil)}</b> 后恢复。${switching}` });
  else if (near) { const [name, w] = near; notices.push({ tone: 'warn', icon: 'activity', text: `${name}已用 ${w.utilization.toFixed(0)}%${w.resetsAt ? `，<b data-countdown="${escape(w.resetsAt)}">${remainingTime(w.resetsAt)}</b> 后重置` : ''}。${switching}` }); }
  // A notice keeps its element while a notice of the same kind (tone and icon) is listed; changed content is
  // swapped in place and countdowns tick on their own each second. Re-creating the element would replay the
  // entrance animation on every refresh, which reads as flicker.
  const box = $('#composer-notices'), seen = {};
  const wanted = notices.map(n => { const kind = `${n.tone}|${n.icon}`, inner = `<span class="notice-icon">${icon(n.icon)}</span><span class="notice-text">${n.text}</span>${n.action || ''}`; return { id: `${kind}|${seen[kind] = (seen[kind] ?? -1) + 1}`, tone: n.tone, inner, key: inner.replace(/(data-countdown="[^"]*">)[^<]*/g, '$1') }; });
  const key = wanted.map(w => w.id + w.key).join(''); if (key === ui.noticesHTML) return; ui.noticesHTML = key;
  const ids = new Set(wanted.map(w => w.id)); for (const el of [...box.children]) if (!ids.has(el.noticeId)) el.remove();
  wanted.forEach((w, i) => {
    let el = [...box.children].find(c => c.noticeId === w.id);
    if (!el) { el = document.createElement('div'); el.className = `notice ${w.tone}`; el.noticeId = w.id; }
    if (el.noticeKey !== w.key) { el.innerHTML = w.inner; el.noticeKey = w.key; }
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
  box.hidden = !wanted.length;
}
const faviconBase = '<rect width="64" height="64" rx="18" fill="#182d2c"/><text x="32" y="44" text-anchor="middle" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="40" fill="#bde5cc">氪</text>';
function setFavicon(color) {
  if ((color || '') === ui.favicon) return; ui.favicon = color || '';
  const dot = color ? `<circle cx="51" cy="13" r="12" fill="${color}" stroke="#f6f5f0" stroke-width="4"/>` : '';
  $('#favicon').href = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${faviconBase}${dot}</svg>`)}`;
}
function updateDocumentTitle() {
  const waiting = state.sessions.some(s => s.status === 'awaiting_approval'), busy = state.sessions.some(running), attention = ui.attention;
  const prefix = waiting ? '【待确认】' : attention?.kind === 'error' ? '【出错】' : attention?.kind === 'done' ? '✓ ' : busy ? '● ' : '';
  document.title = `${prefix}${state.session?.title || (state.activeId ? '会话' : '新会话')} · 浮生氪劳德工作台`;
  setFavicon(waiting ? '#d6a039' : attention?.kind === 'error' ? '#c4573f' : attention?.kind === 'done' ? '#4fae7c' : busy ? '#7fbf95' : null);
}
// Run milestones for plugins holding the activity permission: kinds and tool names only, never content.
function noteActivity(id, before, after) {
  if (before === after || (!before && after !== 'running')) return;
  const wasActive = ['running', 'awaiting_approval', 'stopping'].includes(before);
  const kind = after === 'running' ? 'start' : after === 'awaiting_approval' ? 'approval' : after === 'stopping' ? 'stop' : wasActive && after === 'idle' ? 'done' : wasActive && after === 'error' ? 'error' : null;
  if (kind) plugins.activity({ kind, sessionId: id, current: id === state.activeId });
}
function noteTransition(id, before, after, title) {
  if (!before || before === after) return;
  const wasActive = ['running', 'awaiting_approval', 'stopping'].includes(before);
  const kind = after === 'awaiting_approval' ? 'approval' : wasActive && after === 'idle' ? 'done' : wasActive && after === 'error' ? 'error' : null;
  if (!kind) return;
  const away = document.hidden || id !== state.activeId, name = title || titleOf(id);
  const text = { approval: `「${name}」需要你的确认`, done: `「${name}」已完成`, error: `「${name}」没有顺利完成` }[kind];
  if (away && kind !== 'approval') ui.attention = { kind, id };
  if (document.hidden && ui.notify && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(kind === 'approval' ? 'Claude 需要你的确认' : kind === 'done' ? 'Claude 已完成任务' : 'Claude 任务未完成', { body: name, tag: `claude-${id}`, renotify: true }); n.onclick = () => { window.focus(); if (id !== state.activeId) selectSession(id); n.close(); }; } catch {}
  } else if (!document.hidden && id !== state.activeId) toast(text, kind === 'error', { label: '查看', run: () => selectSession(id) });
  updateDocumentTitle();
}
async function toggleNotifications() {
  if (!('Notification' in window)) { toast('当前浏览器不支持桌面通知。', true); return; }
  if (ui.notify) { ui.notify = false; storage.set('cloud-ops-workbench-notify', ''); toast('已关闭桌面通知。'); return; }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') { toast('浏览器没有允许通知，可在站点设置里开启。', true); return; }
  ui.notify = true; storage.set('cloud-ops-workbench-notify', '1'); toast('已开启：任务完成或需要确认时，会在后台提醒你。');
}
// Graphical tasks in different sessions run in parallel up to the server's cap; the server re-checks on send.
function runSlots() { const count = state.sessions.filter(running).length, max = state.config.maxConcurrentRuns || 1; return { count, max, full: count >= max }; }
// One terminal at a time overall, but it only holds back the conversation it belongs to.
function terminalHere() { return ide.terminal?.status === 'running' && ide.terminal.sessionId === state.activeId; }
function updateControls() {
  const inRun = running(state.session); const loading = Boolean(state.activeId && !state.session); const archived = Boolean(state.session?.archived);
  const terminalBusy = ide.terminal?.status === 'running', terminalOwn = terminalHere(), slots = runSlots();
  const loginBusy = Boolean(loginInProgress());
  syncAccountSelection(); const ready = accountReady(); const activeAccount = selectedAccount(); const auth = activeAccount?.auth || state.account || {};
  const others = slots.count - (inRun ? 1 : 0);
  $('#send-button').hidden = inRun; $('#stop-button').hidden = !inRun;
  $('#send-button').disabled = state.busy || terminalOwn || loginBusy || loading || archived || state.accountSwitchPending || !ready || (!inRun && slots.full) || !$('#message-input').value.trim();
  $('#stop-button').disabled = state.busy;
  $('#steer-button').hidden = !inRun; $('#steer-button').disabled = state.busy || state.steering || archived || !ready || state.session?.status === 'stopping' || !$('#message-input').value.trim();
  $('#model-select').disabled = inRun || terminalOwn || loading || state.busy || archived; $('#mode-select').disabled = inRun || terminalOwn || loading || state.busy || archived;
  plugins.composer({ sessionId: state.activeId, locked: inRun || terminalOwn || loading || state.busy || archived });
  $('#effort-select').disabled = inRun || terminalOwn || loading || state.busy || archived || $('#effort-select').options.length < 2;
  $('#start-shell').disabled = ide.terminalStarting || inRun || terminalBusy || loginBusy || state.accountSwitchPending;
  $('#start-claude').disabled = ide.terminalStarting || inRun || terminalBusy || loginBusy || !ready || state.accountSwitchPending;
  $('#message-input').disabled = archived || !ready;
  $('#message-input').placeholder = archived ? '这个会话已归档，恢复后可继续对话。' : !ready ? (state.execution?.detail || '工作台尚未登录 Claude 账号') : inRun ? '补充要求或纠正方向，按 Enter 发送引导，Claude 会在下一步读到…' : slots.full ? `已有 ${slots.count} 个任务在并行运行，其中一个完成后即可发送…` : '描述任务，或者先聊聊你的想法…';
  $('#active-run-strip').hidden = !inRun;
  $('#active-run-strip').classList.toggle('wait', state.session?.status === 'awaiting_approval');
  $('#active-run-label').textContent = inRun ? currentActivity(state.session) : '';
  $('#rename-current').hidden = !state.activeId;
  const mode = $('#mode-select').value;
  $('#composer-status').innerHTML = `<span class="tiny-dot"></span>${terminalOwn ? '终端运行中 · 结束进程后可继续对话' : !ready ? '执行环境尚未就绪' : mode === 'plan' ? '只读计划 · 先分析，再行动' : mode === 'bypassPermissions' ? `工具自动同意 · ${state.config.rootOperations ? 'Root 运维已启用' : '无 sudo 权限'}` : `云端执行 · 操作逐次确认${state.config.rootOperations ? ' · Root 运维' : ''}`}`;
  $('#composer-status').className = `mode-${mode}`;
  $('#ide-account-status').textContent = `${state.execution?.label || activeAccount?.label || 'Claude Code'}${auth.subscriptionType ? ` · ${auth.subscriptionType}` : ''} · ${modelLabel($('#model-select').value)}${auth.version ? ` · CLI ${auth.version}` : ''}`;
  $('#ide-session-state').textContent = loginBusy ? '账号授权中 · 完成或取消后继续' : terminalOwn ? '终端进程运行中' : state.session?.status === 'awaiting_approval' ? '等待你的确认' : inRun ? currentActivity(state.session) : slots.full ? `并行任务已满 · ${slots.count}/${slots.max}` : others ? `就绪 · 另有 ${others} 个任务运行中` : '就绪';
  $('#export-session').disabled = !state.activeId;
  renderRunPill(); renderNotices(); updateDocumentTitle(); updateRunClock();
}
function updateRunClock() {
  if (!running(state.session)) { $('#run-pill-time').textContent = ''; return; }
  const latestUserMessage = state.session.messages?.findLast(turnStart);
  const start = state.session.runStartedAt || latestUserMessage?.createdAt;
  const text = dateValue(start) ? duration(serverNow() - dateValue(start)) : '';
  $('#active-run-time').textContent = text; $('#run-pill-time').textContent = text;
}
function resizeInput() { const input = $('#message-input'); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, innerWidth < 680 ? 180 : 240)}px`; }
function switchView(view) { if (view?.startsWith('plugin:') && !plugins.hasView(view)) view = 'chat'; const changed = state.view !== view; state.view = view; $('#chat-view').hidden = view !== 'chat'; $('#monitor-view').hidden = view !== 'monitor'; $$('.view-tab').forEach(button => { const selected = button.dataset.tab === view; button.classList.toggle('active', selected); button.setAttribute('aria-selected', selected); }); plugins.setView(view); plugins.setMonitorVisible(view === 'monitor'); if (view === 'monitor') renderMonitor(); if (changed && ide.workspaceOpen && matchMedia('(max-width: 980px)').matches) closeWorkspace(); }
function syncSidebarAccess() { const mobile = matchMedia('(max-width: 680px)').matches; const open = $('#sidebar').classList.contains('open'); $('#sidebar').inert = mobile && !open; $('#sidebar').setAttribute('aria-hidden', mobile && !open ? 'true' : 'false'); $('#mobile-menu').setAttribute('aria-expanded', String(open)); $('.main-shell').inert = mobile && open; }
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebar-scrim').hidden = true; syncSidebarAccess(); }
// Runs on every scroll event and streaming frame, so it only touches the DOM when something changed.
function updateScrollButton() {
  const messages = $('#messages'), button = $('#scroll-bottom'), away = messages.scrollHeight - messages.scrollTop - messages.clientHeight >= 180; if (!away) ui.unseen = false;
  const label = ui.unseen ? '有新内容' : '最新';
  if (button.hidden !== !away) button.hidden = !away;
  if (button.classList.contains('unseen') !== ui.unseen) button.classList.toggle('unseen', ui.unseen);
  if ($('#scroll-bottom-label').textContent !== label) $('#scroll-bottom-label').textContent = label;
}
function scrollToLatest() { switchView('chat'); ui.stuck = true; const messages = $('#messages'); messages.scrollTo({ top: messages.scrollHeight, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); }
function openRename(id) { const session = state.sessions.find(s => s.id === id); if (!session) return; state.renameId = id; $('#rename-input').value = session.title || ''; $('#rename-dialog').showModal(); $('#rename-input').select(); }
async function changeSession(id, patch) { const result = await api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }); if (id === state.activeId) acceptSession(result); else { const index = state.sessions.findIndex(s => s.id === id); if (index >= 0) state.sessions[index] = { ...state.sessions[index], ...result }; renderSessions(); } return result; }

/* ---------- Models ---------- */
// What the CLI reported: aliases (opus, sonnet, fable, haiku) with the exact model each runs today, then
// pinned versions. With several logins (account plugins) the server offers their union. Before any report, the plain aliases.
const modelFamilies = ['opus', 'sonnet', 'fable', 'haiku'];
const familyOf = value => modelFamilies.find(family => String(value || '').toLowerCase().includes(family)) || null;
function modelCatalog() {
  const list = Array.isArray(state.config.models) && state.config.models.length ? state.config.models : modelFamilies;
  return list.map(m => typeof m === 'string' ? { value: m } : m).filter(m => typeof m?.value === 'string');
}
// "claude-opus-4-6" → "Opus 4.6", "claude-haiku-4-5-20251001" → "Haiku 4.5".
function prettyModel(id) {
  const value = String(id || ''), m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(value);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  return modelFamilies.includes(value) ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
const modelEntry = (value, catalog = modelCatalog()) => catalog.find(m => m.value === value) || null;
// The CLI's display name when it carries a version ("Opus 5.5"), else the version read from the model ID.
const versionedName = m => /\d/.test(m.displayName || '') ? m.displayName : m.resolvedModel ? prettyModel(m.resolvedModel) : m.displayName || prettyModel(m.value);
const modelLabel = (value, catalog) => { const entry = modelEntry(value, catalog); return entry ? versionedName(entry) : prettyModel(value); };
const resolvedOf = (value, catalog) => modelEntry(value, catalog)?.resolvedModel || (/^claude-/.test(value || '') ? value : null);
// Name of a model the CLI actually ran, e.g. claude-opus-5-5 → "Opus 5.5".
function modelName(id, catalog = modelCatalog()) {
  if (!id) return '';
  const entry = catalog.find(m => m.value === id) || catalog.find(m => m.resolvedModel === id);
  return entry ? versionedName(entry) : prettyModel(id);
}
function renderModelOptions(value = $('#model-select').value || 'sonnet') {
  const select = $('#model-select'), catalog = modelCatalog();
  const aliases = catalog.filter(m => modelFamilies.includes(m.value)), pinned = catalog.filter(m => !modelFamilies.includes(m.value));
  const option = m => `<option value="${escape(m.value)}">${escape(versionedName(m))}</option>`;
  let html = pinned.length && aliases.length ? `<optgroup label="最新版本">${aliases.map(option).join('')}</optgroup><optgroup label="指定版本">${pinned.map(option).join('')}</optgroup>` : catalog.map(option).join('');
  if (!catalog.some(m => m.value === value)) html += `<option value="${escape(value)}">${escape(prettyModel(value))}</option>`;
  // Rebuilding the options while a dropdown is open would close it, so only touch the DOM when they change.
  if (html !== ui.modelHTML) { select.innerHTML = html; ui.modelHTML = html; }
  select.value = value;
  const entry = modelEntry(value, catalog);
  select.title = entry?.resolvedModel ? `${entry.displayName || value} · ${entry.resolvedModel}${entry.description ? ` · ${entry.description}` : ''}` : '选择模型';
}
// The model line above the quota: what the next turn will run, and what the last turn actually ran when that differs.
function renderModelStatus() {
  const label = $('#active-model-label'); if (!label) return;
  const value = $('#model-select').value, resolved = resolvedOf(value), session = state.session;
  const lastUser = session?.messages?.findLast(turnStart), actual = session?.messages?.findLast(m => m.role === 'assistant' && m.model)?.model || session?.metrics?.model;
  const parts = [`<b>${escape(modelLabel(value))}</b>`]; if (resolved) parts.push(`<code>${escape(resolved)}</code>`);
  let tone = '', title = resolved ? `所选模型会以 ${resolved} 运行` : '所选模型的具体版本由 Claude Code 决定';
  if (actual && resolved && actual !== resolved) {
    const asked = lastUser?.resolvedModel || resolvedOf(lastUser?.model);
    tone = asked && asked !== actual ? ' mismatch' : '';
    parts.push(`<span>上一轮实际 ${escape(modelName(actual))}</span>`);
    title = tone ? `上一轮请求 ${asked}，Claude Code 实际使用 ${actual}（可能因账号无权限或模型繁忙而回退）` : `上一轮由 ${actual} 回复；下一轮改用 ${resolved}`;
  }
  const html = `${icon('sparkles')}${parts.join('<i>·</i>')}`;
  if (label._html !== html) { label.innerHTML = html; label._html = html; }
  label.className = `active-model${tone}`; label.title = title;
}
function configureEffort(value = state.session?.effort || $('#effort-select').value || 'auto') {
  const levels = Array.isArray(state.config.effortLevels) ? state.config.effortLevels : ['auto'];
  const labels = { auto: '自动思考', low: '低思考', medium: '中等思考', high: '高思考', xhigh: '超高思考', max: '最高思考' };
  renderModelOptions();
  const model = $('#model-select').value, current = modelEntry(model) || state.session?.capabilities?.models?.find?.(m => m.value === model) || null;
  const reported = Boolean(current?.resolvedModel || current?.supportedEffortLevels), supported = current?.supportedEffortLevels;
  const noEffort = familyOf(model) === 'haiku' || current?.supportsEffort === false || Boolean(reported && current.supportsEffort == null && !Array.isArray(supported));
  const visibleLevels = noEffort ? ['auto'] : levels;
  const html = visibleLevels.map(level => `<option value="${escape(level)}"${level !== 'auto' && Array.isArray(supported) && !supported.includes(level) ? ' disabled' : ''}>${escape(labels[level] || level)}</option>`).join('');
  if (html !== ui.effortHTML) { $('#effort-select').innerHTML = html; ui.effortHTML = html; }
  $('#effort-select').value = visibleLevels.includes(value) ? value : 'auto';
  if ($('#effort-select').selectedOptions[0]?.disabled) $('#effort-select').value = 'auto';
  $('#effort-select').title = noEffort ? `${modelLabel(model)} 不支持调整思考等级` : '思考等级会传递给 Claude Code；可用档位以当前模型官方能力为准。';
  renderModelStatus();
}

/* ---------- Account state (single account) ---------- */
function selectedAccountId() { return 'primary'; }
function selectedAccount() { return state.account; }
function loginInProgress() { return null; }
function accountReady() { return state.execution ? state.execution.ready !== false : state.account?.loggedIn !== false; }
function selectedUsage() { return ide.usage || {}; }
let usageContextKey;
const quotaState = createUsageState({
  load: (id, force, choices) => { const query = new URLSearchParams(); if (id) query.set('sessionId', id); if (force) query.set('refresh', '1'); if (choices) query.set('choices', JSON.stringify(choices)); return api(`/api/usage?${query}`); },
  render: snapshot => { ide.usage = snapshot; renderUsage(); renderNotices(); plugins.usage(); },
});
function syncAccountSelection() {
  const choices = plugins.usageChoices(state.activeId), context = JSON.stringify([state.activeId, choices]);
  if (usageContextKey === context) return;
  usageContextKey = context; quotaState.select(state.activeId, choices);
  if (state.authenticated) void quotaState.refresh().catch(() => {});
}

/* ---------- Official usage ---------- */
function remainingTime(value) { const seconds = Math.max(0, Math.ceil((dateValue(value) - Date.now()) / 1000)); if (!dateValue(value)) return '时间待提供'; if (!seconds) return '等待刷新'; const d = Math.floor(seconds / 86400); const h = Math.floor(seconds % 86400 / 3600); const m = Math.floor(seconds % 3600 / 60); const s = seconds % 60; return `${d ? `${d}天 ` : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
const resetFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function quotaMarkup(label, value, remaining, usage = selectedUsage()) {
  const known = finite(value?.utilization), used = known ? Math.min(100, Math.max(0, value.utilization)) : null, shown = used === null ? null : remaining ? 100 - used : used;
  const reset = dateValue(value?.resetsAt), stale = usage.stale || value?.stale || (reset && reset <= Date.now());
  const level = used === null ? '' : used >= 90 ? ' danger' : used >= 75 ? ' warning' : '';
  return `<div class="quota-head"><span class="quota-label">${label}${stale ? '<i class="quota-stale">待刷新</i>' : ''}</span><strong class="quota-value">${shown === null ? '<span class="quota-unknown">待官方数据</span>' : `${shown.toFixed(0)}<small>%</small>`}</strong></div><div class="quota-track${level}"><span style="width:${shown ?? 0}%"></span></div><div class="quota-timing">${reset ? `<span>${resetFormat.format(new Date(reset))} 重置 · 北京时间</span><b data-countdown="${escape(value.resetsAt)}">${remainingTime(value.resetsAt)}</b>` : `<span>${escape(usage.unavailableReason || '重置时间待官方数据')}</span>`}</div>`;
}
function renderUsage() {
  const usage = selectedUsage(), five = usage.fiveHour || {}, week = usage.sevenDay || {}, now = Date.now();
  const cooldown = usage.cooldownUntil || usage.retryAt;
  const key = JSON.stringify([selectedAccountId(), usage, ui.usageCollapsed, dateValue(five.resetsAt) <= now, dateValue(week.resetsAt) <= now, dateValue(cooldown) > now]);
  if (key === ui.usageKey) return; ui.usageKey = key;
  $('#quota-five').innerHTML = quotaMarkup(usage.contextLabel ? `5 小时已用 · ${escape(usage.contextLabel)}` : '5 小时已用', five, false);
  $('#quota-week').innerHTML = quotaMarkup('本周剩余', week, true);
  $('#quota-reset').hidden = !cooldown;
  $('#quota-reset').innerHTML = cooldown ? `<span class="quota-label">${usage.rateLimited || dateValue(cooldown) > now ? '冷却剩余' : '官方额度'}</span><strong data-countdown="${escape(cooldown)}">${remainingTime(cooldown)}</strong>` : '';
  $('#usage-strip').classList.toggle('collapsed', ui.usageCollapsed);
  $('#usage-collapse').setAttribute('aria-label', ui.usageCollapsed ? '展开额度详情' : '收起额度详情');
  $('#usage-strip').title = `${usage.contextLabel ? `额度所属：${usage.contextLabel} · ` : ''}${usage.unavailableReason || (usage.source ? `来源：${usage.source}` : '等待 Claude 官方额度数据')}${usage.updatedAt ? ` · 更新于 ${time(usage.updatedAt)}` : ''}${five.resetsAt ? ` · 5h 重置 ${new Date(five.resetsAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 北京时间` : ''}${week.resetsAt ? ` · 周重置 ${new Date(week.resetsAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 北京时间` : ''}`;
}
function tick() {
  renderUsage(); updateRunClock(); for (const el of $$('[data-countdown]')) { const text = remainingTime(el.dataset.countdown); if (el.textContent !== text) el.textContent = text; }
  for (const el of $$('#messages [data-since], #activity-list [data-since]')) { const text = clockText(serverNow() - dateValue(el.dataset.since)); if (el.textContent !== text) el.textContent = text; }
  // Re-evaluates the working row (shown once a running reply has been silent for a moment).
  if (running(state.session) && state.view === 'chat') scheduleRender();
}
async function refreshUsage() { $('#refresh-usage').disabled = true; $('#refresh-usage').classList.add('spinning'); try { await quotaState.refresh(true); } catch (error) { toast(error.message, true); } finally { $('#refresh-usage').disabled = false; $('#refresh-usage').classList.remove('spinning'); } }
async function ensureSession() {
  if (state.activeId) return state.activeId;
  const draft = $('#message-input').value; const created = await api('/api/sessions', { method: 'POST', body: { model: $('#model-select').value, permissionMode: $('#mode-select').value, effort: $('#effort-select').value } });
  state.activeId = created.id; plugins.commitDraft(created.id); state.selectionVersion++; storage.set('cloud-ops-workbench-active', created.id); storage.set('cloud-ops-workbench-draft:new', ''); storage.set(activeDraftKey(), draft); acceptSession(created); return created.id;
}

/* ---------- Workspace files and editor ---------- */
const sessionApi = (path, id = state.activeId) => `/api/sessions/${encodeURIComponent(id)}/${path}`;
function currentDocument() { return ide.activeDocument ? ide.documents.get(ide.activeDocument) : null; }
function documentKey(id, path) { return `${id}:${path}`; }
function languageFor(path) { const extension = path.split('.').at(-1)?.toLowerCase(); return ({ js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown', mdx: 'markdown', yml: 'yaml', yaml: 'yaml', py: 'python', sh: 'shell', bash: 'shell', css: 'css', html: 'html', xml: 'xml', sql: 'sql', go: 'go', rs: 'rust', toml: 'ini', ini: 'ini', conf: 'ini', txt: 'plaintext', diff: 'diff', patch: 'diff' })[extension] || 'plaintext'; }
function markDocumentChanged(text) { const doc = currentDocument(); if (!doc || ide.syncingEditor) return; doc.text = text; doc.dirty = text !== doc.savedText; $('#file-save').disabled = !doc.dirty || doc.readOnly; $('#editor-save-status').textContent = doc.dirty ? '有未保存的修改' : '已保存'; renderEditorTabs(); if (ide.preview) $('#markdown-preview').innerHTML = safeMarkdown(text); }
async function loadMonaco() {
  if (ide.editor) return ide.editor; if (ide.monacoLoading) return ide.monacoLoading;
  ide.monacoLoading = new Promise((resolve, reject) => { if (globalThis.monaco?.editor) return resolve(); const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/editor/monaco.css'; document.head.append(css); const script = document.createElement('script'); script.src = '/vendor/editor/monaco.js'; script.onload = resolve; script.onerror = () => reject(new Error('编辑器组件加载失败，已保留文本编辑模式。')); document.head.append(script); }).then(() => {
    if (!globalThis.monaco?.editor) throw new Error('编辑器组件未就绪，已保留文本编辑模式。');
    if (!monaco.languages.getLanguages().some(language => language.id === 'diff')) { monaco.languages.register({ id: 'diff', extensions: ['.diff', '.patch'] }); monaco.languages.setMonarchTokensProvider('diff', { tokenizer: { root: [[/^(diff --git|index |--- |\+\+\+ ).*$/, 'diff.meta'], [/^@@.*$/, 'diff.hunk'], [/^\+.*$/, 'diff.add'], [/^-.*$/, 'diff.del']] } }); }
    monaco.editor.defineTheme('workbench', monacoTheme(themes.current));
    ide.editor = monaco.editor.create($('#monaco-editor'), { model: null, theme: 'workbench', fontSize: 13, lineHeight: 21, fontFamily: '"SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace', automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', padding: { top: 14, bottom: 14 }, renderLineHighlight: 'line', roundedSelection: true, tabSize: 2, smoothScrolling: true, cursorSmoothCaretAnimation: 'on', scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 } });
    ide.editor.onDidChangeModelContent(() => markDocumentChanged(ide.editor.getValue()));
    ide.editor.onDidChangeCursorPosition(event => { $('#editor-position').textContent = `行 ${event.position.lineNumber}，列 ${event.position.column}`; });
    ide.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveDocument());
    ide.editor.addAction({ id: 'workbench.reference-selection', label: '把选中内容发到对话', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL], contextMenuGroupId: 'navigation', contextMenuOrder: 0, run: () => referenceSelection() });
    ide.editor.addAction({ id: 'workbench.reference-file', label: '在对话中引用此文件', contextMenuGroupId: 'navigation', contextMenuOrder: 1, run: () => { const doc = currentDocument(); if (doc) referenceFile(doc.path); } });
    renderEditor(); return ide.editor;
  }).catch(error => { ide.monacoLoading = null; toast(error.message, true); return null; }); return ide.monacoLoading;
}
async function openWorkspace() { if (activityVisible() && !matchMedia('(min-width: 1700px)').matches && !narrowLayout()) { ui.activitySuspended = true; layoutActivity(); } ide.workspaceOpen = true; $('#workspace-panel').hidden = false; $('.ide-body').classList.add('with-workspace'); $('#workspace-toggle').classList.add('active'); await ensureSession(); await loadDirectory(); loadMonaco(); }
function closeWorkspace({ keepActivity = false } = {}) { ide.workspaceOpen = false; $('#workspace-panel').hidden = true; $('.ide-body').classList.remove('with-workspace'); $('#workspace-toggle').classList.remove('active'); if (!keepActivity && ui.activitySuspended) { ui.activitySuspended = false; layoutActivity(); renderActivity(); } }
// Files Claude wrote or edited in this session, for markers in the tree and tabs.
function claudeTouched(session) { const map = new Map(); for (const t of session?.tools || []) { if (!fileTools.has(t.name) || !doneStatuses.has(t.status)) continue; const rel = relPath(toolPath(t), session.id); if (rel) map.set(rel, t.createdAt); } return map; }
function renderFileTree(truncated) {
  const touched = claudeTouched(state.session), active = currentDocument()?.path, dirs = new Set([...touched.keys()].flatMap(p => p.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
  $('#explorer-path').innerHTML = `<button data-directory="">工作区</button>${ide.directory ? ide.directory.split('/').map((part, i, parts) => `<span>/</span><button data-directory="${escape(parts.slice(0, i + 1).join('/'))}">${escape(part)}</button>`).join('') : ''}`;
  const rows = [...ide.entries].sort((a, b) => (isDirectory(b) ? 1 : 0) - (isDirectory(a) ? 1 : 0) || a.name.localeCompare(b.name)).map(entry => { const dir = isDirectory(entry), mark = touched.has(entry.path) || (dir && dirs.has(entry.path)); return `<div class="file-tree-row${dir ? ' is-dir' : ''}${entry.path === active ? ' active' : ''}"><button class="file-tree-main" data-file-path="${escape(entry.path)}" data-file-type="${escape(entry.type)}" title="${escape(entry.path)}"><span class="file-tree-icon">${icon(dir ? 'folder' : 'file')}</span><span class="file-tree-name">${escape(entry.name)}</span>${mark ? '<i class="claude-mark" title="Claude 在本会话中修改过"></i>' : ''}${finite(entry.size) && !dir ? `<small>${bytes(entry.size)}</small>` : ''}</button>${dir ? '' : `<button class="row-action" data-reference-path="${escape(entry.path)}" title="在对话中引用" aria-label="在对话中引用 ${escape(entry.name)}">${icon('at')}</button>`}</div>`; });
  $('#file-tree').innerHTML = rows.length ? rows.join('') + (truncated ? '<div class="explorer-empty">列表过长，仅显示部分文件。</div>' : '') : '<div class="explorer-empty">这里还没有文件。<br>新建或上传一个文件开始。</div>';
}
async function loadDirectory(path = ide.directory, { quiet = false } = {}) {
  if (!state.activeId) { $('#file-tree').innerHTML = '<div class="explorer-empty">打开工作区后即可浏览文件。</div>'; return; }
  const id = state.activeId; const request = ++ide.fileRequest; ide.directory = path || '';
  if (!quiet) { ide.explorer = 'files'; $('#file-search-box').hidden = true; $$('[data-explorer-tab]').forEach(b => b.classList.toggle('active', b.dataset.explorerTab === 'files')); $('#file-tree').innerHTML = '<div class="explorer-empty">正在读取文件…</div>'; }
  try { const result = await api(sessionApi(`files?path=${encodeURIComponent(ide.directory)}`, id)); if (request !== ide.fileRequest || id !== state.activeId) return; ide.entries = result.entries || []; if (ide.explorer === 'files') renderFileTree(result.truncated); }
  catch (error) { if (request === ide.fileRequest && !quiet) $('#file-tree').innerHTML = `<div class="explorer-empty">${escape(error.message)}</div>`; }
}
async function openFile(path, { reload = false, line } = {}) {
  const id = state.activeId; if (!id) return; const key = documentKey(id, path); let doc = ide.documents.get(key);
  if (!doc || reload) { const result = await api(sessionApi(`file?path=${encodeURIComponent(path)}`, id)); if (id !== state.activeId) return; const fields = { ...result, text: result.text || '', savedText: result.text || '', sessionId: id, path, dirty: false, conflict: false, conflictReason: null, missing: false }; if (doc) Object.assign(doc, fields); else { doc = fields; ide.documents.set(key, doc); } }
  ide.activeDocument = key; ui.activeDocBySession.set(id, key); ide.preview = false; renderEditor(); if (ide.workspaceOpen && ide.explorer === 'files') renderFileTree();
  loadMonaco().then(editor => { if (editor && line && ide.activeDocument === key) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); editor.focus(); } });
}
async function openPath(rel, { line } = {}) {
  if (rel == null || !state.activeId) return;
  if (!ide.workspaceOpen) await openWorkspace();
  try { await openFile(rel, { line: Number(line) || undefined }); } catch (error) { toast(error.status === 404 ? `工作区里没有找到 ${rel}` : error.message, true); }
}
function renderEditorTabs() { $('#editor-tabs').innerHTML = [...ide.documents].filter(([, doc]) => doc.sessionId === state.activeId).map(([key, doc]) => `<div class="editor-tab${key === ide.activeDocument ? ' active' : ''}${doc.syncedAt && Date.now() - doc.syncedAt < 120000 ? ' synced' : ''}"><button data-open-document="${escape(key)}" title="${escape(doc.path)}"><span>${icon('file')}</span>${escape(doc.path.split('/').at(-1))}${doc.dirty ? '<i title="未保存修改"></i>' : doc.syncedAt && Date.now() - doc.syncedAt < 120000 ? '<b title="已同步 Claude 的修改"></b>' : ''}</button><button data-close-document="${escape(key)}" aria-label="关闭文件">${icon('close')}</button></div>`).join(''); }
function modelFor(doc) { if (!globalThis.monaco?.editor) return null; if (!doc.model || doc.model.isDisposed()) doc.model = monaco.editor.createModel(doc.text, languageFor(doc.path)); return doc.model; }
function renderEditor() {
  const doc = currentDocument(); renderEditorTabs(); $('#editor-empty').hidden = Boolean(doc); $('#editor-stage').hidden = !doc;
  $('#file-conflict').hidden = !doc?.conflict && !doc?.missing; $('#file-conflict-text').textContent = doc?.missing ? '这个文件已在服务器上被删除或移动。你的编辑仍保留，可另存为新文件。' : doc?.conflictReason === 'remote' ? 'Claude 或终端修改了这个文件。你的编辑仍保留，可以载入服务器版本或另存为。' : '服务器上的文件已变化。你的编辑仍保留。';
  $('#file-reload').hidden = Boolean(doc?.missing);
  $('#editor-path').textContent = doc?.path || '选择文件开始编辑'; $('#editor-path').title = doc?.path || ''; $('#file-save').disabled = !doc?.dirty || doc?.readOnly; $('#file-reference').disabled = !doc; $('#selection-reference').disabled = !doc; $('#file-download').disabled = !doc; $('#editor-preview-toggle').disabled = !doc || languageFor(doc.path) !== 'markdown'; $('#editor-language').textContent = doc ? languageFor(doc.path) : '未打开文件';
  $('#editor-save-status').textContent = !doc ? '保存时检查版本冲突' : doc.readOnly ? '只读文件' : doc.dirty ? '有未保存的修改' : doc.syncedAt && Date.now() - doc.syncedAt < 120000 ? `已同步 Claude 的修改 · ${time(doc.syncedAt)}` : '已保存';
  if (!doc) return; ide.syncingEditor = true; $('#code-editor').value = doc.text; $('#code-editor').readOnly = Boolean(doc.readOnly);
  if (ide.editor) {
    const model = modelFor(doc), previous = ide.editor.getModel();
    if (previous !== model) { const prevDoc = [...ide.documents.values()].find(d => d.model === previous); if (prevDoc) prevDoc.viewState = ide.editor.saveViewState(); ide.editor.setModel(model); if (doc.viewState) ide.editor.restoreViewState(doc.viewState); }
    else if (model.getValue() !== doc.text) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: doc.text }], () => null);
    ide.editor.updateOptions({ readOnly: Boolean(doc.readOnly) });
  }
  ide.syncingEditor = false; $('#code-editor').hidden = ide.preview || Boolean(ide.editor); $('#monaco-editor').hidden = ide.preview || !ide.editor; $('#markdown-preview').hidden = !ide.preview; if (ide.preview) { $('#markdown-preview').innerHTML = safeMarkdown(doc.text); enhanceMarkdown($('#markdown-preview')); } $('#editor-preview-toggle').classList.toggle('active', ide.preview);
}
async function saveDocument() { const doc = currentDocument(); if (!doc || !doc.dirty || doc.readOnly) return; $('#file-save').disabled = true; const submitted = doc.text; try { const result = await api(sessionApi(`file?path=${encodeURIComponent(doc.path)}`, doc.sessionId), { method: 'PUT', body: { path: doc.path, text: submitted, hash: doc.missing ? null : doc.hash ?? null } }); doc.hash = result.hash; doc.savedText = submitted; doc.dirty = doc.text !== submitted; doc.conflict = false; doc.missing = false; doc.syncedAt = null; renderEditor(); toast('文件已保存。'); if (ide.workspaceOpen && ide.explorer === 'files') loadDirectory(undefined, { quiet: true }); } catch (error) { if (error.status === 409) { doc.conflict = true; doc.conflictReason = doc.conflictReason || 'save'; renderEditor(); } else toast(error.message, true); } finally { $('#file-save').disabled = !doc.dirty; } }
// Claude, a Bash step or the terminal changed files: refresh the tree and reconcile open tabs without losing edits.
function detectWorkspaceChanges(previous, next) {
  const before = new Map((previous.tools || []).map(t => [t.id, t.status])); const paths = new Set(); let broad = false;
  for (const t of next.tools || []) {
    if (!doneStatuses.has(t.status) || doneStatuses.has(before.get(t.id))) continue;
    if (fileTools.has(t.name)) { const rel = relPath(toolPath(t), next.id); if (rel) paths.add(rel); } else if (['Bash', 'BashOutput', 'Task', 'Agent'].includes(t.name) || t.name?.startsWith('mcp__')) broad = true;
  }
  if (running(previous) && !running(next)) broad = true;
  if (paths.size || broad) scheduleWorkspaceSync(broad ? null : paths);
}
function scheduleWorkspaceSync(paths) {
  if (paths === null) ui.syncAll = true; else { ui.syncPaths ||= new Set(); for (const p of paths) ui.syncPaths.add(p); }
  clearTimeout(ui.syncTimer); ui.syncTimer = setTimeout(runWorkspaceSync, 450);
}
async function runWorkspaceSync() {
  const all = ui.syncAll, paths = ui.syncPaths; ui.syncAll = false; ui.syncPaths = null;
  if (!state.activeId) return;
  if (ide.workspaceOpen) { if (ide.explorer === 'files') loadDirectory(ide.directory, { quiet: true }); else if (ide.explorer === 'git') loadGit({ quiet: true }); }
  const id = state.activeId;
  for (const [key, doc] of ide.documents) {
    if (doc.sessionId !== id || doc.readOnly || (!all && !paths?.has(doc.path))) continue;
    try {
      const fresh = await api(sessionApi(`file?path=${encodeURIComponent(doc.path)}`, id)); if (id !== state.activeId) return;
      if (fresh.hash === doc.hash) continue;
      if (doc.dirty) { doc.conflict = true; doc.conflictReason = 'remote'; }
      else { Object.assign(doc, { text: fresh.text, savedText: fresh.text, hash: fresh.hash, size: fresh.size, modifiedAt: fresh.modifiedAt, conflict: false, missing: false, syncedAt: Date.now() }); }
    } catch (error) { if (error.status === 404) doc.missing = true; else continue; }
    if (key === ide.activeDocument) renderEditor(); else renderEditorTabs();
  }
}
function openPathDialog(action) { ide.pathAction = action; $('#path-dialog-title').textContent = ({ file: '新建文件', directory: '新建文件夹', saveAs: '将当前编辑另存为' })[action]; $('#path-input').value = action === 'saveAs' ? currentDocument()?.path || '' : (ide.directory ? `${ide.directory}/` : ''); $('#path-dialog').showModal(); $('#path-input').focus(); }
function focusComposer() { if (ide.workspaceOpen && matchMedia('(max-width: 980px)').matches) closeWorkspace(); switchView('chat'); const input = $('#message-input'); input.focus(); resizeInput(); preserveDraft(); updateControls(); }
function referenceFile(path) { const list = ide.attachments.get(state.activeId) || []; if (!list.some(f => f.path === path)) list.push({ path }); ide.attachments.set(state.activeId, list); renderAttachments(); focusComposer(); }
function insertIntoComposer(text) { const input = $('#message-input'), start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? input.value.length, before = input.value.slice(0, start); const prefix = before && !before.endsWith('\n') ? '\n\n' : ''; input.setRangeText(`${prefix}${text}`, start, end, 'end'); focusComposer(); }
function referenceSelection() {
  const doc = currentDocument(); if (!doc) return; let text = '', start = 1, end = 1;
  if (ide.editor && !$('#monaco-editor').hidden) { const selection = ide.editor.getSelection(), model = ide.editor.getModel(); if (selection && !selection.isEmpty()) { text = model.getValueInRange(selection); start = selection.startLineNumber; end = selection.endLineNumber; } }
  else { const area = $('#code-editor'); if (area.selectionStart !== area.selectionEnd) { text = area.value.slice(area.selectionStart, area.selectionEnd); start = area.value.slice(0, area.selectionStart).split('\n').length; end = start + text.split('\n').length - 1; } }
  if (!text.trim()) { referenceFile(doc.path); toast('没有选中内容，已引用整个文件。'); return; }
  const language = languageFor(doc.path), clipped = text.length > 8000 ? `${text.slice(0, 8000)}\n…（选中内容较长，已截断）` : text;
  insertIntoComposer(`${doc.path} 第 ${start}${end > start ? `–${end}` : ''} 行：\n\`\`\`${language === 'plaintext' ? '' : language}\n${clipped.replace(/```/g, '``​`')}\n\`\`\`\n`);
}
function renderAttachments() { const items = ide.attachments.get(state.activeId) || []; $('#attachment-list').hidden = !items.length; $('#attachment-list').innerHTML = items.map(file => `<span class="attachment-chip">${icon('file')}<button type="button" class="attachment-open" data-open-path="${escape(file.path)}" title="${escape(file.path)}">${escape(file.path.split('/').at(-1))}</button><button type="button" data-remove-attachment="${escape(file.path)}" aria-label="移除文件引用">${icon('close')}</button></span>`).join(''); }
async function uploadFiles(files) { const id = await ensureSession(); for (const file of files) { if (file.size > 8 * 1024 * 1024) { toast(`${file.name} 超过 8 MB 上传限制。`, true); continue; } try { const array = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let i = 0; i < array.length; i += 32768) binary += String.fromCharCode(...array.subarray(i, i + 32768)); const path = `${ide.directory ? `${ide.directory}/` : ''}${file.name}`; await api(sessionApi('upload', id), { method: 'POST', body: { path, base64: btoa(binary), hash: null } }); if (id === state.activeId) referenceFile(path); toast(`已上传 ${file.name}`); } catch (error) { toast(`${file.name}：${error.message}`, true); } } if (ide.workspaceOpen) loadDirectory(undefined, { quiet: true }); }
function pastedName(file) { if (file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file; const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date()).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2'); const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg'); return new File([file], `paste-${stamp}.${ext}`, { type: file.type }); }
function downloadBlob(name, content, mime = 'text/plain;charset=utf-8') { const url = URL.createObjectURL(new Blob([content], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
async function exportSession() { if (!state.activeId) { toast('先创建一个会话。'); return; } try { const data = await api(sessionApi('export')); downloadBlob(`${state.session?.title || 'claude-session'}.json`, JSON.stringify(data, null, 2), 'application/json'); } catch (error) { toast(error.message, true); } }
async function searchFiles(query) { if (!state.activeId || !query.trim()) return; $('#file-tree').innerHTML = '<div class="explorer-empty">正在搜索…</div>'; try { const result = await api(sessionApi(`search?q=${encodeURIComponent(query)}`)); $('#file-tree').innerHTML = result.matches?.length ? `<div class="explorer-count">${result.matches.length} 处匹配${result.truncated ? '（部分）' : ''}</div>` + result.matches.map(match => `<button class="file-search-result" data-search-path="${escape(match.path)}" data-search-line="${match.line}"><strong>${escape(match.path)}<small>:${match.line}</small></strong><span>${escape(match.text)}</span></button>`).join('') + (result.truncated ? '<div class="explorer-empty">仅显示部分结果，请缩小搜索范围。</div>' : '') : '<div class="explorer-empty">没有匹配的内容。</div>'; } catch (error) { $('#file-tree').innerHTML = `<div class="explorer-empty">${escape(error.message)}</div>`; } }
const gitLabels = { M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', U: '冲突', '?': '未跟踪' };
async function loadGit({ quiet = false } = {}) { if (!state.activeId) return; if (!quiet) $('#file-tree').innerHTML = '<div class="explorer-empty">正在读取 Git 状态…</div>'; try { const result = await api(sessionApi('git')); if (ide.explorer !== 'git') return; $('#explorer-path').innerHTML = `<span class="git-branch">${icon('branch')}${escape(result.branch || 'Git')}</span>`; $('#file-tree').innerHTML = !result.available ? '<div class="explorer-empty">此工作区尚未初始化 Git。</div>' : result.entries?.length ? result.entries.map(entry => { const code = (entry.status || '').replace(/\s/g, '').charAt(0) || 'M'; return `<div class="file-tree-row git-row"><button class="file-tree-main" data-git-path="${escape(entry.path || entry.file || '')}" title="查看差异"><span class="git-status s-${escape(code === '?' ? 'u' : code.toLowerCase())}">${escape(code === '?' ? 'U' : code)}</span><span class="file-tree-name">${escape(entry.path || entry.file || jsonText(entry))}</span><small>${escape(gitLabels[code] || entry.status || '')}</small></button></div>`; }).join('') : '<div class="explorer-empty">工作区干净，没有未提交更改。</div>'; } catch (error) { if (!quiet) $('#file-tree').innerHTML = `<div class="explorer-empty">${escape(error.message)}</div>`; } }
async function openDiff(path) { try { const result = await api(sessionApi(`diff?path=${encodeURIComponent(path)}`)); const key = documentKey(state.activeId, `diff:${path}`); const existing = ide.documents.get(key); const fields = { sessionId: state.activeId, path: `${path}.diff`, text: result.diff || (result.untrackedPaths?.includes(path) ? '这是一个未跟踪的新文件，暂无差异可显示。' : '没有可显示的差异。'), savedText: result.diff || '', readOnly: true, dirty: false }; if (existing) Object.assign(existing, fields); else ide.documents.set(key, fields); ide.activeDocument = key; ide.preview = false; renderEditor(); loadMonaco(); } catch (error) { toast(error.message, true); } }

/* ---------- Terminal ---------- */
async function refreshTerminals() { const result = await api('/api/terminals'); const list = Array.isArray(result) ? result : result.terminals || []; const terminal = list.find(t => t.status === 'running') || list.at(-1) || null; const changed = terminal?.id !== ide.terminal?.id; const wasRunning = ide.terminal?.status === 'running'; ide.terminal = terminal; if (terminal?.status !== 'running') ide.terminalStopping = false; if (terminal?.kind) ide.terminalKind = terminal.kind; if (wasRunning && terminal?.status !== 'running') scheduleWorkspaceSync(null); renderTerminal(); updateControls(); if (terminal?.status === 'running' && (changed || !ide.terminalSource) && !$('#terminal-panel').hidden) attachTerminal(); }
function renderTerminal() {
  const terminal = ide.terminal; const active = terminal?.status === 'running';
  $('#terminal-status').textContent = active ? `${terminal.kind === 'claude' ? 'Claude' : 'Shell'} · ${ide.terminalStopping ? '正在结束' : '运行中'}` : terminal ? `已结束${finite(terminal.exitCode) ? ` · ${terminal.exitCode}` : ''}` : '尚未连接';
  $('#terminal-status').classList.toggle('live', active);
  $('#terminal-stop').disabled = !active || ide.terminalStopping; $('#terminal-stop').textContent = ide.terminalStopping ? '正在结束…' : '结束进程';
  $('#start-shell').disabled = ide.terminalStarting || running(state.session) || active || Boolean(loginInProgress()) || state.accountSwitchPending; $('#start-claude').disabled = ide.terminalStarting || running(state.session) || active || Boolean(loginInProgress()) || !accountReady() || state.accountSwitchPending;
  $('#shell-terminal').classList.toggle('active', ide.terminalKind === 'shell'); $('#claude-terminal').classList.toggle('active', ide.terminalKind === 'claude');
  $('#terminal-empty').hidden = Boolean(terminal && ide.xterm); $('#terminal-host').hidden = !(terminal && ide.xterm);
  const foreign = active && terminal.sessionId && terminal.sessionId !== state.activeId, ended = terminal && !active && ide.xterm;
  $('#terminal-notice').innerHTML = ended ? `${icon('info')}<span>上一个${terminal.kind === 'claude' ? '原生 Claude' : ' Shell'} 进程已结束${finite(terminal.exitCode) ? `（退出码 ${terminal.exitCode}）` : ''}，工作区文件已同步。</span><button type="button" data-start-terminal="shell">新开 Shell</button><button type="button" data-start-terminal="claude">原生 Claude</button>` : foreign ? `${icon('info')}<span>这个终端属于「${escape(titleOf(terminal.sessionId))}」，工作目录也是那个会话的。</span><button type="button" data-goto-session="${escape(terminal.sessionId)}">切换到该会话</button>` : `${icon('info')}<span>${terminal?.kind === 'claude' ? '原生 Claude 共用工作区；终端消息不自动进入图形记录。' : '终端共用当前工作区；终端消息显示在此。'}${active ? '结束终端进程后可恢复图形对话，文件会自动同步。' : '同一会话的图形对话与终端不能同时运行。'}</span>`;
  $('#terminal-notice').classList.toggle('foreign', Boolean(foreign)); $('#terminal-notice').classList.toggle('ended', Boolean(ended));
  $$('[data-start-terminal]', $('#terminal-notice')).forEach(button => { button.disabled = ide.terminalStarting || running(state.session) || Boolean(loginInProgress()) || (button.dataset.startTerminal === 'claude' && !accountReady()); });
}
async function openTerminal(kind = ide.terminalKind) { $('#terminal-panel').hidden = false; $('#terminal-toggle').classList.add('active'); ide.terminalKind = kind; await refreshTerminals(); renderTerminal(); if (ide.terminal) attachTerminal(); }
function setupXterm() { if (ide.xterm) return; if (!globalThis.Terminal) throw new Error('终端组件尚未加载，请刷新页面。'); ide.xterm = new Terminal({ cursorBlink: true, fontSize: 13, lineHeight: 1.3, fontFamily: '"SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace', scrollback: 8000, convertEol: false, allowProposedApi: false, theme: xtermTheme(themes.current) }); if (globalThis.FitAddon?.FitAddon) { ide.fit = new FitAddon.FitAddon(); ide.xterm.loadAddon(ide.fit); } ide.xterm.open($('#terminal-host')); ide.xterm.onData(data => { if (ide.terminal?.status !== 'running') return; ide.inputBuffer += data; if (!ide.inputTimer) ide.inputTimer = setTimeout(flushTerminalInput, 20); }); }
async function fitTerminal() { if (!ide.xterm || $('#terminal-panel').hidden) return; try { ide.fit?.fit(); if (ide.terminal?.status === 'running') await api(`/api/terminals/${encodeURIComponent(ide.terminal.id)}/resize`, { method: 'POST', body: { cols: Math.max(40, Math.min(240, ide.xterm.cols || 100)), rows: Math.max(10, Math.min(100, ide.xterm.rows || 24)) } }); } catch {} }
function attachTerminal() { if (!ide.terminal) return; try { setupXterm(); } catch (error) { toast(error.message, true); return; } renderTerminal(); if (ide.terminalSource && ide.terminalSource.terminalId === ide.terminal.id) { fitTerminal(); return; } ide.terminalSource?.close(); ide.xterm.reset(); const terminalId = ide.terminal.id; const source = new EventSource(`/api/terminals/${encodeURIComponent(terminalId)}/events`); source.terminalId = terminalId; ide.terminalSource = source; source.onopen = () => { $('#terminal-status').textContent = `${ide.terminal?.kind === 'claude' ? 'Claude' : 'Shell'} · 已连接`; fitTerminal(); }; source.onmessage = event => { let data; try { data = JSON.parse(event.data); } catch { return; } if (data.type === 'output') ide.xterm?.write(data.data || ''); if (data.type === 'exit') { ide.terminalStopping = false; ide.terminal = { ...ide.terminal, status: 'exited', exitCode: data.code }; source.close(); ide.terminalSource = null; renderTerminal(); updateControls(); scheduleWorkspaceSync(null); if (state.activeId) refreshSession().catch(() => {}); } }; source.onerror = () => { $('#terminal-status').textContent = '连接中断，正在重连'; }; fitTerminal(); }
async function flushTerminalInput() { ide.inputTimer = null; if (ide.inputPending || !ide.inputBuffer || ide.terminal?.status !== 'running') return; const data = ide.inputBuffer; ide.inputBuffer = ''; const id = ide.terminal.id; ide.inputPending = true; try { await api(`/api/terminals/${encodeURIComponent(id)}/input`, { method: 'POST', body: { data } }); } catch (error) { toast(`终端输入未确认送达：${error.message}。为避免重复执行，未自动重发。`, true); } finally { ide.inputPending = false; if (ide.inputBuffer) ide.inputTimer = setTimeout(flushTerminalInput, 20); } }
async function startTerminal(kind, command) { if (ide.terminalStarting || state.accountSwitchPending) return; if (kind === 'claude' && !accountReady()) { toast('请先登录 Claude 账号后再启动终端。', true); return; } if (ide.terminal?.status === 'running') { await openTerminal(); if (ide.terminal.kind !== kind) toast('已有终端进程运行，请先结束当前进程。'); return; } ide.terminalStarting = true; try { const sessionId = await ensureSession(); $('#terminal-panel').hidden = false; $('#terminal-toggle').classList.add('active'); ide.terminalKind = kind; setupXterm(); $('#terminal-host').hidden = false; ide.fit?.fit(); const terminal = await api('/api/terminals', { method: 'POST', body: { sessionId, kind, cols: Math.max(40, Math.min(240, ide.xterm.cols || 100)), rows: Math.max(10, Math.min(100, ide.xterm.rows || 24)) } }); ide.terminal = terminal.terminal || terminal; attachTerminal(); if (command) toast(`已打开原生 Claude，请输入 ${command}。`); } catch (error) { toast(error.message, true); } finally { ide.terminalStarting = false; renderTerminal(); updateControls(); } }
async function stopTerminal() { if (!ide.terminal || ide.terminal.status !== 'running' || ide.terminalStopping) return; ide.terminalStopping = true; renderTerminal(); try { await api(`/api/terminals/${encodeURIComponent(ide.terminal.id)}/stop`, { method: 'POST', body: {} }); await refreshTerminals(); toast(ide.terminal?.status === 'running' ? '正在结束终端进程，请等待退出。' : '终端进程已结束。'); } catch (error) { ide.terminalStopping = false; renderTerminal(); toast(error.message, true); } }
function closeTerminalPanel() { $('#terminal-panel').hidden = true; $('#terminal-toggle').classList.remove('active'); }
function toggleTerminalPanel() { return $('#terminal-panel').hidden ? openTerminal() : closeTerminalPanel(); }

/* ---------- Command palette ---------- */
const commandGroups = ['操作', '插件', '会话', '外观', '已打开的文件', '工作区文件', '原生命令'];
function commandsList() {
  const inRun = running(state.session), doc = currentDocument();
  const setMode = mode => async () => { $('#mode-select').value = mode; if (state.activeId) await changeSession(state.activeId, { permissionMode: mode }); updateControls(); };
  const list = [
    { id: 'new', title: '开启新会话', subtitle: '保存当前草稿并开始新对话', icon: 'plus', slash: '/new', run: newSessionView },
    ...(inRun ? [{ id: 'stop', title: '停止当前任务', subtitle: 'Claude 正在工作，发送停止请求', icon: 'square', slash: '/stop', run: () => $('#stop-button').click() }] : []),
    { id: 'files', title: ide.workspaceOpen ? '关闭工作区文件' : '打开工作区文件', subtitle: '浏览、编辑、预览与保存', icon: 'folder', slash: '/files', run: () => ide.workspaceOpen ? closeWorkspace() : openWorkspace() },
    { id: 'git', title: '查看 Git 变更', subtitle: '工作区的只读状态与差异', icon: 'branch', slash: '/git', run: async () => { if (!ide.workspaceOpen) await openWorkspace(); $('[data-explorer-tab="git"]').click(); } },
    { id: 'terminal', title: '打开 Shell 终端', subtitle: '直接操作当前会话工作区', icon: 'terminal', slash: '/terminal', run: () => openTerminal('shell') },
    { id: 'claude', title: '打开原生 Claude Code', subtitle: '完整原生命令与交互 · 共用工作区', icon: 'sparkles', slash: '/claude', run: () => openTerminal('claude') },
    ...(doc ? [{ id: 'quote', title: '把选中内容发到对话', subtitle: `${doc.path} · ⌘ / Ctrl Shift L`, icon: 'message-plus', slash: '/quote', run: referenceSelection }] : []),
    { id: 'usage', title: '刷新官方订阅额度', subtitle: '5 小时用量、周剩余额度与重置时间', icon: 'activity', slash: '/usage', run: refreshUsage },
    { id: 'activity', title: activityVisible() ? '收起执行过程' : '打开执行过程', subtitle: '每一步命令、读写与文件变更 · 对话区只留摘要', icon: 'steps', slash: '/steps', run: () => setActivityOpen(!activityVisible()) },
    { id: 'steps-inline', title: ui.stepsInline ? '步骤改回侧栏显示' : '在对话中逐条展开步骤', subtitle: ui.stepsInline ? '对话区每段工作只保留一行摘要' : '旧版样式：命令、编辑等步骤直接列在回复之间', icon: 'list', run: () => setStepsInline(!ui.stepsInline) },
    { id: 'monitor', title: '打开运行监控', subtitle: 'Token、上下文、文件与子任务轨迹', icon: 'activity', slash: '/monitor', run: () => switchView('monitor') },
    { id: 'auto', title: '切换为自动同意', subtitle: '普通工具无需逐次确认 · 提问仍会等你', icon: 'check', slash: '/auto', run: setMode('bypassPermissions') },
    { id: 'confirm', title: '切换为逐次确认', subtitle: '每次工具操作前请你批准', icon: 'shield', slash: '/confirm', run: setMode('default') },
    { id: 'plan', title: '切换只读计划模式', subtitle: '先分析与规划，再决定执行', icon: 'shield', slash: '/plan', run: setMode('plan') },
    { id: 'notify', title: ui.notify ? '关闭桌面通知' : '开启桌面通知', subtitle: '任务完成或需要确认时在后台提醒', icon: 'bell', slash: '/notify', run: toggleNotifications },
    { id: 'export', title: '导出当前会话', subtitle: '下载 JSON 会话记录', icon: 'download', slash: '/export', run: exportSession },
    { id: 'upload', title: '上传附件', subtitle: '上传到当前工作区并在消息中引用', icon: 'upload', slash: '/attach', run: () => $('#attachment-input').click() },
    { id: 'workshop', title: '打开创意工坊', subtitle: '发现、安装和管理插件与皮肤', icon: 'store', slash: '/workshop', run: () => workshop.open() },
    { id: 'skins', title: '更换皮肤', subtitle: `当前：${themes.pref === 'auto' ? '跟随系统' : themes.current?.name || '默认'} · 输入「皮肤」可直接切换`, icon: 'palette', slash: '/skin', run: () => workshop.open('skins') },
  ].map(c => ({ ...c, group: '操作' }));
  for (const command of plugins.commands()) list.push({ ...command, group: '插件' });
  if (!safeMode) for (const theme of [{ id: 'auto', name: '跟随系统', description: '随系统深浅色在云杉与墨夜之间切换' }, ...themes.list()]) list.push({ id: `theme:${theme.id}`, group: '外观', title: `皮肤：${theme.name}`, subtitle: `${(themes.pref === 'auto' ? theme.id === 'auto' : theme.id === themes.pref) ? '当前 · ' : ''}${theme.description || ''}`, icon: 'palette', run: () => setTheme(theme.id) });
  for (const s of state.sessions.filter(s => !s.archived && s.id !== state.activeId).slice(0, 30)) list.push({ id: `session:${s.id}`, group: '会话', title: s.title || '未命名会话', subtitle: `${statusText[s.status] || '就绪'} · ${relativeTime(s.updatedAt || s.createdAt)}`, icon: 'message', run: () => selectSession(s.id) });
  for (const [key, d] of ide.documents) if (d.sessionId === state.activeId) list.push({ id: `doc:${key}`, group: '已打开的文件', title: d.path.split('/').at(-1), subtitle: d.path, icon: 'file', run: async () => { if (!ide.workspaceOpen) await openWorkspace(); ide.activeDocument = key; ui.activeDocBySession.set(state.activeId, key); renderEditor(); } });
  for (const entry of ide.entries) if (!isDirectory(entry) && !ide.documents.has(documentKey(state.activeId, entry.path))) list.push({ id: `file:${entry.path}`, group: '工作区文件', title: entry.name, subtitle: entry.path, icon: 'file', run: () => openPath(entry.path) });
  const official = state.session?.capabilities?.commands || [];
  const names = new Set(list.map(c => c.slash).filter(Boolean));
  for (const raw of official) { const name = typeof raw === 'string' ? raw : raw.name || raw.command; if (!name) continue; const slash = name.startsWith('/') ? name : `/${name}`; if (names.has(slash)) continue; names.add(slash); list.push({ id: `native:${name}`, group: '原生命令', title: slash, subtitle: `${raw.description || 'Claude Code 原生命令'} · 在原生终端运行`, icon: 'terminal', slash, native: true, run: () => startTerminal('claude', slash) }); }
  for (const name of ['/model', '/permissions', '/compact', '/context', '/memory', '/mcp', '/agents', '/config', '/help']) if (!names.has(name)) list.push({ id: `native:${name}`, group: '原生命令', title: name, subtitle: 'Claude Code 原生命令 · 在原生终端运行', icon: 'terminal', slash: name, native: true, run: () => startTerminal('claude', name) });
  return list;
}
function renderCommands() {
  const query = $('#command-query').value.trim().toLowerCase();
  const rank = c => !query ? 0 : c.slash === query || c.title.toLowerCase() === query ? 0 : c.slash?.startsWith(query) || c.title.toLowerCase().startsWith(query) ? 1 : 2;
  ide.commands = commandsList().filter(c => `${c.title} ${c.subtitle} ${c.slash || ''}`.toLowerCase().includes(query)).sort((a, b) => rank(a) - rank(b) || (query ? 0 : commandGroups.indexOf(a.group) - commandGroups.indexOf(b.group)));
  if (!query) ide.commands = ide.commands.filter((c, i, all) => c.group !== '外观' && (c.group !== '原生命令' || all.slice(0, i).filter(x => x.group === '原生命令').length < 6));
  ide.commandIndex = Math.min(ide.commandIndex, Math.max(0, ide.commands.length - 1)); let group = null;
  $('#command-results').innerHTML = ide.commands.length ? ide.commands.map((command, index) => { const header = !query && command.group !== group ? `<div class="command-group">${escape(command.group)}</div>` : ''; group = command.group; return `${header}<button class="command-result${index === ide.commandIndex ? ' selected' : ''}" data-command-index="${index}"><span>${icon(command.icon)}</span><span><strong>${escape(command.title)}</strong><small>${escape(command.subtitle)}</small></span>${command.slash ? `<kbd>${escape(command.slash)}</kbd>` : ''}</button>`; }).join('') : '<div class="explorer-empty">没有找到匹配的命令。</div>';
}
function openCommands() { $('#command-query').value = ''; ide.commandIndex = 0; renderCommands(); $('#command-dialog').showModal(); $('#command-query').focus(); }
async function executeCommand(command) { if (!command) return; if ($('#command-dialog').open) $('#command-dialog').close(); $('#slash-menu').hidden = true; try { await command.run(); } catch (error) { toast(error.message, true); } }
function renderSlashMenu() { const value = $('#message-input').value; if (!/^\/[^\s]*$/.test(value)) { $('#slash-menu').hidden = true; return; } const commands = commandsList().filter(c => c.slash?.startsWith(value)); $('#slash-menu').hidden = !commands.length; $('#slash-menu').innerHTML = commands.slice(0, 10).map(command => `<button data-slash-command="${escape(command.id)}"><strong>${escape(command.slash)}</strong><span>${escape(command.title === command.slash ? command.subtitle : command.title)}</span>${command.native ? '<small>原生终端</small>' : ''}</button>`).join(''); }

/* ---------- Skins, plugins and the workshop ---------- */
// ?safe opens the workbench with the default skin and no plugins, to recover from a broken one.
const safeMode = new URLSearchParams(location.search).has('safe');
const themes = createThemeController({ safe: safeMode, onChange: onThemeChange });
const plugins = createPluginHost({
  api, icon, safe: safeMode, toast: (message, error = false) => toast(message, error), closeSidebar,
  theme: () => themes.current, usage: () => ide.usage, system: () => state.system, activeSession: () => state.session,
  version: () => state.config.version || '', currentView: () => state.view, switchView,
  openSession: id => { if (!state.sessions.some(s => s.id === id && !s.archived)) return false; switchView('chat'); selectSession(id); return true; },
  insertText: text => { switchView('chat'); insertIntoComposer(text); },
  onCatalog: data => { themes.setExtra(data.themes); workshop.refresh(); renderSafeBanner(); },
  onComposerChange: syncAccountSelection,
  onChange: () => { syncAccountSelection(); if ($('#command-dialog').open) renderCommands(); },
});
const workshop = createWorkshop({ api, toast, icon, escape, safe: safeMode, themes, plugins, setTheme, version: () => state.config.version || '' });
function setTheme(id) {
  const theme = themes.set(id);
  if (!theme) toast(safeMode ? '安全模式下固定使用默认皮肤。' : '这个皮肤暂时不可用。', true);
  return theme;
}
function onThemeChange(theme) {
  if (ide.xterm) ide.xterm.options.theme = xtermTheme(theme);
  if (globalThis.monaco?.editor && ide.editor) { monaco.editor.defineTheme('workbench', monacoTheme(theme)); monaco.editor.setTheme('workbench'); }
  plugins.themeChanged(); workshop.themeChanged();
}
function renderSafeBanner() { $('#safe-banner').hidden = !(safeMode || plugins.data?.safeMode); $('#safe-banner-text').textContent = safeMode ? '安全模式：本次没有加载插件和自定义皮肤。' : '安全模式：服务器设置了 WORKBENCH_SAFE_MODE=1，插件暂停运行。'; $('#safe-exit').hidden = !safeMode; }

/* ---------- Event wiring ---------- */
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#login-submit').disabled = true; $('#login-error').hidden = true;
  try {
    const totp = $('#login-totp').value.trim();
    const result = await api('/api/login', { method: 'POST', body: { password: $('#login-password').value, ...(totp ? { totp } : {}) } });
    await showApp(result);
  } catch (error) {
    if (['TOTP_REQUIRED', 'totp_required', 'MFA_REQUIRED'].includes(error.code) || /验证码|totp|动态口令/i.test(error.message)) { $('#totp-field').hidden = false; $('#login-totp').focus(); }
    $('#login-error').textContent = error.message; $('#login-error').hidden = false;
  } finally { $('#login-submit').disabled = false; }
});
$('#toggle-password').addEventListener('click', () => { const input = $('#login-password'); const show = input.type === 'password'; input.type = show ? 'text' : 'password'; $('#toggle-password').innerHTML = icon(show ? 'eye-off' : 'eye'); $('#toggle-password').setAttribute('aria-label', show ? '隐藏口令' : '显示口令'); });
$('#logout').addEventListener('click', async () => { try { await plugins.flush(); await api('/api/logout', { method: 'POST', body: {} }); try { Object.keys(localStorage).filter(key => key.startsWith('cloud-ops-workbench-draft:') || key === 'cloud-ops-workbench-active').forEach(key => localStorage.removeItem(key)); } catch {} state.draftLoaded = false; state.pendingSend = null; state.pendingSteer = null; $('#message-input').value = ''; showLogin(); } catch (error) { toast(error.message, true); } });
$('#new-session').addEventListener('click', newSessionView);
$('#session-search').addEventListener('input', renderSessions);
$('#toggle-archived').addEventListener('click', () => { state.archived = !state.archived; renderSessions(); });
$('#session-list').addEventListener('click', async event => {
  const item = event.target.closest('[data-session-id]'); if (!item) return;
  const id = item.dataset.sessionId; const action = event.target.closest('[data-session-action]')?.dataset.sessionAction;
  if (action === 'rename') openRename(id);
  else if (action === 'archive') { const session = state.sessions.find(s => s.id === id); try { await changeSession(id, { archived: !session.archived }); toast(session.archived ? '会话已恢复。' : '会话已归档，记录会保留。'); } catch (error) { toast(error.message, true); } }
  else await selectSession(id);
});
$('#rename-current').addEventListener('click', () => openRename(state.activeId));
$('#rename-cancel').addEventListener('click', () => $('#rename-dialog').close());
$('#rename-dialog').addEventListener('click', event => { if (event.target === $('#rename-dialog')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close(); } });
$('#rename-form').addEventListener('submit', async event => { event.preventDefault(); const title = $('#rename-input').value.trim(); if (!title) return; const button = $('#rename-form button[type="submit"]'); button.disabled = true; try { await changeSession(state.renameId, { title }); $('#rename-dialog').close(); } catch (error) { toast(error.message, true); } finally { button.disabled = false; } });
$('.view-tabs').addEventListener('click', event => { const button = event.target.closest('.view-tab'); if (button) switchView(button.dataset.tab); });
$('#mobile-menu').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#sidebar-scrim').hidden = false; syncSidebarAccess(); $('#new-session').focus(); });
$('#sidebar-scrim').addEventListener('click', closeSidebar);
$('#run-pill').addEventListener('click', scrollToLatest);
$('#workspace-path').addEventListener('click', () => { if (state.activeId && !ide.workspaceOpen) openWorkspace().catch(error => toast(error.message, true)); });
$('#message-input').addEventListener('input', () => { resizeInput(); preserveDraft(); updateControls(); renderSlashMenu(); });
$('#message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!$(running(state.session) ? '#steer-button' : '#send-button').disabled) $('#composer').requestSubmit(); } });
$('#message-input').addEventListener('paste', event => { const files = [...(event.clipboardData?.files || [])]; if (!files.length) return; event.preventDefault(); uploadFiles(files.map(pastedName)).catch(error => toast(error.message, true)); });
$('#chat-view').addEventListener('dragover', event => { if (![...(event.dataTransfer?.types || [])].includes('Files')) return; event.preventDefault(); $('#chat-view').classList.add('dragging'); });
$('#chat-view').addEventListener('dragleave', event => { if (!event.relatedTarget || !$('#chat-view').contains(event.relatedTarget)) $('#chat-view').classList.remove('dragging'); });
$('#chat-view').addEventListener('drop', event => { $('#chat-view').classList.remove('dragging'); const files = [...(event.dataTransfer?.files || [])]; if (!files.length) return; event.preventDefault(); uploadFiles(files).catch(error => toast(error.message, true)); });
$('#messages').addEventListener('click', async event => {
  if (!(event.target instanceof Element)) return;
  // Path links are added by linkPaths after sanitizing; DOMPurify strips model-supplied data attributes.
  const pathLink = event.target.closest('code.path-link[data-open-path]');
  if (pathLink) { openPath(pathLink.dataset.openPath, { line: pathLink.dataset.openLine }); return; }
  if (event.target.closest('.message-body')) return;
  const openActivity = event.target.closest('[data-open-activity]');
  if (openActivity) { revealInActivity({ activity: openActivity.dataset.openActivity }); return; }
  const toggleGroup = event.target.closest('[data-toggle-group]');
  if (toggleGroup) { const key = toggleGroup.dataset.toggleGroup; toggleRow(toggleGroup, () => { if (ui.openGroups.has(key)) ui.openGroups.delete(key); else ui.openGroups.add(key); }); return; }
  const toggleStep = event.target.closest('[data-toggle-step]');
  if (toggleStep) { const id = toggleStep.dataset.toggleStep; toggleRow(toggleStep, () => { if (ui.openSteps.has(id)) ui.openSteps.delete(id); else { ui.openSteps.add(id); keepGroupOpen(`s:${id}`); } }); return; }
  const toggleThinking = event.target.closest('[data-toggle-thinking]');
  if (toggleThinking) { const id = toggleThinking.dataset.toggleThinking, open = toggleThinking.getAttribute('aria-expanded') === 'true'; toggleRow(toggleThinking, () => { if (open) { ui.closedThinking.add(id); ui.openThinking.delete(id); } else { ui.openThinking.add(id); ui.closedThinking.delete(id); keepGroupOpen(`k:${id}`); } }); return; }
  const loadTool = event.target.closest('[data-load-tool]');
  if (loadTool) { loadFullTool(loadTool.dataset.loadTool); return; }
  const openButton = event.target.closest('[data-open-path]');
  if (openButton) { openPath(openButton.dataset.openPath, { line: openButton.dataset.openLine }); return; }
  const taskButton = event.target.closest('.task-list .task-item > button[data-task-stop]');
  if (taskButton) { stopTask(taskButton.dataset.taskStop); return; }
  const suggestion = event.target.closest('.welcome-suggestions > button[data-suggestion]');
  if (suggestion) { $('#message-input').value = suggestion.dataset.suggestion; resizeInput(); preserveDraft(); updateControls(); $('#message-input').focus(); return; }
  const copyTurn = event.target.closest('.turn-foot > button[data-copy-turn]');
  if (copyTurn) { const text = turnText(copyTurn.dataset.copyTurn); if (text && await copy(text)) toast('回复已复制。'); return; }
  const copyUser = event.target.closest('[data-copy-user]');
  if (copyUser) { const message = state.session?.messages?.find(m => m.id === copyUser.dataset.copyUser); if (message && await copy(message.text)) toast('已复制。'); return; }
  const reuse = event.target.closest('[data-reuse-message]');
  if (reuse) { const message = state.session?.messages?.find(m => m.id === reuse.dataset.reuseMessage); if (message) { $('#message-input').value = splitReferences(message.text || '').body; focusComposer(); } return; }
  const permissionButton = event.target.closest('.approval-card .approval-actions > button[data-allow]');
  if (permissionButton) {
    const card = permissionButton.closest('.approval-card[data-permission-id]'); const sessionId = state.activeId;
    if (!card || card.closest('.message-body') || !sessionId || !state.session?.permissions?.some(permission => permission.id === card.dataset.permissionId && (!permission.status || ['pending', 'awaiting_approval'].includes(permission.status)))) return;
    $$('button', card).forEach(b => b.disabled = true);
    const body = { allow: permissionButton.dataset.allow === 'true' };
    if (body.allow && card.classList.contains('question-card')) { const permission = state.session.permissions.find(p => p.id === card.dataset.permissionId); body.answers = {}; for (const field of $$('.question-field', card)) { const question = permission.input.questions[Number(field.dataset.questionIndex)]; const free = $('.question-freeform', field).value.trim(); const choices = $$('input:checked', field).map(input => input.value); const answer = [...choices, ...(free ? [free] : [])].join(', '); if (!answer) { toast('请回答每个问题后提交。'); $$('button', card).forEach(b => b.disabled = false); return; } body.answers[question.question || question.header] = answer; } }
    try { const result = await api(`/api/sessions/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(card.dataset.permissionId)}`, { method: 'POST', body }); if (sessionId === state.activeId) acceptSession(result); }
    catch (error) { toast(error.message, true); $$('button', card).forEach(b => b.disabled = false); }
  }
});
$('#messages').addEventListener('keydown', event => { const link = event.target.closest?.('code.path-link[data-open-path]'); if (link && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openPath(link.dataset.openPath, { line: link.dataset.openLine }); } });
// Cross-panel links outside the transcript: notices, attachments, monitor rows, terminal ownership.
document.addEventListener('click', event => {
  if (!(event.target instanceof Element) || event.target.closest('#messages, #activity-list')) return;
  if (event.target.closest('[data-reload-page]')) { location.reload(); return; }
  const goto = event.target.closest('[data-goto-session]'); if (goto) { selectSession(goto.dataset.gotoSession); return; }
  const open = event.target.closest('[data-open-path]'); if (open) { openPath(open.dataset.openPath, { line: open.dataset.openLine }); return; }
  const jump = event.target.closest('[data-jump-tool]'); if (jump) { jumpToTool(jump.dataset.jumpTool); return; }
  if (event.target.closest('[data-open-terminal]')) { openTerminal().catch(error => toast(error.message, true)); return; }
  const startButton = event.target.closest('[data-start-terminal]'); if (startButton) { startTerminal(startButton.dataset.startTerminal); return; }
  const native = event.target.closest('[data-native-command]'); if (native) { startTerminal('claude', native.dataset.nativeCommand); return; }
  if (event.target.closest('[data-restore-session]') && state.activeId) { changeSession(state.activeId, { archived: false }).then(() => toast('会话已恢复。')).catch(error => toast(error.message, true)); return; }
  if (event.target.closest('[data-toggle-todos]')) { ui.todoOpen = !ui.todoOpen; renderTodos(); }
});
// Follow the stream until the reader moves away: scrolling up (wheel, keys, scrollbar, touch) detaches,
// reaching the bottom again re-attaches. Held pointers pause following so selections and drags stay put.
$('#messages').addEventListener('scroll', () => {
  const box = $('#messages'), top = box.scrollTop;
  if (box.scrollHeight - top - box.clientHeight <= 48) ui.stuck = true;
  else if (top < ui.lastScrollTop - 1 && top !== ui.autoScrollTop) ui.stuck = false;
  ui.lastScrollTop = top; updateScrollButton();
}, { passive: true });
$('#messages').addEventListener('wheel', event => { if (event.deltaY < 0) ui.stuck = false; }, { passive: true });
$('#messages').addEventListener('pointerdown', () => { ui.pointerDown = true; });
$('#messages').addEventListener('touchstart', () => { ui.touching = true; }, { passive: true });
for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'blur']) addEventListener(type, () => { const held = ui.pointerDown || ui.touching; ui.pointerDown = false; ui.touching = false; if (held && ui.stuck) requestFrame(); }, { passive: true });
$('#scroll-bottom').addEventListener('click', scrollToLatest);
// While Claude works, the composer sends guidance: it reaches the running turn at Claude's next step.
async function sendSteer() {
  let text = $('#message-input').value.trim(); const id = state.activeId;
  if (!text || !id || state.busy || state.steering) return;
  if (/^\/[^\s]+$/.test(text)) { const command = commandsList().find(c => c.slash === text); if (command) { $('#message-input').value = ''; preserveDraft(); resizeInput(); updateControls(); await executeCommand(command); return; } }
  const attachments = ide.attachments.get(id) || []; if (attachments.length) text += `\n\n引用当前工作区文件：\n${attachments.map(file => `- @${file.path}`).join('\n')}`;
  state.steering = true; updateControls();
  try {
    if (!state.pendingSteer || state.pendingSteer.sessionId !== id || state.pendingSteer.text !== text) state.pendingSteer = { sessionId: id, text, requestId: crypto.randomUUID() };
    const result = await api(`/api/sessions/${encodeURIComponent(id)}/steer`, { method: 'POST', body: { text, requestId: state.pendingSteer.requestId } });
    state.pendingSteer = null;
    if (id === state.activeId) { $('#message-input').value = ''; ide.attachments.delete(id); renderAttachments(); preserveDraft(); resizeInput(); ui.stuck = true; acceptSession(result); stickToBottom(); }
  } catch (error) { toast(error.message, true); if (error.status === 409) await refreshSession().catch(() => {}); }
  finally { state.steering = false; updateControls(); }
}
$('#composer').addEventListener('submit', async event => {
  event.preventDefault(); if (running(state.session)) { await sendSteer(); return; }
  let text = $('#message-input').value.trim(); if (!text || terminalHere() || state.busy || state.accountSwitchPending) return;
  if (!accountReady()) { toast('请先登录 Claude 账号后再开始对话。', true); return; }
  if (/^\/[^\s]+$/.test(text)) { const command = commandsList().find(c => c.slash === text); if (command) { $('#message-input').value = ''; preserveDraft(); resizeInput(); updateControls(); await executeCommand(command); return; } }
  const attachments = ide.attachments.get(state.activeId) || []; if (attachments.length) text += `\n\n引用当前工作区文件：\n${attachments.map(file => `- @${file.path}`).join('\n')}`;
  state.busy = true; updateControls(); let id = state.activeId;
  try {
    if (!id) {
      const created = await api('/api/sessions', { method: 'POST', body: { model: $('#model-select').value, permissionMode: $('#mode-select').value, effort: $('#effort-select').value } });
      id = created.id; plugins.commitDraft(id); state.selectionVersion++; state.activeId = id; storage.set('cloud-ops-workbench-active', id); storage.set('cloud-ops-workbench-draft:new', ''); storage.set(activeDraftKey(), text); acceptSession(created);
    }
    if (!state.pendingSend || state.pendingSend.sessionId !== id || state.pendingSend.text !== text) state.pendingSend = { sessionId: id, text, requestId: crypto.randomUUID() };
    const choices = plugins.choices(id);
    const result = await api(`/api/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text, requestId: state.pendingSend.requestId, ...(choices ? { choices } : {}) } });
    state.pendingSend = null; plugins.choicesSent(id);
    if (id === state.activeId) { $('#message-input').value = ''; ide.attachments.delete(id); renderAttachments(); preserveDraft(); resizeInput(); ui.stuck = true; acceptSession(result); stickToBottom(); }
    await refreshBootstrap();
  } catch (error) { toast(error.message, true); }
  finally { state.busy = false; updateControls(); }
});
$('#stop-button').addEventListener('click', async () => { if (!state.activeId || state.busy) return; const id = state.activeId; state.busy = true; updateControls(); try { const result = await api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }); if (id === state.activeId) acceptSession(result); toast('已发送停止请求。'); } catch (error) { toast(error.message, true); } finally { state.busy = false; updateControls(); } });
for (const [selector, key] of [['#model-select', 'model'], ['#mode-select', 'permissionMode'], ['#effort-select', 'effort']]) $(selector).addEventListener('change', async event => {
  const sessionId = state.activeId;
  const previous = { model: state.session?.model || 'sonnet', effort: state.session?.effort || 'auto', permissionMode: state.session?.permissionMode || 'bypassPermissions' };
  if (key === 'model') configureEffort();
  const patch = key === 'model' ? { model: event.target.value, effort: $('#effort-select').value } : { [key]: event.target.value };
  if (key !== 'permissionMode') { storage.set('cloud-ops-workbench-model', $('#model-select').value); storage.set('cloud-ops-workbench-effort', $('#effort-select').value); }
  renderModelStatus();
  updateControls();
  if (!sessionId) return;
  try { await changeSession(sessionId, patch); }
  catch (error) {
    toast(error.message, true);
    if (state.activeId === sessionId) {
      if (key === 'model') { renderModelOptions(previous.model); configureEffort(previous.effort); }
      else $(selector).value = previous[key];
      updateControls();
    }
  }
});
async function manualRefresh() { const button = $('#refresh-button'); button.disabled = true; button.classList.add('spinning'); try { await refreshBootstrap(); if (state.activeId) await refreshSession(); if (!state.connected) connectEvents(); toast('状态已更新。'); } catch (error) { toast(error.message, true); } finally { button.disabled = false; button.classList.remove('spinning'); } }
$('#refresh-button').addEventListener('click', manualRefresh);
$('#reconnect-button').addEventListener('click', () => { connectEvents(); });
document.addEventListener('keydown', event => { if (!state.authenticated) return; if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommands(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && currentDocument() && ide.workspaceOpen) { event.preventDefault(); saveDocument(); } if (event.key === 'Escape') { closeSidebar(); $('#slash-menu').hidden = true; if (activityVisible() && narrowLayout() && !document.querySelector('dialog[open]')) setActivityOpen(false, { remember: false }); } if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey && !event.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable && !document.activeElement?.closest('.monaco-editor,.terminal-panel') && !$$('dialog[open]').length) { event.preventDefault(); newSessionView(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.authenticated) { ui.attention = null; updateDocumentTitle(); refreshBootstrap().then(() => state.activeId ? refreshSession() : undefined).catch(() => {}); if (!state.source || state.source.readyState === EventSource.CLOSED) connectEvents(); } });
window.addEventListener('pagehide', () => { preserveDraft(); state.source?.close(); ide.terminalSource?.close(); });
window.addEventListener('pageshow', event => { if (event.persisted && state.authenticated) connectEvents(); });
window.addEventListener('resize', () => { resizeInput(); fitTerminal(); layoutActivity(); if (!matchMedia('(max-width: 680px)').matches) closeSidebar(); else syncSidebarAccess(); }, { passive: true });
setInterval(tick, 1000);

$('#refresh-usage').addEventListener('click', refreshUsage);
$('#usage-collapse').addEventListener('click', () => { ui.usageCollapsed = !ui.usageCollapsed; storage.set('cloud-ops-workbench-usage-collapsed', ui.usageCollapsed ? '1' : ''); renderUsage(); });
$('#activity-toggle').addEventListener('click', () => setActivityOpen(!activityVisible(), { remember: !narrowLayout() }));
$('#activity-close').addEventListener('click', () => setActivityOpen(false, { remember: !narrowLayout() }));
$('#activity-scrim').addEventListener('click', () => setActivityOpen(false, { remember: false }));
$('#activity-inline').addEventListener('click', () => setStepsInline(!ui.stepsInline));
$('#activity-latest').addEventListener('click', () => { const list = $('#activity-list'); ui.activityStuck = true; if (ui.activityTab === 'steps') { const latest = activityTurns(state.session || {}).at(-1); if (latest) { ui.openTurns.add(latest.id); ui.closedTurns.delete(latest.id); } } renderActivity(); list.scrollTo({ top: ui.activityTab === 'steps' ? list.scrollHeight : 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }); });
$$('[data-activity-tab]').forEach(button => button.addEventListener('click', () => { if (ui.activityTab === button.dataset.activityTab) return; ui.activityTab = button.dataset.activityTab; syncActivityTabs(); const list = $('#activity-list'); list.replaceChildren(); list._empty = null; ui.activityStuck = ui.activityTab === 'steps'; renderActivity(); if (ui.activityTab === 'steps') list.scrollTop = list.scrollHeight; }));
$('#activity-list').addEventListener('scroll', () => { const list = $('#activity-list'); ui.activityStuck = list.scrollHeight - list.scrollTop - list.clientHeight <= 48; }, { passive: true });
$('#activity-list').addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const pathLink = event.target.closest('code.path-link[data-open-path]'); if (pathLink) { openPath(pathLink.dataset.openPath, { line: pathLink.dataset.openLine }); return; }
  if (event.target.closest('.message-body')) return;
  const turn = event.target.closest('[data-toggle-turn]');
  if (turn) { const id = turn.dataset.toggleTurn, open = turn.getAttribute('aria-expanded') === 'true'; toggleActivityRow(turn, () => { if (open) { ui.closedTurns.add(id); ui.openTurns.delete(id); } else { ui.openTurns.add(id); ui.closedTurns.delete(id); } }); return; }
  const step = event.target.closest('[data-toggle-step]');
  if (step) { const id = step.dataset.toggleStep; toggleActivityRow(step, () => { if (ui.openSteps.has(id)) ui.openSteps.delete(id); else ui.openSteps.add(id); }); return; }
  const thinking = event.target.closest('[data-toggle-pthinking]');
  if (thinking) { const id = thinking.dataset.togglePthinking; toggleActivityRow(thinking, () => { if (ui.panelThinking.has(id)) ui.panelThinking.delete(id); else ui.panelThinking.add(id); }); return; }
  const file = event.target.closest('[data-toggle-file]');
  if (file) { const path = file.dataset.toggleFile; toggleActivityRow(file, () => { if (ui.openFiles.has(path)) ui.openFiles.delete(path); else ui.openFiles.add(path); }); return; }
  const load = event.target.closest('[data-load-tool]'); if (load) { loadFullTool(load.dataset.loadTool); return; }
  const stop = event.target.closest('button[data-task-stop]'); if (stop) { stopTask(stop.dataset.taskStop); return; }
  const open = event.target.closest('[data-open-path]'); if (open) { openPath(open.dataset.openPath, { line: open.dataset.openLine }); return; }
  const row = event.target.closest('[data-goto-row]'); if (row) gotoRow(row.dataset.gotoRow);
});
$('#workspace-toggle').addEventListener('click', () => ide.workspaceOpen ? closeWorkspace() : openWorkspace().catch(error => toast(error.message, true)));
$('#workspace-close').addEventListener('click', closeWorkspace);
$('#workspace-refresh').addEventListener('click', () => ide.explorer === 'git' ? loadGit() : loadDirectory());
$('#file-tree').addEventListener('click', event => { const reference = event.target.closest('[data-reference-path]'); const file = event.target.closest('[data-file-path]'); const search = event.target.closest('[data-search-path]'); const git = event.target.closest('[data-git-path]'); if (reference) referenceFile(reference.dataset.referencePath); else if (file) { (isDirectory({ type: file.dataset.fileType }) ? loadDirectory(file.dataset.filePath) : openFile(file.dataset.filePath)).catch(error => toast(error.message, true)); } else if (search) openFile(search.dataset.searchPath, { line: Number(search.dataset.searchLine) }).catch(error => toast(error.message, true)); else if (git) openDiff(git.dataset.gitPath); });
$('#explorer-path').addEventListener('click', event => { const button = event.target.closest('[data-directory]'); if (button) loadDirectory(button.dataset.directory); });
$$('[data-explorer-tab]').forEach(button => button.addEventListener('click', () => { ide.explorer = button.dataset.explorerTab; $$('[data-explorer-tab]').forEach(b => b.classList.toggle('active', b === button)); $('#file-search-box').hidden = ide.explorer !== 'search'; if (ide.explorer === 'files') loadDirectory(); if (ide.explorer === 'git') loadGit(); if (ide.explorer === 'search') { $('#explorer-path').innerHTML = '<span>在当前工作区内查找文本</span>'; $('#file-tree').innerHTML = '<div class="explorer-empty">输入关键词，在当前工作区查找。</div>'; $('#file-search-input').focus(); } }));
$('#file-search-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) searchFiles(event.target.value); });
$('#editor-tabs').addEventListener('click', event => { const close = event.target.closest('[data-close-document]'); const open = event.target.closest('[data-open-document]'); if (close) { const key = close.dataset.closeDocument; const doc = ide.documents.get(key); if (doc?.dirty) { toast('此文件有未保存修改，请先保存；修改会保留在标签中。'); return; } doc?.model?.dispose(); ide.documents.delete(key); if (key === ide.activeDocument) ide.activeDocument = [...ide.documents].find(([, d]) => d.sessionId === state.activeId)?.[0] || null; ui.activeDocBySession.set(state.activeId, ide.activeDocument); renderEditor(); if (ide.explorer === 'files') renderFileTree(); } else if (open) { ide.activeDocument = open.dataset.openDocument; ui.activeDocBySession.set(state.activeId, ide.activeDocument); ide.preview = false; renderEditor(); if (ide.explorer === 'files') renderFileTree(); } });
$('#code-editor').addEventListener('input', event => markDocumentChanged(event.target.value));
$('#code-editor').addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); const input = event.target; const start = input.selectionStart; input.setRangeText('  ', start, input.selectionEnd, 'end'); markDocumentChanged(input.value); } if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); referenceSelection(); } });
$('#file-save').addEventListener('click', saveDocument);
$('#editor-preview-toggle').addEventListener('click', () => { ide.preview = !ide.preview; renderEditor(); });
$('#file-reference').addEventListener('click', () => { if (currentDocument()) referenceFile(currentDocument().path); });
$('#selection-reference').addEventListener('click', referenceSelection);
$('#file-download').addEventListener('click', () => { const doc = currentDocument(); if (doc) downloadBlob(doc.path.split('/').at(-1), doc.text); });
$('#file-reload').addEventListener('click', () => { const doc = currentDocument(); if (doc) { downloadBlob(`${doc.path.split('/').at(-1)}.local-backup.txt`, doc.text); openFile(doc.path, { reload: true }).catch(error => toast(error.message, true)); toast('当前编辑已下载备份，再载入服务器版本。'); } });
$('#file-save-as').addEventListener('click', () => openPathDialog('saveAs'));
$('#new-file').addEventListener('click', () => openPathDialog('file')); $('#new-folder').addEventListener('click', () => openPathDialog('directory'));
$('#path-cancel').addEventListener('click', () => $('#path-dialog').close());
$('#path-form').addEventListener('submit', async event => { event.preventDefault(); const path = $('#path-input').value.trim(); if (!path) return; const button = $('#path-form button[type="submit"]'); button.disabled = true; try { await ensureSession(); if (ide.pathAction === 'directory') await api(sessionApi('directories'), { method: 'POST', body: { path } }); else { const text = ide.pathAction === 'saveAs' ? currentDocument()?.text || '' : ''; await api(sessionApi(`file?path=${encodeURIComponent(path)}`), { method: 'PUT', body: { path, text, hash: null } }); await openFile(path); } $('#path-dialog').close(); await loadDirectory(); toast('已创建。'); } catch (error) { toast(error.message, true); } finally { button.disabled = false; } });
for (const id of ['#attach-button', '#workspace-upload']) $(id).addEventListener('click', () => $('#attachment-input').click());
$('#attachment-input').addEventListener('change', event => { uploadFiles([...event.target.files]).catch(error => toast(error.message, true)); event.target.value = ''; });
$('#attachment-list').addEventListener('click', event => { const button = event.target.closest('[data-remove-attachment]'); if (button) { ide.attachments.set(state.activeId, (ide.attachments.get(state.activeId) || []).filter(f => f.path !== button.dataset.removeAttachment)); renderAttachments(); } });
$('#export-session').addEventListener('click', exportSession);
$('#terminal-toggle').addEventListener('click', () => { Promise.resolve(toggleTerminalPanel()).catch(error => toast(error.message, true)); });
$('#terminal-close').addEventListener('click', closeTerminalPanel); $('#terminal-stop').addEventListener('click', stopTerminal);
$('#terminal-reconnect').addEventListener('click', async () => { ide.terminalSource?.close(); ide.terminalSource = null; await refreshTerminals().catch(error => toast(error.message, true)); if (ide.terminal) attachTerminal(); });
$('#start-shell').addEventListener('click', () => startTerminal('shell')); $('#start-claude').addEventListener('click', () => startTerminal('claude'));
$('#shell-terminal').addEventListener('click', () => { if (ide.terminal?.status === 'running' && ide.terminal.kind !== 'shell') toast('请先结束当前原生 Claude 进程，再打开 Shell。'); else if (ide.terminal?.status !== 'running') startTerminal('shell'); else { ide.terminalKind = 'shell'; renderTerminal(); } });
$('#claude-terminal').addEventListener('click', () => { if (ide.terminal?.status === 'running' && ide.terminal.kind !== 'claude') toast('请先结束当前 Shell 进程，再打开原生 Claude。'); else if (ide.terminal?.status !== 'running') startTerminal('claude'); else { ide.terminalKind = 'claude'; renderTerminal(); } });
$('#terminal-resize-handle').addEventListener('pointerdown', event => { const startY = event.clientY; const height = $('#terminal-panel').getBoundingClientRect().height; event.target.setPointerCapture(event.pointerId); const move = e => { $('#terminal-panel').style.height = `${Math.min(innerHeight * .75, Math.max(170, height + startY - e.clientY))}px`; ide.fit?.fit(); }; const up = () => { event.target.removeEventListener('pointermove', move); event.target.removeEventListener('pointerup', up); fitTerminal(); }; event.target.addEventListener('pointermove', move); event.target.addEventListener('pointerup', up); });
for (const id of ['#command-button', '#status-command-button']) $(id).addEventListener('click', openCommands);
$('#workshop-button').addEventListener('click', () => workshop.open());
$('#safe-exit').addEventListener('click', () => { const url = new URL(location.href); url.searchParams.delete('safe'); location.href = url.href; });
$('#command-query').addEventListener('input', () => { ide.commandIndex = 0; renderCommands(); });
$('#command-query').addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); ide.commandIndex = Math.max(0, Math.min(ide.commands.length - 1, ide.commandIndex + (event.key === 'ArrowDown' ? 1 : -1))); renderCommands(); $('.command-result.selected')?.scrollIntoView({ block: 'nearest' }); } else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); executeCommand(ide.commands[ide.commandIndex]); } });
$('#command-results').addEventListener('click', event => { const button = event.target.closest('[data-command-index]'); if (button) executeCommand(ide.commands[Number(button.dataset.commandIndex)]); });
$('#command-dialog').addEventListener('click', event => { if (event.target === $('#command-dialog')) $('#command-dialog').close(); });
$('#slash-button').addEventListener('click', () => { $('#message-input').value = '/'; resizeInput(); renderSlashMenu(); $('#message-input').focus(); });
$('#slash-menu').addEventListener('click', event => { const button = event.target.closest('[data-slash-command]'); if (button) { $('#message-input').value = ''; preserveDraft(); resizeInput(); updateControls(); executeCommand(commandsList().find(c => c.id === button.dataset.slashCommand)); } });
window.addEventListener('beforeunload', event => { if ([...ide.documents.values()].some(doc => doc.dirty)) { event.preventDefault(); event.returnValue = ''; } });

themes.apply(); renderSafeBanner();
renderMonitor(); renderUsage(); syncSidebarAccess();
try {
  const auth = await api('/api/auth');
  if (auth.authenticated) await showApp(auth); else { if (auth.totpRequired || auth.totpEnabled) $('#totp-field').hidden = false; showLogin(); }
} catch (error) { showLogin(error.status === 401 ? '' : '暂时无法连接工作台，请稍后重试。'); }
