// 创意工坊: discover, install, enable and develop plugins and skins.
// What is on this server comes from /api/plugins; the community catalog comes from /api/workshop, which the server
// downloads and checks. Plugins run sandboxed and only get the permissions granted in the consent dialog below.
import { THEMES, AUTO_THEMES } from './themes.js?v=1.7.1';

const $ = (selector, root = document) => root.querySelector(selector);
const DOCS_URL = 'https://github.com/qiuxinyuan321/fusheng-kelaude-workbench/blob/main/docs/PLUGINS.md';
const SOURCES = { builtin: '内置', workshop: '创意工坊', local: '本地导入', dev: '开发中' };
const SURFACES = { panel: '面板', widget: '监控小组件', overlay: '悬浮窗', background: '后台', sidebar: '侧边栏入口', composer: '输入框选择器' };
const SOURCE_NOTES = {
  builtin: '这是工作台自带的插件，由项目维护者编写并随版本发布。',
  official: '这个插件由工作台项目维护，收录在创意工坊目录中，安装包会校验 sha256。',
  workshop: '这个插件来自创意工坊的社区作者，安装包会校验 sha256。收录不代表工作台项目为它的安全背书。',
  local: '这个插件来自你导入的插件包，没有经过任何审核。',
  dev: '这是插件目录中开发中的插件，直接从服务器磁盘加载。',
};
const CONSENT_NOTE = '插件运行在隔离沙箱里，读不到对话记录和文件，也不能执行命令，只能使用上面列出的权限。请只安装你信任的作者的插件。';
// Skin previews paint with core tokens only; derived ones are resolved on <html> for the active skin.
const PREVIEW_TOKENS = ['bg', 'bg-2', 'surface', 'surface-2', 'sunken', 'line', 'line-2', 'ink', 'ink-3', 'ink-4', 'ink-5', 'brand', 'brand-2', 'brand-4', 'brand-soft', 'brand-tint', 'brand-line', 'on-brand', 'amber-2', 'side', 'side-2', 'side-3', 'side-ink', 'side-ink-3', 'side-accent', 'shadow'];
const CSS_VALUE = /^[A-Za-z0-9#%(),.\s+\-/*]{1,240}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const IMPORT_LIMIT = 3 * 1024 * 1024;

export function createWorkshop(ctx) {
  const dialog = $('#workshop-dialog'), body = $('#workshop-body'), consentDialog = $('#plugin-consent'), fileInput = $('#workshop-import');
  const view = { tab: 'discover', query: '', kind: 'all', registry: null, error: null, loading: null, busy: new Set(), armed: null, armTimer: null };
  const esc = ctx.escape, icon = ctx.icon;
  const empty = { plugins: [], themes: [], permissions: {}, errors: [], workshop: { enabled: false }, safeMode: false, devDir: '', sdkVersion: 1, workbenchVersion: '' };
  const catalog = () => ctx.plugins.data || empty;
  const safe = () => ctx.safe || Boolean(catalog().safeMode);
  const local = id => catalog().plugins.find(p => p.id === id) || catalog().themes.find(t => t.id === id) || null;
  const accent = value => HEX.test(value || '') ? value : 'var(--brand)';
  const glyph = (item, size = '') => `<span class="ws-glyph${size}" style="--accent:${accent(item.accent)}" aria-hidden="true">${esc(item.icon || '?')}</span>`;
  const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  /* ---------- Rendering ---------- */
  function permissionChips(list) {
    const meta = catalog().permissions || {};
    return (list || []).map(p => { const info = meta[p] || { label: p, description: '', risk: 'low' }; return `<span class="ws-chip perm ${info.risk !== 'low' ? 'warn' : ''}" title="${esc(info.description)}">${esc(info.label)}</span>`; }).join('');
  }
  const surfaceChips = list => (list || []).map(s => `<span class="ws-chip surface">${esc(SURFACES[s] || s)}</span>`).join('');
  function button(action, id, label, { primary = false, disabled = false, danger = false } = {}) {
    const busy = view.busy.has(id);
    return `<button type="button" class="ws-button${primary ? ' primary' : ''}${danger ? ' danger' : ''}" data-action="${action}" data-id="${esc(id)}"${disabled || busy ? ' disabled' : ''}>${busy ? '<span class="ws-spinner" aria-hidden="true"></span>' : ''}${esc(label)}</button>`;
  }
  function pluginState(p) {
    if (safe()) return { tone: 'muted', text: '安全模式' };
    if (p.backendError) return { tone: 'bad', text: p.backendError };
    if (!p.compatible) return { tone: 'bad', text: `需要 v${p.minVersion}` };
    if (p.needsConsent) return { tone: 'warn', text: '待重新授权' };
    return p.active ? { tone: 'ok', text: '运行中' } : { tone: 'muted', text: '未启用' };
  }
  function localActions(mine) {
    if (mine.type === 'theme') {
      const using = ctx.themes.pref !== 'auto' && ctx.themes.current?.id === mine.id;
      return { note: using ? '使用中' : '已安装', html: using ? button('noop', mine.id, '使用中', { disabled: true }) : button('use-theme', mine.id, '使用', { primary: true, disabled: safe() }) };
    }
    if (mine.needsConsent) return { note: '新版本申请了新权限', html: button('enable', mine.id, '重新授权', { primary: true, disabled: safe() }) };
    if (mine.enabled) return { note: mine.active ? '已启用' : pluginState(mine).text, html: button('disable', mine.id, '停用') };
    return { note: SOURCES[mine.source] ? `已${mine.source === 'builtin' ? '内置' : '安装'}` : '', html: button('enable', mine.id, '启用', { primary: true, disabled: safe() || !mine.compatible }) };
  }
  function itemActions(item) {
    const mine = local(item.id);
    if (item.bundled) return mine ? localActions(mine) : { note: '需要更新工作台', html: button('noop', item.id, '不可用', { disabled: true }) };
    if (item.reserved) return { note: '本地已有同名插件', html: button('noop', item.id, '已占用', { disabled: true }) };
    if (!mine) return item.compatible ? { note: item.size ? size(item.size) : '', html: button('install', item.id, '安装', { primary: true }) } : { note: `需要工作台 v${item.minVersion}`, html: button('noop', item.id, '版本过低', { disabled: true }) };
    if (item.updatable) return item.compatible ? { note: `已安装 v${mine.version}`, html: button('update', item.id, `更新到 v${item.version}`, { primary: true }) } : { note: `新版需要 v${item.minVersion}`, html: localActions(mine).html };
    return localActions(mine);
  }
  function itemCard(item) {
    const actions = itemActions(item);
    const swatches = item.type === 'theme' && item.preview?.swatches?.length ? `<span class="ws-swatches" aria-hidden="true">${item.preview.swatches.map(c => `<i style="background:${accent(c)}"></i>`).join('')}</span>` : '';
    const badges = `${item.official ? '<span class="ws-chip ok">官方</span>' : ''}${item.type === 'theme' ? `<span class="ws-chip">${item.preview?.scheme === 'dark' ? '深色皮肤' : '浅色皮肤'}</span>` : ''}`;
    return `<article class="ws-card" style="--accent:${accent(item.accent || item.preview?.swatches?.[0])}">
      <div class="ws-card-top">${glyph(item)}<div class="ws-card-title"><strong>${esc(item.name)}</strong><small>v${esc(item.version)}${item.author ? ` · ${esc(item.author)}` : ''}</small></div><div class="ws-badges">${badges}</div></div>
      ${swatches}<p class="ws-desc">${esc(item.description || '这个作者还没有写介绍。')}</p>
      <div class="ws-meta">${surfaceChips(item.surfaces)}${permissionChips(item.permissions)}${(item.tags || []).map(t => `<span class="ws-chip tag">#${esc(t)}</span>`).join('')}</div>
      <div class="ws-card-actions"><span class="ws-note">${esc(actions.note || '')}</span>${actions.html}</div>
    </article>`;
  }
  function gridHtml() {
    const query = view.query.trim().toLowerCase();
    const items = (view.registry?.items || []).filter(item => (view.kind === 'all' || item.type === view.kind) && (!query || `${item.name} ${item.description} ${item.author} ${(item.tags || []).join(' ')} ${item.id}`.toLowerCase().includes(query)));
    if (!view.registry) {
      if (view.error) return `<div class="ws-empty error">${icon('wifi-off')}<strong>创意工坊暂时打不开</strong><p>${esc(view.error)}</p><div class="ws-empty-actions"><button type="button" class="ws-button primary" data-action="refresh-registry">重试</button><button type="button" class="ws-button" data-action="tab" data-id="develop">导入插件包</button></div></div>`;
      return Array.from({ length: 6 }, () => '<div class="ws-card skeleton" aria-hidden="true"><i></i><i></i><i></i></div>').join('');
    }
    if (!items.length) return `<div class="ws-empty">${icon('search')}<strong>没有找到匹配的${view.kind === 'theme' ? '皮肤' : view.kind === 'plugin' ? '插件' : '条目'}</strong><p>换个关键词试试，或者自己动手写一个。</p></div>`;
    return items.map(itemCard).join('');
  }
  function renderDiscover() {
    const cat = catalog();
    if (!cat.workshop?.enabled) return `<div class="ws-empty">${icon('ban')}<strong>创意工坊已关闭</strong><p>服务器设置了 <code>WORKBENCH_WORKSHOP_URL=off</code>。你仍然可以在「开发」页导入插件包，或使用内置插件和皮肤。</p></div>`;
    const updated = view.registry?.updatedAt ? `目录更新于 ${new Date(view.registry.updatedAt).toLocaleDateString('zh-CN')}` : '';
    const skipped = view.registry?.skipped ? ` · ${view.registry.skipped} 个条目格式不符已跳过` : '';
    const custom = view.registry && !view.registry.project ? `${updated || skipped ? ' · ' : ''}自定义目录 ${new URL(cat.workshop.url).host}，不显示「官方」标记` : '';
    return `<section class="ws-hero">
        <div class="ws-hero-copy"><span class="eyebrow">COMMUNITY WORKSHOP</span><h3>把工作台变成你喜欢的样子</h3><p>插件和皮肤由社区创作。服务器下载安装包并校验 sha256；插件运行在隔离沙箱中，只能使用你授予的权限。</p></div>
        <div class="ws-hero-art" aria-hidden="true"><span>${icon('puzzle')}</span><span>${icon('palette')}</span><span>${icon('sparkles')}</span></div>
      </section>
      <div class="ws-toolbar">
        <label class="ws-search">${icon('search')}<input id="ws-query" type="search" placeholder="搜索插件、皮肤、作者或标签" value="${esc(view.query)}" autocomplete="off" aria-label="搜索创意工坊"></label>
        <div class="ws-segment" role="group" aria-label="类型">${[['all', '全部'], ['plugin', '插件'], ['theme', '皮肤']].map(([kind, label]) => `<button type="button" data-action="kind" data-id="${kind}" aria-pressed="${view.kind === kind}">${label}</button>`).join('')}</div>
        <button type="button" class="icon-button${view.loading ? ' spinning' : ''}" data-action="refresh-registry" title="刷新目录" aria-label="刷新目录">${icon('refresh')}</button>
      </div>
      <div id="ws-grid" class="ws-grid" aria-busy="${Boolean(view.loading)}">${gridHtml()}</div>
      <p class="ws-footnote">${esc(updated)}${esc(skipped)}${esc(custom)}${updated || skipped || custom ? ' · ' : ''}想上架自己的作品？阅读<a href="${DOCS_URL}" target="_blank" rel="noopener noreferrer">插件开发文档</a>后向仓库的 workshop 目录提交 PR。</p>`;
  }
  function pluginRow(p) {
    const status = pluginState(p), armed = view.armed === p.id;
    const actions = [
      p.source === 'dev' && p.active ? button('reload', p.id, '重新加载') : '',
      ['workshop', 'local'].includes(p.source) ? button('uninstall', p.id, armed ? '确认卸载？' : '卸载', { danger: armed }) : '',
    ].join('');
    // Safe mode can still switch a running plugin off: that is how you recover from one that broke the page.
    const blocked = (safe() && !(p.enabled && !p.needsConsent)) || (!p.enabled && !p.compatible);
    const note = p.needsConsent ? '<p class="ws-row-warn">新版本申请了新的权限，确认后才会继续运行。</p>' : !p.compatible ? `<p class="ws-row-warn">需要工作台 v${esc(p.minVersion)} 或更新版本。</p>` : '';
    return `<article class="ws-row">
      ${glyph(p, ' large')}
      <div class="ws-row-main">
        <div class="ws-row-title"><strong>${esc(p.name)}</strong><span class="ws-chip source-${esc(p.source)}">${esc(SOURCES[p.source] || p.source)}</span><small>v${esc(p.version)}${p.author ? ` · ${esc(p.author)}` : ''}</small></div>
        <p>${esc(p.description || '没有介绍。')}</p>
        <div class="ws-meta">${surfaceChips(p.surfaces)}${permissionChips(p.permissions)}</div>${note}
      </div>
      <div class="ws-row-side">
        <span class="ws-state ${status.tone}"><i></i>${esc(status.text)}</span>
        <div class="ws-row-actions">${actions}<button type="button" class="ws-switch" role="switch" aria-checked="${p.enabled && !p.needsConsent}" aria-label="${p.enabled ? '停用' : '启用'}「${esc(p.name)}」" data-action="toggle" data-id="${esc(p.id)}"${blocked || view.busy.has(p.id) ? ' disabled' : ''}><i></i></button></div>
      </div>
    </article>`;
  }
  function renderInstalled() {
    const cat = catalog(), list = cat.plugins, running = list.filter(p => p.active).length;
    const errors = cat.errors?.length ? `<section class="ws-errors"><h4>${icon('alert')}有 ${cat.errors.length} 个插件目录没有加载</h4><ul>${cat.errors.map(e => `<li><code>${esc(e.dir)}</code><span>${esc(e.error)}</span></li>`).join('')}</ul></section>` : '';
    const rows = list.length ? list.map(pluginRow).join('') : `<div class="ws-empty">${icon('puzzle')}<strong>还没有插件</strong><p>去「发现」挑几个，或者在「开发」页写一个属于你的。</p></div>`;
    return `<div class="ws-section-head"><div><h3>插件</h3><p>${list.length} 个插件 · ${running} 个运行中 · 皮肤在「皮肤」页管理</p></div>${button('rescan', 'rescan', '重新扫描')}</div>${errors}<div class="ws-rows">${rows}</div>`;
  }
  function preview(theme) {
    const tokens = { ...THEMES[0].tokens, ...(theme?.tokens || {}) };
    const style = PREVIEW_TOKENS.filter(name => typeof tokens[name] === 'string' && CSS_VALUE.test(tokens[name]) && !/[;{}]/.test(tokens[name])).map(name => `--${name}:${tokens[name]}`).join(';');
    return `<span class="skin-preview" style="${esc(style)}" aria-hidden="true"><span class="sp-side"><i></i><i></i><i></i><i></i></span><span class="sp-main"><span class="sp-top"><b></b><em></em></span><span class="sp-chat"><i class="sp-user"></i><i class="sp-reply"></i><i class="sp-reply short"></i></span><span class="sp-input"><i></i><b></b></span></span></span>`;
  }
  function skinCard(theme, active) {
    const removable = ['workshop', 'local'].includes(theme.source), armed = view.armed === theme.id;
    const by = theme.source !== 'builtin' ? `<small class="ws-skin-by">${esc(theme.author || '社区作者')} · ${esc(SOURCES[theme.source] || theme.source)}${theme.version ? ` · v${esc(theme.version)}` : ''}</small>` : '';
    return `<article class="ws-skin${active ? ' active' : ''}">
      <button type="button" class="ws-skin-main" data-action="use-theme" data-id="${esc(theme.id)}" aria-pressed="${active}"${safe() ? ' disabled' : ''}>${preview(theme)}
        <span class="ws-skin-info"><span class="ws-skin-name"><strong>${esc(theme.name)}</strong><span class="ws-chip">${theme.scheme === 'dark' ? '深色' : '浅色'}</span>${active ? `<span class="ws-chip ok">${icon('check')}使用中</span>` : ''}</span><small>${esc(theme.description || '')}</small>${by}</span>
      </button>
      ${removable ? `<button type="button" class="ws-link${armed ? ' danger' : ''}" data-action="uninstall" data-id="${esc(theme.id)}">${armed ? '确认卸载？' : '卸载'}</button>` : ''}
    </article>`;
  }
  function renderSkins() {
    const pref = ctx.themes.pref, current = ctx.themes.current?.id, find = id => ctx.themes.find(id);
    const auto = `<article class="ws-skin${pref === 'auto' ? ' active' : ''}">
      <button type="button" class="ws-skin-main" data-action="use-theme" data-id="auto" aria-pressed="${pref === 'auto'}"${safe() ? ' disabled' : ''}><span class="ws-skin-split">${preview(find(AUTO_THEMES.light))}${preview(find(AUTO_THEMES.dark))}</span>
        <span class="ws-skin-info"><span class="ws-skin-name"><strong>跟随系统</strong><span class="ws-chip">自动</span>${pref === 'auto' ? `<span class="ws-chip ok">${icon('check')}使用中</span>` : ''}</span><small>白天${esc(find(AUTO_THEMES.light)?.name || '')}，夜间${esc(find(AUTO_THEMES.dark)?.name || '')}，随系统深浅色切换</small></span>
      </button></article>`;
    const cards = ctx.themes.list().map(theme => skinCard(theme, pref !== 'auto' && current === theme.id)).join('');
    return `<div class="ws-section-head"><div><h3>皮肤</h3><p>只改变这台浏览器的外观，终端、编辑器和插件会一起换色。</p></div>${view.registry || catalog().workshop?.enabled ? button('tab', 'discover', '获取更多皮肤') : ''}</div><div class="ws-skins">${auto}${cards}</div>`;
  }
  function renderDevelop() {
    const cat = catalog();
    return `<div class="ws-dev">
      <section class="ws-dev-intro"><span class="eyebrow">BUILD YOUR OWN</span><h3>一个 manifest.json，一个 JS 文件，就是一个插件</h3><p>插件运行在独立的沙箱页面里，用 <code>window.workbench</code> SDK 读取你授予的数据、在面板 / 小组件 / 悬浮窗中绘制界面。SDK 自带跟随皮肤的基础样式。</p></section>
      <ol class="ws-steps">
        <li><strong>创建</strong><p>在服务器的工作台目录运行脚手架：</p><pre><code>npm run plugin:new -- my-plugin</code></pre><p>插件会出现在下方的「插件目录」里；加 <code>--theme</code> 则创建一款皮肤。</p></li>
        <li><strong>调试</strong><p>点下面的「重新扫描」，在「已安装」中启用它。改完代码点插件旁的「重新加载」即可看到效果，不用刷新页面。页面出问题时，在地址后加 <code>?safe</code> 进入安全模式。</p></li>
        <li><strong>分享</strong><p>把插件打包成单个文件，发给朋友导入，或向仓库的 <code>workshop/</code> 目录提交 PR 上架创意工坊：</p><pre><code>npm run plugin:pack -- my-plugin</code></pre></li>
      </ol>
      <div class="ws-dev-actions">${button('rescan', 'rescan', '重新扫描插件目录', { primary: true })}${button('import', 'import', '导入插件包…')}<a class="ws-button" href="${DOCS_URL}" target="_blank" rel="noopener noreferrer">${icon('external')}开发文档</a></div>
      <dl class="ws-facts"><div><dt>插件 SDK</dt><dd>v${esc(cat.sdkVersion || 1)}</dd></div><div><dt>工作台版本</dt><dd>v${esc(cat.workbenchVersion || ctx.version())}</dd></div><div><dt>插件目录</dt><dd><code>${esc(cat.devDir || '登录后显示')}</code></dd></div><div><dt>创意工坊</dt><dd>${cat.workshop?.enabled ? `<code>${esc(cat.workshop.url)}</code>` : '已关闭'}</dd></div></dl>
    </div>`;
  }
  function render() {
    if (!dialog.open) return;
    for (const tab of dialog.querySelectorAll('[data-workshop-tab]')) { const selected = tab.dataset.workshopTab === view.tab; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); }
    $('#workshop-installed-count').textContent = catalog().plugins.length || '';
    $('#workshop-safe').hidden = !safe();
    const query = document.activeElement?.id === 'ws-query' ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
    body.innerHTML = { discover: renderDiscover, installed: renderInstalled, skins: renderSkins, develop: renderDevelop }[view.tab]();
    if (query) { const input = $('#ws-query', body); input?.focus(); input?.setSelectionRange(query.start, query.end); }
  }

  /* ---------- Actions ---------- */
  async function loadRegistry(refresh = false) {
    if (!catalog().workshop?.enabled) return;
    if (view.loading) return view.loading;
    view.loading = ctx.api(`/api/workshop${refresh ? '?refresh=1' : ''}`)
      .then(data => { view.registry = data; view.error = null; }, error => { view.error = error.message; })
      .finally(() => { view.loading = null; render(); });
    render();
    return view.loading;
  }
  async function mutate(id, task) {
    view.busy.add(id); render();
    try { const result = await task(); ctx.plugins.apply(result); return result; }
    catch (error) { ctx.toast(error.message, true); return null; }
    finally { view.busy.delete(id); render(); }
  }
  const enableRequest = (id, enabled, granted = []) => ctx.api(`/api/plugins/${encodeURIComponent(id)}/enable`, { method: 'POST', body: { enabled, granted } });
  async function enable(id) {
    const p = local(id); if (!p || safe()) return;
    const listed = view.registry?.items.find(item => item.id === id);
    if (!(await consent(p, { source: p.source === 'workshop' && listed?.official ? 'official' : p.source }))) return;
    if (await mutate(id, () => enableRequest(id, true, p.permissions))) ctx.toast(`已启用「${p.name}」。`);
  }
  async function disable(id) { const p = local(id); if (p && await mutate(id, () => enableRequest(id, false))) ctx.toast(`已停用「${p.name}」。`); }
  async function install(id) {
    const item = view.registry?.items.find(x => x.id === id); if (!item) return;
    if (item.type === 'plugin' && !(await consent(item, { install: true, source: item.official ? 'official' : 'workshop' }))) return;
    if (!(await mutate(id, () => ctx.api('/api/plugins/install', { method: 'POST', body: { workshopId: id } })))) return;
    loadRegistry();
    if (item.type === 'theme') { ctx.toast(`已安装皮肤「${item.name}」。`, false, { label: '立即使用', run: () => ctx.setTheme(id) }); return; }
    if (safe()) { ctx.toast(`已安装「${item.name}」，退出安全模式后可以启用。`); return; }
    if (await mutate(id, () => enableRequest(id, true, item.permissions))) ctx.toast(`已安装并启用「${item.name}」。`);
  }
  async function update(id) {
    const item = view.registry?.items.find(x => x.id === id); if (!item) return;
    if (!(await mutate(id, () => ctx.api('/api/plugins/install', { method: 'POST', body: { workshopId: id } })))) return;
    loadRegistry();
    ctx.toast(`「${item.name}」已更新到 v${item.version}。`);
    const after = local(id);
    if (after?.needsConsent && !safe() && await consent(after, { source: item.official ? 'official' : 'workshop' })) await mutate(id, () => enableRequest(id, true, after.permissions));
  }
  async function uninstall(id) {
    if (view.armed !== id) { view.armed = id; clearTimeout(view.armTimer); view.armTimer = setTimeout(() => { view.armed = null; render(); }, 4000); render(); return; }
    view.armed = null; clearTimeout(view.armTimer);
    const name = local(id)?.name || id;
    if (await mutate(id, () => ctx.api(`/api/plugins/${encodeURIComponent(id)}/uninstall`, { method: 'POST', body: {} }))) { ctx.toast(`已卸载「${name}」，它保存的数据也已删除。`); if (view.registry) loadRegistry(); }
  }
  async function rescan(quiet = false) {
    const result = await mutate('rescan', () => ctx.api('/api/plugins/rescan', { method: 'POST', body: {} }));
    if (result && !quiet) ctx.toast(`已重新扫描：${result.plugins.length} 个插件，${result.themes.length} 个社区皮肤${result.errors.length ? `，${result.errors.length} 个目录有问题` : ''}。`, result.errors.length > 0);
    return result;
  }
  async function reload(id) {
    if (!(await rescan(true))) return;
    if (ctx.plugins.reload(id)) ctx.toast(`已重新加载「${local(id)?.name || id}」。`);
  }
  async function importFile(file) {
    if (file.size > IMPORT_LIMIT) { ctx.toast('插件包超过 3 MB 上限。', true); return; }
    let bundle;
    try { bundle = JSON.parse(await file.text()); } catch { ctx.toast('这不是有效的插件包：文件需要是 plugin:pack 生成的 .json。', true); return; }
    const result = await mutate('import', () => ctx.api('/api/plugins/install', { method: 'POST', body: { bundle } }));
    const item = result && local(result.installed); if (!item) return;
    if (item.type === 'theme') ctx.toast(`已导入皮肤「${item.name}」。`, false, { label: '立即使用', run: () => ctx.setTheme(item.id) });
    else { view.tab = 'installed'; render(); ctx.toast(`已导入「${item.name}」，打开开关即可启用。`); }
  }
  function useTheme(id) { if (safe()) return; ctx.setTheme(id); render(); }

  // Resolves true only when the user grants every permission the plugin asks for.
  function consent(target, { install: installing = false, source = 'workshop' } = {}) {
    const meta = catalog().permissions || {};
    const perms = [...(target.permissions || [])].sort((a, b) => (meta[b]?.risk === 'medium') - (meta[a]?.risk === 'medium'));
    const list = perms.length ? `<ul class="consent-perms">${perms.map(p => { const info = meta[p] || { label: p, description: '', risk: 'low' }; return `<li class="${info.risk !== 'low' ? 'medium' : ''}"><span class="consent-dot" aria-hidden="true"></span><div><strong>${esc(info.label)}</strong><p>${esc(info.description)}</p></div>${info.risk !== 'low' ? '<span class="ws-chip warn">需留意</span>' : ''}</li>`; }).join('')}</ul>` : '<p class="consent-none">这个插件不申请任何权限，只能显示它自己的界面。</p>';
    consentDialog.innerHTML = `<form method="dialog" class="consent">
      <div class="consent-head">${glyph(target, ' large')}<div><span class="eyebrow">PERMISSIONS</span><h2>${installing ? '安装并启用' : '启用'}「${esc(target.name)}」？</h2><small>v${esc(target.version)}${target.author ? ` · ${esc(target.author)}` : ''}${target.surfaces?.length ? ` · ${target.surfaces.map(s => esc(SURFACES[s] || s)).join('、')}` : ''}</small></div></div>
      ${perms.length ? '<p class="consent-lead">它会获得以下权限：</p>' : ''}${list}
      <div class="consent-note">${icon('shield')}<p>${esc(SOURCE_NOTES[source] || SOURCE_NOTES.workshop)}${esc(target.permissions?.includes('backend') ? '此插件包含服务端模块，以工作台服务账号运行，可使用上面说明的后端能力。界面仍在隔离沙箱内；仅在你信任此版本源码时启用。' : CONSENT_NOTE)}</p></div>
      <div class="dialog-actions"><button class="button button-secondary" value="cancel">取消</button><button class="button button-primary" value="ok">${installing ? '安装并启用' : '授予并启用'}</button></div>
    </form>`;
    consentDialog.returnValue = '';
    consentDialog.showModal();
    $('.button-secondary', consentDialog).focus();
    return new Promise(resolve => consentDialog.addEventListener('close', () => resolve(consentDialog.returnValue === 'ok'), { once: true }));
  }

  const actions = {
    tab: id => { view.tab = id; render(); if (id === 'discover' && !view.registry) loadRegistry(); },
    kind: id => { view.kind = id; render(); },
    'refresh-registry': () => loadRegistry(true),
    install, update, enable, disable, uninstall, reload,
    toggle: id => { const p = local(id); if (p) return p.enabled && !p.needsConsent ? disable(id) : enable(id); },
    rescan: () => rescan(),
    import: () => fileInput.click(),
    'use-theme': useTheme,
    noop: () => {},
  };
  body.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled || !body.contains(target)) return;
    Promise.resolve(actions[target.dataset.action]?.(target.dataset.id)).catch(error => ctx.toast(error.message, true));
  });
  body.addEventListener('input', event => { if (event.target.id === 'ws-query') { view.query = event.target.value; const grid = $('#ws-grid', body); if (grid) grid.innerHTML = gridHtml(); } });
  for (const tab of dialog.querySelectorAll('[data-workshop-tab]')) tab.addEventListener('click', () => actions.tab(tab.dataset.workshopTab));
  $('#workshop-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  consentDialog.addEventListener('click', event => { if (event.target === consentDialog) consentDialog.close(); });
  fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; fileInput.value = ''; if (file) importFile(file); });

  return {
    open(tab) {
      if (tab) view.tab = tab;
      dialog.showModal(); render();
      if (!ctx.plugins.data) ctx.plugins.load().then(render, error => ctx.toast(`插件列表暂时无法读取：${error.message}`, true));
      if (view.tab === 'discover' && !view.registry) loadRegistry();
      dialog.querySelector(`[data-workshop-tab="${view.tab}"]`)?.focus();
    },
    close() { if (consentDialog.open) consentDialog.close(); if (dialog.open) dialog.close(); },
    refresh: render,
    themeChanged() { if (view.tab === 'skins' || view.tab === 'discover') render(); },
  };
}
