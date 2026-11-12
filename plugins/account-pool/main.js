(() => {
  'use strict';
  const wb = window.workbench, { h, svg, format } = wb;
  const strategies = [
    { key: 'sticky', label: '保持当前账号，额度不足时切换', title: '保持当前账号', detail: '一直用同一个账号，额度快用完才换' },
    { key: 'round-robin', label: '每轮轮询可用账号', title: '轮流使用', detail: '每一轮换到下一个可用账号' },
    { key: 'quota', label: '优先使用余量最多的账号', title: '余量优先', detail: '每一轮都挑剩余额度最多的账号' }];
  const levels = [[90, '已用 90%'], [95, '已用 95%'], [98, '已用 98%'], [100, '仅用尽后']];
  const RUNNING = ['running', 'awaiting_approval', 'stopping'];
  let state = null, sessions = [], busy = false, dirty = false, refreshPending = false, loading = false, revision = 0;
  const root = h('main', { class: 'ap-panel' });
  const notice = h('p', { class: 'ap-notice', role: 'status', 'aria-live': 'polite', hidden: true });
  const content = h('div', { class: 'ap-content' });
  // Session events can arrive while a name is being typed. Keep those drafts in
  // their existing DOM until an explicit operation succeeds or is cancelled.
  content.addEventListener('input', event => { if (event.target.matches('[data-draft]')) dirty = true; });
  const login = h('section', { class: 'wb-card ap-login', hidden: true });
  const show = message => { notice.textContent = message; notice.hidden = !message; };
  const button = (text, action, options = {}) => h('button', { type: 'button', class: 'wb-btn small', disabled: busy, onclick: action, ...options }, text);
  const percent = window => Number.isFinite(window?.utilization) ? `${Math.round(window.utilization)}%` : '未知';
  const selector = (options, value, label) => {
    const select = h('select', { class: 'ap-input', 'aria-label': label, disabled: busy }, options.map(([key, text]) => h('option', { value: key }, text)));
    select.value = value;
    return select;
  };
  const ICONS = { layers: ['m12 3 10 6-10 6L2 9l10-6Zm-10 12 10 6 10-6M2 12l10 6 10-6'],
    refresh: ['M20 7v5h-5M4 17v-5h5', 'M6.1 6.1A8 8 0 0 1 19.4 9L20 12M4 12l.6 3A8 8 0 0 0 17.9 17.9'],
    plus: ['M12 5v14M5 12h14'], clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7v5l3 2'],
    shield: ['m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z', 'm9 12 2 2 4-4'] };
  const icon = name => svg('svg', { class: 'ap-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, ...ICONS[name].map(d => svg('path', { d })));
  const resetFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  function remaining(value) {
    const seconds = Math.ceil((Date.parse(value) - Date.now()) / 1000);
    if (!Number.isFinite(seconds)) return '';
    if (seconds <= 0) return '等待刷新';
    const pad = number => String(number).padStart(2, '0'), days = Math.floor(seconds / 86400);
    return `${days ? `${days} 天 ` : ''}${pad(Math.floor(seconds % 86400 / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(seconds % 60)}`;
  }
  const countdown = value => h('b', { class: 'wb-num', 'data-countdown': value }, remaining(value));
  const accountName = id => state?.accounts.find(account => account.id === id)?.label || '已移除的账号';
  // What the plugin last did on its own for a conversation: moved it off an unusable pinned account, or
  // continued a task whose account ran out of quota.
  function noteText(note, name) {
    if (!note) return null;
    if (note.kind === 'continuing') return { tone: 'info', short: '额度用尽 · 换号中…', text: `「${name(note.from)}」额度用尽，正在换号继续` };
    if (note.kind === 'continued') return { tone: '', short: `已换到${name(note.to)}继续`, text: `「${name(note.from)}」额度用尽，已换到「${name(note.to)}」继续` };
    if (note.kind === 'released') return { tone: '', short: `已换到${name(note.to)}`, text: `固定的「${name(note.from)}」暂时不可用，已换到「${name(note.to)}」并改为自动` };
    if (note.kind === 'failed') return { tone: 'warn', short: '额度用尽 · 未能换号', text: note.message || '额度用尽，未能自动换号继续' };
    return null;
  }

  async function act(method, params = {}) {
    if (busy) return;
    busy = true; revision++; show(''); root.setAttribute('aria-busy', 'true');
    const controls = [...root.querySelectorAll('button,input,select')].map(element => [element, element.disabled]);
    for (const [element] of controls) element.disabled = true;
    let succeeded = false;
    try { state = await wb.backend.call(method, params); dirty = false; succeeded = true; }
    catch (error) { show(error.message || '操作未完成，请重试。'); }
    finally {
      busy = false; root.removeAttribute('aria-busy');
      for (const [element, disabled] of controls) element.disabled = disabled;
      // A failed immediate change (strategy, binding) must not leave its control showing the rejected value.
      if (succeeded || !dirty) { render(); if (refreshPending) void load(); }
    }
  }

  async function load() {
    if (busy || dirty) { refreshPending = true; return; }
    if (loading) { refreshPending = true; return; }
    loading = true; refreshPending = false;
    const requestRevision = revision;
    try {
      const result = await Promise.all([wb.backend.call('list'), wb.sessions.list()]);
      if (dirty || busy || revision !== requestRevision) { refreshPending = true; return; }
      [state, sessions] = result;
      refreshPending = false; render();
    } catch (error) { show(error.message || '无法读取插件状态。'); }
    finally { loading = false; if (refreshPending && !dirty && !busy) void load(); }
  }

  async function showLogin(account) {
    try {
      const result = await wb.backend.call('loginCommand', { id: account.id });
      const command = h('textarea', { class: 'ap-command', readOnly: true, rows: 5, 'aria-label': '官方登录命令' });
      command.value = result.command;
      login.replaceChildren(h('div', { class: 'wb-between' }, h('h2', null, `「${account.label}」的官方登录`),
        button('收起', () => { login.hidden = true; }, { class: 'wb-btn small ghost' })),
        h('p', { class: 'wb-muted' }, result.note), command,
        h('div', { class: 'ap-actions' },
          button('选中命令', () => { command.focus(); command.select(); }),
          button('登录完成，刷新状态', () => act('refresh', { id: account.id }), { class: 'wb-btn small primary' })),
        h('p', { class: 'ap-hint' }, '使用你已有的官方账号登录。每个额外账号使用自己的配置目录；请勿向工作台粘贴密码、Token 或授权码。'));
      login.hidden = false;
      login.scrollIntoView({ block: 'nearest' });
      command.focus(); command.select();
    } catch (error) { show(error.message); }
  }

  function meter(label, window, showRemaining) {
    const used = Number.isFinite(window?.utilization) ? Math.min(100, Math.max(0, window.utilization)) : null;
    const shown = used === null ? null : showRemaining ? 100 - used : used;
    const level = used === null ? '' : used >= 90 ? ' bad' : used >= 75 ? ' warn' : '';
    const reset = Date.parse(window?.resetsAt);
    return h('div', { class: 'ap-meter' },
      h('div', { class: 'wb-between' }, h('span', { class: 'ap-meter-label' }, label), shown === null
        ? h('span', { class: 'ap-unknown' }, '待官方数据')
        : h('strong', { class: 'ap-meter-value wb-num' }, String(Math.round(shown)), h('small', null, '%'))),
      h('div', { class: `wb-progress${level}` }, h('span', { style: { width: `${shown ?? 0}%` } })),
      h('div', { class: 'ap-reset' }, Number.isFinite(reset)
        ? [h('span', null, `${resetFormat.format(new Date(reset))} 重置`), h('span', null, countdown(window.resetsAt), ' 后')]
        : h('span', null, '重置时间待官方数据')));
  }

  function accountCard(account) {
    const { auth, usage = {} } = account, loggedIn = auth.loggedIn;
    const working = sessions.some(session => RUNNING.includes(session.status) && state.bindings[session.id]?.accountId === account.id);
    const [tone, status] = !account.enabled ? ['muted', '已停用 · 登录保留'] : usage.rateLimited ? ['bad', '额度暂不可用']
      : loggedIn === true ? ['ok', working ? '正在执行任务' : '已就绪'] : loggedIn === false ? ['warn', '尚未登录'] : ['muted', '登录状态待确认'];
    const plan = loggedIn === true ? h('span', { class: 'wb-tag' }, auth.subscriptionType || '已登录')
      : h('span', { class: 'wb-tag muted' }, loggedIn === false ? '待登录' : '待确认');
    const pinned = Object.values(state.bindings).filter(binding => binding.pinned && binding.accountId === account.id).length;
    const name = h('input', { class: 'ap-input', value: account.label, maxLength: 60, required: true, 'data-draft': '', 'aria-label': '账号名称' });
    const rename = h('form', { class: 'ap-rename', hidden: true, onsubmit: event => { event.preventDefault(); void act('update', { id: account.id, label: name.value }); } },
      name, h('button', { type: 'submit', class: 'wb-btn small primary', disabled: busy }, '保存'),
      button('取消', () => { rename.hidden = true; name.value = account.label; dirty = false; if (refreshPending) void load(); }));
    const scoped = (usage.scopes || []).filter(item => item?.kind === 'weekly_scoped' && item.model && Number.isFinite(item.utilization));
    const scopeRows = scoped.length ? h('div', { class: 'ap-scopes' }, scoped.map(item => {
      const used = Math.min(100, Math.max(0, item.utilization)), left = 100 - used;
      const level = used >= 90 ? ' bad' : used >= 75 ? ' warn' : '';
      return h('div', { class: 'ap-scope-row', title: item.resetsAt ? `${resetFormat.format(new Date(item.resetsAt))} 重置` : '' },
        h('span', null, `${item.model} 周剩余`),
        h('div', { class: `wb-progress${level}` }, h('span', { style: { width: `${left}%` } })),
        h('strong', { class: 'wb-num' }, `${Math.round(left)}%`));
    })) : null;
    const cooldown = usage.rateLimited ? h('p', { class: 'ap-cooldown' }, icon('clock'), usage.cooldownUntil
      ? h('span', null, '官方额度暂不可用，冷却剩余 ', countdown(usage.cooldownUntil)) : h('span', null, '官方额度暂不可用，请稍后刷新')) : null;
    return h('article', { class: `ap-account${account.enabled ? '' : ' disabled'}${account.isDefault ? ' default' : ''}` },
      h('div', { class: 'ap-account-head' }, h('span', { class: 'ap-avatar' }, icon('layers')),
        h('div', { class: 'ap-identity' }, h('h3', { class: 'wb-ellipsis' }, account.label),
          h('p', { class: 'wb-ellipsis' }, auth.emailMask || (loggedIn === true ? '已完成官方登录' : '等待官方登录'), account.primary ? ' · 工作台原有配置' : '')), plan),
      h('div', { class: 'ap-status' }, h('span', { class: 'wb-row' }, h('i', { class: `ap-dot ${tone}` }), status),
        account.isDefault ? h('span', { class: 'ap-badge' }, '默认账号') : pinned ? h('span', { class: 'ap-badge muted' }, `${pinned} 个会话固定使用`) : null),
      h('div', { class: 'ap-meters' }, meter('5 小时已用', usage.fiveHour, false), meter('本周剩余', usage.sevenDay, true), scopeRows),
      cooldown,
      h('p', { class: 'ap-checked' }, usage.updatedAt ? `额度更新于 ${format.relative(usage.updatedAt)}` : usage.unavailableReason || '尚未读取额度'),
      h('div', { class: 'ap-actions' },
        account.enabled && loggedIn !== true ? button('登录说明', () => showLogin(account), { class: 'wb-btn small primary' }) : null,
        button([icon('refresh'), '刷新'], () => act('refresh', { id: account.id }), { 'aria-label': `刷新「${account.label}」的状态` }),
        button('重命名', () => { rename.hidden = false; name.focus(); name.select(); }),
        !account.isDefault ? button('设为默认', () => act('update', { id: account.id, isDefault: true, enabled: true })) : null,
        !account.isDefault ? button(account.enabled ? '停用' : '启用', () => act('update', { id: account.id, enabled: !account.enabled })) : null),
      rename);
  }

  function sessionRow(session) {
    const binding = state.bindings[session.id], running = RUNNING.includes(session.status);
    const accounts = state.accounts.filter(account => account.enabled || (binding?.pinned && binding.accountId === account.id));
    const select = selector([['', binding?.accountId && !binding.pinned ? `自动 · 上次用「${accountName(binding.accountId)}」` : '自动（跟随策略）'],
      ...accounts.map(account => [account.id, `固定 · ${account.label}${account.enabled ? '' : '（已停用）'}`])],
    binding?.pinned ? binding.accountId : '', `「${session.title || '新的对话'}」使用的账号`);
    select.disabled = busy || running;
    select.addEventListener('change', () => act('bind', { sessionId: session.id, accountId: select.value || null }));
    const note = noteText(state.notes?.[session.id], accountName);
    return h('li', null, h('span', { class: 'ap-session wb-ellipsis' }, session.title || '新的对话'),
      note ? h('span', { class: `wb-tag ${note.tone || 'muted'}`, title: note.text }, note.short) : null,
      running ? h('span', { class: 'wb-tag info' }, '运行中') : null, select);
  }

  function render() {
    if (!state) return;
    const { accounts, settings } = state, full = accounts.length >= 10;
    // Same rule as the cards: an account in its official cooldown is not counted as available.
    const available = accounts.filter(account => account.enabled && account.auth.loggedIn === true && !account.usage?.rateLimited).length;
    const current = strategies.find(item => item.key === settings.strategy) || strategies[0];
    const threshold = selector(levels.map(([value, text]) => [String(value), text]), String(settings.switchAt), '提前换号');
    threshold.addEventListener('change', () => act('settings', { switchAt: Number(threshold.value) }));
    const autoContinue = h('input', { type: 'checkbox', checked: settings.autoContinue !== false, disabled: busy, 'aria-label': '额度用尽时自动换号继续' });
    autoContinue.addEventListener('change', () => act('settings', { autoContinue: autoContinue.checked }));
    const label = h('input', { class: 'ap-input', placeholder: '例如：工作账号 2', maxLength: 60, required: true, disabled: busy || full, 'data-draft': '', 'aria-label': '新账号名称' });
    const recent = sessions.filter(session => !session.archived).slice(0, 12);
    content.replaceChildren(
      h('div', { class: 'ap-overview' },
        h('span', { class: 'wb-row' }, h('i', { class: `ap-dot ${available ? 'ok' : 'warn'}` }), h('strong', null, `${available} 个可用`)),
        h('span', null, `${accounts.length} / 10 个账号空间`),
        h('span', null, `每轮：${current.title}`),
        button([icon('refresh'), busy ? '处理中…' : '刷新状态'], () => act('refresh'), { class: 'wb-btn small ap-push' })),
      h('div', { class: 'ap-grid' }, accounts.map(accountCard)),
      login,
      h('form', { class: 'wb-card ap-create', onsubmit: event => { event.preventDefault(); void act('create', { label: label.value }); } },
        h('label', null, '添加一个账号'),
        h('div', { class: 'ap-create-row' }, label, h('button', { type: 'submit', class: 'wb-btn primary', disabled: busy || full }, icon('plus'), '添加账号')),
        h('p', { class: 'ap-hint' }, full ? '已达到 10 个账号空间。可以重命名或停用现有账号。' : '最多 10 个。添加后按「登录说明」用你已有的官方账号登录；不会自动注册账号。')),
      h('section', { class: 'wb-card' },
        h('h2', null, '每轮开始时怎么选账号'),
        h('p', { class: 'ap-hint' }, '只在新一轮开始前选择，运行中的任务不会被切走。固定了账号的会话一直用该账号；它额度用尽、退出登录或被停用时，会话换到下面选出的账号并改为自动。未知额度不算用尽，达到官方限制的账号会暂时跳过。'),
        h('div', { class: 'ap-strategies', role: 'radiogroup', 'aria-label': '账号选择策略' }, strategies.map(item =>
          h('button', { type: 'button', class: 'ap-strategy', role: 'radio', 'aria-checked': String(item === current), disabled: busy,
            onclick: () => { if (item !== current) void act('settings', { strategy: item.key }); } },
          h('strong', null, item.title), h('span', null, item.detail)))),
        h('label', { class: 'ap-threshold' }, h('span', null, '提前换号'), threshold, h('span', { class: 'wb-faint' }, '额度用到这个比例时，下一轮换到别的账号')),
        h('label', { class: 'ap-threshold ap-toggle' }, autoContinue, h('span', null, '额度用尽时自动换号继续'),
          h('span', { class: 'wb-faint' }, '任务做到一半账号额度用尽时，换到还有额度的账号，接着原来的对话继续；每个账号每项任务只试一次'))),
      h('section', { class: 'wb-card' },
        h('h2', null, '会话使用的账号'),
        h('p', { class: 'ap-hint' }, '输入框左侧的账号选择器也能切换。固定后这个会话一直用该账号，直到它不可用；自动则跟随上面的选择方式。切换时只接续这个会话的官方记录，工作区不动。'),
        recent.length ? h('ul', { class: 'wb-list ap-bindings' }, recent.map(sessionRow)) : h('div', { class: 'wb-empty' }, '还没有会话。')),
      h('p', { class: 'ap-footer' }, icon('shield'), h('span', null, '登录和 Claude 请求都由这台服务器上的官方 CLI 发出；账号配置与会话绑定只保存在这里。停用账号会保留登录状态。')));
  }

  // The background surface keeps the sidebar entry and the composer's account picker current.
  // Picking an account for an open conversation binds it now; for a new conversation the page
  // keeps the choice and sends it with the first message.
  function startBackground() {
    const AUTO = 'auto';
    let snapshot = null, loading = false, again = false, timer = null;
    const named = id => snapshot?.accounts.find(account => account.id === id)?.label || '已移除的账号';
    const quota = account => {
      const scoped = (account.usage?.scopes || []).filter(item => item?.kind === 'weekly_scoped' && item.model && Number.isFinite(item.utilization));
      const parts = [
        Number.isFinite(account.usage?.fiveHour?.utilization) ? `5 小时 ${percent(account.usage.fiveHour)}` : '',
        Number.isFinite(account.usage?.sevenDay?.utilization) ? `每周 ${percent(account.usage.sevenDay)}` : '',
        ...scoped.map(item => `${item.model} ${Math.round(item.utilization)}%`),
      ].filter(Boolean);
      return parts.length ? ` · ${parts.join(' · ')}` : '';
    };
    function publish() {
      const accounts = snapshot.accounts, loggedIn = accounts.filter(account => account.enabled && account.auth.loggedIn === true).length;
      const notes = snapshot.notes || {}, failed = Object.values(notes).filter(note => note.kind === 'failed').length;
      wb.ui.setSidebar({ subtitle: failed ? `${failed} 个会话额度用尽，未能换号` : `${loggedIn} 个已登录 · ${accounts.length} 个账号`,
        tone: loggedIn && !failed ? '' : 'warn' }).catch(() => {});
      const strategy = strategies.find(item => item.key === snapshot.settings.strategy)?.label || '';
      const options = [{ value: AUTO, label: '自动选择', detail: `跟随全局策略：${strategy}` },
        ...accounts.map(account => ({ value: account.id, label: account.label,
          detail: `${!account.enabled ? '已停用' : account.auth.loggedIn === true ? '已登录' : account.auth.loggedIn === false ? '未登录' : '登录状态待确认'}${quota(account)}`,
          disabled: !account.enabled || account.auth.loggedIn === false }))];
      // Unpinned conversations show which account they used last; the picker still means "automatic".
      // An automatic switch or continuation shows in its place until the next turn the user starts.
      const values = Object.fromEntries(Object.entries(snapshot.bindings).slice(-1000).map(([sessionId, binding]) => {
        const note = noteText(notes[sessionId], named);
        if (note) return [sessionId, { value: binding.pinned ? binding.accountId : AUTO, label: note.short }];
        return [sessionId, binding.pinned ? binding.accountId : { value: AUTO, label: `自动 · ${named(binding.accountId)}` }];
      }));
      wb.composer.setPicker({ options, value: AUTO, values, title: '本会话使用的官方账号' }).catch(() => {});
    }
    async function refresh() {
      if (loading) { again = true; return; }
      loading = true; again = false;
      try { snapshot = await wb.backend.call('list'); publish(); } catch {}
      finally { loading = false; if (again) void refresh(); }
    }
    // Session events stream during a turn, so collect them into at most one read per second.
    const soon = () => { timer ??= setTimeout(() => { timer = null; void refresh(); }, 1000); };
    wb.on('composer:change', async ({ sessionId, value, requestId }) => {
      let result = { ok: true };
      if (sessionId) {
        try { snapshot = await wb.backend.call('bind', { sessionId, accountId: value === AUTO ? null : value }); }
        catch (error) { result = { ok: false, message: error.message || '切换账号没有完成。' }; }
      }
      await wb.composer.reply(requestId, result).catch(() => {});
      if (snapshot) publish();
    });
    // Bindings move when a turn starts; the backend announces its own changes as runtime events.
    wb.on('runtime', soon);
    wb.on('session', soon);
    refresh();
    setInterval(refresh, 60000);
  }

  function startPanel() {
    root.append(h('header', { class: 'ap-hero' }, h('span', { class: 'wb-eyebrow' }, 'Account pool · 可选插件'),
      h('h1', null, '账号各自在线，工作接着继续。'),
      h('p', { class: 'wb-muted' }, '每个账号独立登录、独立额度。由你选择账号与策略，官方 CLI 负责登录和执行。')),
    notice, content);
    document.body.append(root);
    load();
    wb.on('visibility', ({ visible }) => { if (visible) load(); });
    wb.on('session', load);
    wb.on('runtime', load);
    setInterval(() => {
      for (const element of root.querySelectorAll('[data-countdown]')) {
        const text = remaining(element.dataset.countdown);
        if (element.textContent !== text) element.textContent = text;
      }
    }, 1000);
  }

  wb.ready().then(info => (info.surface === 'background' ? startBackground : startPanel)());
})();
