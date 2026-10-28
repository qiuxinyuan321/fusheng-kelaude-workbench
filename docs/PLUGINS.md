# 插件与皮肤开发指南

浮生氪劳德工作台是一个可以扩展的底座：用一个 `manifest.json` 加一个 JS 文件，就能给它加上新的面板、监控小组件、桌面宠物或状态栏小工具；只用一个 `manifest.json`，就能做出一款新皮肤。做好的作品可以打包发给朋友，也可以提交到仓库，上架**创意工坊**。

<p align="center">
  <img src="assets/screenshots/workshop.webp" alt="创意工坊" width="100%">
</p>

- [概览](#概览)
- [内置可选服务端插件](#内置可选服务端插件)
- [五分钟上手](#五分钟上手)
- [manifest.json](#manifestjson)
- [界面](#界面)
- [权限](#权限)
- [SDK 参考](#sdk-参考)
- [事件](#事件)
- [样式](#样式)
- [制作皮肤](#制作皮肤)
- [打包、分享与导入](#打包分享与导入)
- [上架创意工坊](#上架创意工坊)
- [安全模型](#安全模型)
- [版本与兼容](#版本与兼容)
- [常见问题](#常见问题)

## 概览

| | 普通界面插件 | 皮肤 |
| --- | --- | --- |
| 是什么 | 一个目录：`manifest.json` + JS（可选 CSS、图片、字体） | 只有一个 `manifest.json`，里面是一组颜色 |
| 能做什么 | 面板、监控小组件、悬浮窗、后台任务、状态栏、命令面板 | 改变整个工作台的配色，终端、编辑器和插件一起换色 |
| 运行在哪 | 浏览器里的沙箱 iframe，服务器不执行其 JS | 浏览器里，只作为 CSS 变量生效 |
| 能看到什么 | 只有你授予的[权限](#权限)对应的数据 | 什么也看不到 |

插件有四种来源，在「创意工坊 → 已安装」里会分别标出：

| 来源 | 说明 |
| --- | --- |
| 内置 | 仓库 `plugins/` 目录自带的五个插件，包含多账号轮询与任务断点续跑。全部默认关闭 |
| 创意工坊 | 从创意工坊目录下载，安装前校验 sha256 |
| 本地导入 | 在「开发」页导入的 `.json` 插件包 |
| 开发中 | 直接放在插件目录里的文件夹，可以随时「重新加载」 |

不管来源是什么，插件都要经过你确认权限才会启用。

## 内置可选服务端插件

从工作台 v1.2.0 起，管理员可以随源码安装带有可信后端的插件。它们的界面仍在 iframe 中运行，后端则由 Node.js 服务加载，拥有服务账号权限。普通创意工坊作品、网页导入包和数据目录中的开发插件不能声明或加载服务端入口。

| 插件 | 插件自己负责 | 启用后的操作 |
| --- | --- | --- |
| [`account-pool`](../plugins/account-pool/README.md) 多账号轮询 | 独立账号配置、官方登录状态、默认账号、会话绑定、逐轮轮询与额度策略、当前会话记录迁移；侧边栏「账号空间」入口与输入框账号选择器 | 添加配置，按官方命令登录后刷新；选择保持当前、轮询或余量优先。最多 10 个配置 |
| [`task-resume`](../plugins/task-resume/README.md) 任务断点续跑 | 检查点、恢复状态、有限次数的恢复队列 | 从原会话检查点继续；自动恢复另外默认关闭，开启后仍受次数、等待时间、共享执行锁和审批状态约束 |

两者可分别启用。仅启用多账号不会自动重试任务；仅启用续跑则继续使用底座原有的账号配置。账号切换只在新一轮开始前进行；续跑使用官方 `--resume`，不是恢复进程内存，也不能保证外部操作恰好执行一次。

底座只提供通用的权限桥、运行生命周期、共享忙锁、执行参数和会话归属门禁。账号选择和恢复策略没有写入底座。分别改动某个插件的目录、提升其 `manifest.json` 版本并跑对应测试，即可维护该插件；底座升级按自己的兼容版本进行。服务端代码不能通过界面“重新加载”热更新，替换可信源码后需要重启工作台。部署入口和备份、升级步骤见 [部署指南](DEPLOYMENT.md)。

**启停与就绪**：所有内置插件默认关闭，可信后端还必须明确授予 `backend` 权限。工作台通过插件的通用 `executionStatus()` 显示执行就绪状态；账号插件有已启用且已确认登录的账号时即可提供就绪状态，最终账号和额度仍在每轮启动前核对。检查状态遇到任务或终端忙时只读取缓存，不抢占运行。

插件停用后不再接受新动作，任务恢复队列也停止。使用独立账号配置的会话由宿主持久记录归属；相应插件停用、加载失败或进入服务端安全模式时，这些会话会拒绝续聊，不会悄悄切回默认配置。重新启用插件后可继续处理；若要脱离账号插件，应先将会话绑定默认账号并成功运行一轮完成记录迁移。停用不删除插件私有数据。

### 可信后端声明与契约

在随源码安装的插件清单中，同时声明：

```json
{
  "backend": "backend.mjs",
  "permissions": ["backend"],
  "engines": { "workbench": ">=1.2.0" }
}
```

这是清单中的增量字段；仍需正常的 `id`、`version`、`main` 和界面声明。`backend` 只接受插件目录内的 `.mjs` 文件。后端导出 `activate(context)`，返回以下可选钩子与自己的 `call` 方法：

| 接口 | 宿主契约 |
| --- | --- |
| `managesExecutionContext: true` | 返回对象声明本插件会改变执行配置；宿主在调用其 `beforeRun` 前先持久保存会话归属，避免部分准备失败后丢失配置保护 |
| `call(method, params)` | 只处理本插件白名单方法；需要执行或修改运行状态时，使用 `context.withExclusive(fn)`，并在异步动作前后检查 `context.isActive()` |
| `beforeRun({session,cwd,request,run,kind})` | 宿主已为这个会话占好运行位，不应再次拿锁。不同会话可以并行运行，其他会话的任务可能正在进行，也可能紧接着调用 `beforeRun`；需要串行的插件状态请自己排队（例如账号插件的操作队列）。独占操作进行期间宿主不会开始新的一轮。`request.choice` 是本插件[输入框选择器](#侧边栏入口与输入框选择器)在新对话发送第一条消息时带来的值，没有时为 `null`；宿主只把属于本插件的那一项交给它，并已检查格式，含义由插件自己校验。当前可返回 `{runnerOptions:{configDir},ownsContext}`，`configDir` 必须是绝对路径 |
| `onEvent(payload)` | 按原运行顺序接收事件；不得把未知或旧轮次事件写入当前检查点 |
| `onExit(payload)` / `onStop(payload)` | 记录结束、手动停止或服务中断；是否恢复属于插件策略 |
| `executionStatus()` | 返回 `{ready: true \| false \| null, label, detail}`，仅报告就绪状态，不暴露凭据 |
| `readUsage({session,choice,refresh,inProgress})` | 可选，返回当前执行配置的额度快照（可带 `contextLabel`），或 `null` 交给原有单账号监控。新对话尚未创建时 `session` 为 `null`；`choice` 仅含本插件的输入框选项。`refresh` 请求强制刷新；`inProgress` 表示该会话仍有任务或终端，快照应以实际执行账号为准。两个插件同时返回快照时拒绝合并 |
| `close()` | 停止插件自己的队列与监控，等待必要持久化，不影响其他插件 |

`context` 提供该插件私有 `dataDir`、`binary`、`workspaceRoot`、`getSession`、`listSessions`、`startTurn`、`isBusy`、`isClosing`、`withExclusive`、`isActive` 和 `runtimeChanged()`。改变登录状态或执行设置后调用 `runtimeChanged()`，通知页面重新读取就绪状态，申请了 `backend` 的插件界面也会收到 `runtime` 事件；宿主聚合的结果通过 `bootstrap.execution` 提供。`isBusy()` 在任何任务、终端或文件/配置操作进行时为真；`withExclusive(fn)` 要等它们全部结束才执行，执行期间宿主拒绝新任务。恢复启动必须走 `startTurn`，继续复用底座的账号预检、按会话的运行占位、并行上限与原有权限模式；不要另起绕过宿主的任务进程。

后端数据在 `<WORKBENCH_DATA>/server-plugin-data/<id>/`，与普通 SDK 的 256 KB `storage` 分开。账号元数据和续跑检查点使用原子 JSON 写入；官方 CLI 自己管理额外账号配置内的认证材料。只有本插件所需的状态通过受权限控制的 API 返回给界面，不把原始会话或认证材料作为通用 SDK 数据提供。

`context.usageChanged()` 通知页面重新读取当前会话额度。页面通过 `GET /api/usage?sessionId=<id>` 获取对应执行配置的快照；新对话或第一条消息尚未发送的选择可另带 `choices`（JSON 编码的 `{ pluginId: value }`，格式与消息请求相同）。宿主只把属于该插件的选项交给它。不带会话和选项时仍返回原有配置的额度。独立配置的运行事件不写入原有配置的额度缓存。额度查询不改变账号绑定、不执行模型请求。后台推送与旧请求的结果不能覆盖另一会话或新对话选择的显示。

## 五分钟上手

**1. 生成一个插件**

在服务器的工作台目录里运行：

```bash
npm run plugin:new -- hello-world
```

脚手架会在插件目录（`<WORKBENCH_DATA>/plugins/`，未设置 `WORKBENCH_DATA` 时是仓库旁的 `data/plugins/`）里创建：

```text
hello-world/
├── manifest.json   # 名称、权限和界面
├── main.js         # 插件脚本，运行在沙箱 iframe 里
├── style.css       # 样式，可以直接使用 --wb-* 皮肤变量
└── README.md
```

它自带一个面板、一个监控小组件和一条命令，演示了存储、提示消息和多个界面之间的数据同步。

> [!TIP]
> 生产环境下，插件目录属于运行工作台的服务账号。可以用对应账号运行脚手架，也可以加上 `--dir ./my-plugins` 在别处生成，开发完再[打包导入](#打包分享与导入)。

**2. 启用它**

打开工作台 → 顶栏的 **创意工坊** → **开发** → **重新扫描插件目录**，然后在 **已安装** 里点「启用」，确认它申请的权限。顶栏会多出一个「Hello World」标签，「运行监控」页底部会多出一张小组件卡片，<kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>K</kbd> 命令面板里会多出「打个招呼」。

**3. 改代码**

编辑 `main.js` 或 `style.css`，然后在「已安装」里点插件旁的 **重新加载**，不用刷新整个页面。改了 `manifest.json`（例如新增权限或界面）时，先点「重新扫描插件目录」。

一个最小的插件只需要这几行：

```js
// main.js
workbench.ready().then(async info => {
  const { h } = workbench;
  const data = await workbench.usage.get();   // 需要 usage.read 权限
  document.body.append(h('div', { class: 'wb-card' },
    h('span', { class: 'wb-eyebrow' }, '5 小时额度'),
    h('strong', { class: 'wb-num' }, workbench.format.percent(data.fiveHour.utilization))));
});
```

## manifest.json

```json
{
  "id": "focus-timer",
  "type": "plugin",
  "name": "番茄专注",
  "version": "1.0.0",
  "description": "番茄工作法计时器：专注 25 分钟、休息 5 分钟，状态栏实时倒计时。",
  "author": "你的名字",
  "license": "MIT",
  "engines": { "workbench": ">=1.1.0" },
  "icon": "🍅",
  "accent": "#d1493f",
  "tags": ["效率", "专注"],
  "permissions": ["storage", "ui.toast", "ui.statusbar"],
  "main": "timer.js",
  "style": "timer.css",
  "contributes": {
    "panel": { "title": "番茄专注" },
    "background": true,
    "commands": [
      { "id": "toggle", "title": "开始 / 暂停番茄钟", "subtitle": "在状态栏倒计时", "icon": "clock" },
      { "id": "open", "title": "打开番茄专注", "icon": "clock", "action": "open-panel" }
    ]
  }
}
```

| 字段 | 必填 | 说明 |
| --- | :---: | --- |
| `id` | ✓ | 2–40 个字符：小写字母、数字和连字符，以字母或数字开头。**必须与目录名一致** |
| `type` | | `plugin`（默认）或 `theme` |
| `name` | ✓ | 显示名称，最多 24 个字符 |
| `version` | ✓ | `x.y.z`，每段 1–4 位数字 |
| `description` | | 最多 160 个字符 |
| `author` / `license` | | 最多 40 / 24 个字符 |
| `engines.workbench` | 上架必填 | 需要的最低工作台版本，写成 `">=1.1.0"`。工作台版本更低时插件不会运行 |
| `icon` | | 一个 emoji 或 1–2 个字符，默认取名称的第一个字 |
| `accent` | | `#rrggbb`，用于卡片和图标的强调色 |
| `tags` | | 最多 6 个，每个最多 12 个字符 |
| `permissions` | | 申请的[权限](#权限)，只能使用已知的权限名 |
| `main` | 插件必填 | 入口脚本，`.js` 或 `.mjs` |
| `style` | | 样式表，`.css` |
| `backend` | 可信后端可选 | `.mjs` 服务端入口，必须同时申请 `backend` 权限；仅允许管理员随工作台源码安装 |
| `contributes` | 插件必填 | 插件提供的[界面](#界面)，至少一个 |

- 文件路径只能使用字母、数字、`.`、`_`、`-` 和 `/`，不能包含 `..`，最长 160 个字符、8 层目录。
- 插件可以附带的文件类型：`.js` `.mjs` `.css` `.json` `.svg` `.png` `.webp` `.gif` `.jpg` `.jpeg` `.woff2` `.txt` `.md`。
- 所有文本字段里的控制字符、零宽字符和双向文本控制符都会被移除，防止插件用看起来一样的名字冒充别人。

## 界面

同一个 `main` 脚本会在插件声明的**每个界面里各加载一次**，用 `workbench.info.surface` 区分当前是哪一个：

| 界面 | 声明 | 显示在哪里 | 选项 |
| --- | --- | --- | --- |
| `panel` | `"panel": { "title": "…" }` | 顶栏的一个新标签，整页面板。第一次打开时才加载 | `title` 最多 16 个字符 |
| `widget` | `"widget": { "title": "…", "height": 220, "size": "normal" }` | 「运行监控」页里的一张卡片。打开监控页时才加载 | `height` 80–640（默认 220）；`size` 为 `normal` 或 `wide`（占满一行） |
| `overlay` | `"overlay": { "width": 160, "height": 160, "anchor": "bottom-right" }` | 悬浮在页面角落，可以拖动和隐藏，适合宠物 | `width` / `height` 48–420（默认 160）；`anchor` 为 `bottom-right` `bottom-left` `top-right` `top-left` |
| `background` | `"background": true` | 看不见，页面打开期间一直运行，适合计时器和数据采集 | — |

**命令** `contributes.commands` 会出现在命令面板（<kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>K</kbd>）里，最多 12 条：

| 字段 | 说明 |
| --- | --- |
| `id` | 小写字母、数字和连字符，最长 32 个字符 |
| `title` / `subtitle` | 最多 24 / 48 个字符 |
| `icon` | 工作台图标名，默认 `puzzle` |
| `action` | 省略时，命令以 [`command` 事件](#事件) 发给插件的所有界面（界面还没加载时会先打开它）；写 `"open-panel"` 则直接打开面板 |

工作台还会自动为面板生成「打开「…」」命令，为悬浮窗生成「显示 / 隐藏「…」」命令。

### 侧边栏入口与输入框选择器

从工作台 v1.6.0 起，插件还可以在两个固定位置放一个小控件。它们不是独立的界面，没有自己的 iframe，由宿主绘制、由插件更新内容：

| 位置 | 声明 | 显示在哪里 | 选项 |
| --- | --- | --- | --- |
| `sidebar` | `"sidebar": { "title": "账号空间", "subtitle": "…", "icon": "layers" }` | 左侧边栏底部的一行入口，点击打开本插件面板。**需要同时声明 `panel`** | `title` 必填，最多 12 个字符；`subtitle` 最多 32 个字符，默认显示插件名；`icon` 为工作台图标名，默认用插件图标 |
| `composer` | `"composer": { "title": "账号", "icon": "layers" }` | 输入框下方、模型选择旁的一个下拉框。**需要同时声明 `background`**，选项由后台界面提供 | `title` 必填，最多 12 个字符，作为无障碍名称和悬停提示；`icon` 同上 |

- 侧边栏入口用 `wb.ui.setSidebar({ subtitle, tone })` 更新副标题，例如「2 个已登录 · 5 个账号」。
- 选择器在后台界面调用 `wb.composer.setPicker(…)` 之前保持隐藏。用户改选后，插件收到 [`composer:change`](#事件) 事件，处理完必须用 `wb.composer.reply(requestId, { ok, message })` 回复。回复失败时，选择器退回原值并提示 `message`；15 秒内没有回复，选择器会解除等待状态。
- 当前会话运行中、等待审批或终端占用时，选择器锁定，不能改选。
- 还没有会话（新对话）时，改选只发给插件知会一声，由页面记住。这个值会随第一条消息以 `request.choice` 交给本插件后端的 `beforeRun`，只发一次。没有后端的插件只能用 `sessionId` 不为 `null` 的改选。

<details>
<summary>可用的图标名</summary>
<br>

`activity` `alert` `archive` `arrow-down` `arrow-right` `arrow-up` `arrow-up-right` `at` `ban` `bell` `brain` `branch` `check` `chevron-down` `chevron-right` `clock` `close` `code` `coins` `command` `copy` `cpu` `disk` `download` `edit` `external` `eye` `eye-off` `file` `file-plus` `files` `folder` `folder-plus` `globe` `grip` `info` `layers` `list-check` `lock` `logout` `memory` `menu` `message` `message-plus` `palette` `panel` `paperclip` `plug` `plus` `puzzle` `refresh` `reply` `restore` `save` `search` `server` `shield` `sparkles` `square` `store` `terminal` `tool` `upload` `wifi-off`

</details>

## 权限

普通界面插件不能直接读取对话正文、工作区文件、终端输出或凭据，也不能执行命令，内容安全策略不允许它连接外部地址（仍然存在的少数侧信道见 [安全模型](#安全模型)）。服务端扩展是单独的可信代码边界；每一项能力都要在 `permissions` 里申请、由你在启用时确认：

| 权限 | 名称 | 允许 | 风险 |
| --- | --- | --- | :---: |
| `activity` | 运行动态 | 接收 `activity` 事件：会话开始思考、调用工具、等待确认、完成或出错的时刻（只有类型和工具名，不含任何内容） | 低 |
| `sessions.read` | 会话概览 | `sessions.*` 方法与 `session`、`session:active`、`metrics` 事件：会话标题（默认取第一条消息的前 32 个字）、状态、模型与 Token / 费用统计，读不到对话记录 | 中 |
| `usage.read` | 官方额度 | `usage.get()` 与 `usage` 事件：5 小时与每周额度的使用比例和重置时间 | 低 |
| `system.read` | 服务器指标 | `system.get()` 与 `system` 事件：CPU、内存、磁盘、负载与运行时长 | 低 |
| `storage` | 插件存储 | `storage.*`：在服务器上保存最多 256 KB 的插件自有数据 | 低 |
| `ui.toast` | 提示消息 | `ui.toast()`：在页面角落显示简短提示 | 低 |
| `ui.statusbar` | 状态栏 | `ui.setStatus()`：在底部状态栏显示一小段文字 | 低 |
| `composer.insert` | 插入输入框 | `composer.insert()`：向消息输入框插入文本，**由你检查后手动发送** | 中 |
| `backend` | 服务端扩展 | `backend.call()`：调用本插件随源码安装的可信 Node.js 后端；后端可使用服务账号权限，只允许管理员安装 | 高 |

<p align="center">
  <img src="assets/screenshots/consent.webp" alt="安装前的权限确认" width="78%">
</p>

- 权限是**全有或全无**的：启用插件即授予它申请的全部权限。不需要的权限请不要申请，审核时这是第一项检查。
- 插件更新后如果**申请了新权限**，它会暂停运行，直到你再次确认。
- 不需要权限的能力：`workbench.info`、`theme.get`、`ui.openPanel`、`ui.resize`、`ui.hide`、`ui.setSidebar`、`composer.setPicker`、`composer.reply`，以及 `theme`、`visibility`、`command`、`statusbar:click`、`composer:change` 事件。侧边栏入口和选择器只能由声明了它们的插件更新，用户在插件管理里就能看到。

## SDK 参考

每个插件页面都会在插件脚本之前加载 SDK，它提供一个冻结的全局对象 `window.workbench`。

### 生命周期

```js
const wb = window.workbench;
wb.ready().then(info => {
  // info.plugin     { id, name, version, icon, accent }
  // info.surface    'panel' | 'widget' | 'overlay' | 'background'
  // info.permissions 已授予的权限
  // info.theme      { id, name, scheme, tokens }
  // info.visible    当前是否可见
  // info.workbench  { version, sdk }
});
```

在 `ready()` 之前发出的调用会排队，连接建立后自动发送。`wb.info` 在就绪前是 `null`。`wb.can('storage')` 可以判断某个权限是否已授予。

### 调用与错误

所有方法都返回 Promise。失败时抛出的 `Error` 带有 `code`：

| code | 含义 |
| --- | --- |
| `permission` | 没有申请对应权限 |
| `invalid` | 参数不正确 |
| `rate` | 调用过于频繁 |
| `quota` | 插件存储超过 256 KB |
| `not_found` | 会话不存在或已归档 |
| `unavailable` | 插件已被停用 |
| `unknown` | 没有这个方法 |
| `failed` | 其他错误 |
| `backend` | 可信后端调用失败，包括未就绪、共享执行锁忙或插件参数不满足要求 |

```js
try { await wb.ui.toast('备份完成'); }
catch (error) { if (error.code === 'rate') console.debug('稍后再提示'); }
```

### 方法

| 方法 | 权限 | 说明 |
| --- | --- | --- |
| `wb.ui.toast(text)` | `ui.toast` | 显示提示，最多 200 个字符，自动加上「插件名」前缀。每 2 秒最多 1 条 |
| `wb.ui.setStatus({ text, tone, title })` | `ui.statusbar` | 在状态栏显示文字：`text` 最多 48 个字符；`tone` 为 `ok` `warn` `bad`；`title` 是悬停提示，最多 120 个字符。工作台会自动加上插件图标。传 `null` 清除 |
| `wb.ui.openPanel()` | — | 打开本插件的面板（需要声明 `panel`），每 2 秒最多 1 次 |
| `wb.ui.setSidebar({ subtitle, tone })` | — | 需要声明 `sidebar`：更新侧边栏入口的副标题（最多 32 个字符）；`tone` 为 `ok` `warn` `bad` 或空。传 `null` 恢复 manifest 中的默认值 |
| `wb.composer.setPicker({ options, value, values, title, disabled })` | — | 需要声明 `composer`：设置输入框选择器。`options` 为 1–16 个 `{ value, label, detail?, disabled? }`，`value` 由字母、数字和 `_ . : -` 组成，最长 64 个字符，`label` 最多 24 个字符，`detail` 是悬停说明；`value` 是没有单独记录的会话和新对话的默认值；`values` 是 `{ 会话 id: value 或 { value, label } }`，最多 1000 项，`label` 只替换这个会话显示的文字；`disabled` 为 `true` 时整体锁定。传 `null` 隐藏 |
| `wb.composer.reply(requestId, { ok, message })` | — | 回复一次 `composer:change`。`ok: false` 时退回原值并提示 `message`（最多 160 个字符）。返回是否找到了这次请求 |
| `wb.ui.resize({ height })` | — | 调整小组件高度（80–640）；悬浮窗用 `{ width, height }`（48–420）。返回实际尺寸 |
| `wb.ui.hide()` | — | 仅悬浮窗：隐藏自己。用户可以在命令面板里重新显示 |
| `wb.storage.get(key)` | `storage` | 读取，不存在时返回 `null` |
| `wb.storage.set(key, value)` | `storage` | 写入任意可以转成 JSON 的值 |
| `wb.storage.remove(key)` | `storage` | 删除，返回是否存在过 |
| `wb.storage.keys()` | `storage` | 所有键名 |
| `wb.usage.get()` | `usage.read` | 官方额度，见下 |
| `wb.system.get()` | `system.read` | 服务器指标，见下；还没有采样时为 `null` |
| `wb.sessions.list()` | `sessions.read` | 所有会话的摘要与统计 |
| `wb.sessions.get(id)` | `sessions.read` | 单个会话，不存在时为 `null` |
| `wb.sessions.active()` | `sessions.read` | 当前打开的会话，没有时为 `null` |
| `wb.sessions.open(id)` | `sessions.read` | 切换到某个会话，每秒最多 1 次 |
| `wb.composer.insert(text)` | `composer.insert` | 向输入框插入 1–30000 个字符，每秒最多 1 次。工作台会提示用户检查后再发送 |
| `wb.backend.call(method, params)` | `backend` | 调用当前插件自己的可信后端；宿主固定插件 ID，不能借此调用其他插件或任意命令 |
| `wb.theme.get()` | — | 当前皮肤 `{ id, name, scheme, tokens }` |
| `wb.theme.token(name)` | — | 读取一个皮肤变量，例如 `wb.theme.token('brand')` |
| `wb.call(method, params)` | — | 底层调用，上面的方法都基于它 |

每个界面每秒最多 50 次调用，单次参数最大 64 KB。

可信后端的界面通过相同消息通道调用，例如账号插件中的 `await wb.backend.call('list')`。宿主转发到 `POST /api/plugins/:id/backend`，按当前 iframe 固定 `id`，继续检查登录、Origin、CSRF、启用状态、授权与内置来源。方法名和参数由各插件自己的后端校验；这不是通用文件或 Shell 接口。

### 数据结构

**额度** `usage.get()`：

```js
{
  fiveHour: { utilization: 23, resetsAt: '2026-10-20T10:40:00.000Z' },  // 已用百分比
  sevenDay: { utilization: 38, resetsAt: '2026-10-24T21:52:00.000Z' },
  rateLimited: false,         // 是否正处于限流
  cooldownUntil: null,        // 限流解除时间
  updatedAt: '2026-10-20T07:37:12.000Z',
  stale: false,               // 数据是否过期
  unavailableReason: null     // 无法获取时的原因
}
```

**服务器指标** `system.get()`，每 15 秒采样一次：

```js
{
  cpuPercent: 12.4,
  memory: { totalBytes, availableBytes, usedBytes, percent },
  swap: { totalBytes, usedBytes },
  disk: { totalBytes, usedBytes, availableBytes, percent },   // 工作区所在分区
  load: [0.34, 0.52, 0.45],                                   // 1 / 5 / 15 分钟
  uptimeSeconds: 266400,
  activeRuns: 0,
  sampledAt: '2026-10-20T07:37:15.000Z'
}
```

**会话** `sessions.list()` 的每一项（`get()`、`active()` 相同）：

```js
{
  id: 'a0e533aa-…', title: '服务器体检', model: 'sonnet',        // 会话选择的模型
  status: 'idle',                  // running / awaiting_approval / stopping / error
  archived: false, createdAt: '…', updatedAt: '…',
  metrics: {
    turns, toolCalls, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    costUsd,          // API 等价估算，不是账单
    durationMs, apiDurationMs, contextTokens, contextWindow
  }
}
```

统计数据会缓存 5 秒。没有的指标为 `null`。

### 工具函数

```js
const { h, svg, format } = workbench;

// 不用 innerHTML 构建界面：class、style（对象）、dataset、text、onXxx 事件，其余作为属性
const button = h('button', { class: 'wb-btn primary', type: 'button', onClick: () => alert('hi') }, '点我');
const ring = svg('svg', { viewBox: '0 0 40 40', class: 'wb-chart' }, svg('circle', { cx: 20, cy: 20, r: 16 }));

format.number(1234567)      // '1,234,567'
format.compact(722000)      // '722k'
format.percent(23.4, 1)     // '23.4%'
format.money(4.738)         // '$4.74'
format.bytes(6.3 * 2 ** 30) // '6.3 GB'
format.duration(5400000)    // '1 小时 30 分'
format.time(Date.now())     // '15:37'（北京时间，可传第二个参数指定时区）
format.relative(Date.now() - 3 * 60000)  // '3 分钟前'
```

> [!IMPORTANT]
> 插件拿到的会话标题、工具名等文本**来自用户和模型**。显示时请使用 `h()`、`textContent`，不要拼进 `innerHTML`。

### 存储

- 每个插件一个 JSON 对象，总大小不超过 256 KB；键名只能使用字母、数字和 `_ . : -`，最长 64 个字符。
- 写入先进入页面里的缓存，约 400 ms 后保存到服务器；关闭页面时会立即保存还没写出的数据（超过 60 KB 时可能来不及，重要的数据请尽早写入）。同一插件的各个界面共享这份缓存，其他界面会收到 `storage:change` 事件（写入的界面自己不会收到）。
- 多个浏览器标签页同时修改时，以最后保存的为准。
- 数据保存在服务器的 `<WORKBENCH_DATA>/plugin-data/<id>.json`，文件权限 `0600`，**明文存储**，不要保存密码、令牌等机密。
- 卸载插件会同时删除它的数据。

## 事件

```js
const off = workbench.on('usage', usage => render(usage));
// 不再需要时：off() 或 workbench.off('usage', handler)
```

| 事件 | 需要权限 | `data` |
| --- | --- | --- |
| `theme` | — | 新的皮肤 `{ id, name, scheme, tokens }`。SDK 已经自动更新了 `--wb-*` 变量 |
| `visibility` | — | `{ visible }`：浏览器标签页切走、切到别的面板、离开监控页或悬浮窗被隐藏时为 `false`；`background` 界面始终为 `false`。看不见时请暂停动画 |
| `command` | — | `{ id }`：用户在命令面板里执行了本插件的命令 |
| `statusbar:click` | — | `{}`：用户点击了本插件的状态栏文字 |
| `composer:change` | — | `{ sessionId, value, requestId }`：用户改选了本插件的输入框选择器；`sessionId` 为 `null` 表示还没有会话的新对话。发给本插件所有已加载的界面，必须用 `composer.reply()` 回复 |
| `runtime` | `backend` | `{}`：本插件或其他可信后端改变了自己的状态（例如在面板里新增账号、改了绑定），请重新读取 |
| `storage:change` | `storage` | `{ key, value }`：本插件的其他界面修改了数据，删除时 `value` 为 `null` |
| `activity` | `activity` | `{ kind, sessionId, current, tool?, at }`，`kind` 为 `start` `tool` `approval` `stop` `done` `error`；`current` 表示是否是当前打开的会话 |
| `session` | `sessions.read` | 会话摘要（不含 `metrics`）：新建、改名、状态变化时触发 |
| `session:active` | `sessions.read` | 当前会话，同 `sessions.active()` |
| `metrics` | `sessions.read` | `{ sessionId, metrics }`：当前会话的统计更新，800 ms 防抖 |
| `usage` | `usage.read` | 同 `usage.get()` |
| `system` | `system.read` | 同 `system.get()`，每 15 秒一次 |

## 样式

SDK 自动加载一份基础样式，所有颜色都来自皮肤变量，所以**插件天然适配所有皮肤**，深色、浅色都不用额外处理。

<p align="center">
  <img src="assets/screenshots/widgets.webp" alt="运行监控页里的插件小组件" width="100%">
</p>

**页面属性**：`<html>` 上有 `data-surface`（当前界面）、`data-scheme`（`light` / `dark`）和 `data-theme`（皮肤 id），可以用来写针对性的样式。面板默认有 28px 内边距，小组件和悬浮窗没有。

**组件类**：

| 类名 | 用途 |
| --- | --- |
| `wb-card`（`.flat`） | 卡片 |
| `wb-btn`（`.primary` `.ghost` `.small`） | 按钮 |
| `wb-segment` | 分段切换，子按钮用 `aria-pressed="true"` 表示选中 |
| `wb-tag`（`.warn` `.bad` `.info` `.muted`） | 标签 |
| `wb-kpi` | 指标块：`<span>` 标题、`<strong>` 数值、`<small>` 说明 |
| `wb-progress`（`.warn` `.bad`） | 进度条，内部放一个设置了宽度的 `<span>` |
| `wb-list` / `wb-item` | 列表与可点击的列表项 |
| `wb-row` `wb-between` `wb-stack` `wb-grid` | 横排、两端对齐、竖排、自适应网格（`--wb-col` 控制最小列宽） |
| `wb-eyebrow` `wb-muted` `wb-faint` `wb-num` `wb-mono` `wb-ellipsis` | 小标题、次要文字、更淡的文字、等宽数字、等宽字体、单行省略 |
| `wb-chart`（`.grid` `.axis`） | SVG 图表的网格线与坐标轴文字 |
| `wb-legend` `wb-dot` `wb-empty` `wb-skeleton` `wb-fade-in` | 图例、状态点、空状态、加载骨架、淡入动画 |

**皮肤变量**：插件页面里可以使用下面这些 `--wb-*` 变量，切换皮肤时自动更新：

| 分组 | 变量 |
| --- | --- |
| 背景与线条 | `bg` `bg-2` `surface` `surface-2` `sunken` `line` `line-2` `track` `grid` `shadow` |
| 文字 | `ink` `ink-2` `ink-3` `ink-4` `ink-5`（由深到浅） |
| 品牌色 | `brand` `brand-2` `brand-3` `brand-4` `brand-soft` `brand-tint` `brand-line` `on-brand` `focus` `selection` |
| 状态色 | `ok` `amber` `amber-2` `amber-soft` `red` `red-soft` `blue` `blue-soft` |
| 图表 | `chart-1` `chart-2` `chart-3` `chart-4` `grad-ok` `grad-warn` `grad-danger` |
| 侧栏与代码 | `side` `side-ink` `side-accent` `code-bg` `code-ink` `code-accent` |
| 阴影 | `sh-1` `sh-2` |

例如 `color: var(--wb-ink-3); background: var(--wb-brand-soft);`。另有 `--wb-font`、`--wb-mono`、`--wb-radius`、`--wb-radius-sm`、`--wb-ease`。

> [!TIP]
> 想看看实际效果，可以读一读内置插件的源码：[`plugins/usage-stats`](../plugins/usage-stats)（面板 + 小组件 + 状态栏）、[`plugins/ops-pulse`](../plugins/ops-pulse)（小组件 + 图表）、[`plugins/xiaoyun-pet`](../plugins/xiaoyun-pet)（悬浮窗宠物）和 [`workshop/src/focus-timer`](../workshop/src/focus-timer)（后台计时 + 命令）。

## 制作皮肤

<p align="center">
  <img src="assets/screenshots/skins.webp" alt="皮肤画廊" width="100%">
</p>

```bash
npm run plugin:new -- my-skin --theme
```

脚手架会把默认皮肤「云杉」的全部颜色复制进 `manifest.json`，改颜色就行：

```json
{
  "id": "my-skin",
  "type": "theme",
  "name": "我的皮肤",
  "version": "0.1.0",
  "description": "深色 · 一句话介绍它的气质。",
  "engines": { "workbench": ">=1.1.0" },
  "icon": "🌙",
  "accent": "#e39b45",
  "tags": ["深色"],
  "theme": {
    "scheme": "dark",
    "tokens": { "bg": "#14100b", "surface": "#1c1711", "ink": "#f3e9da", "brand": "#e8a24e", "…": "…" },
    "terminal": { "background": "#0b0906", "foreground": "#ecdcc2", "…": "…" },
    "editor": { "background": "#0e0b07", "keyword": "#f2bc6c", "…": "…" }
  }
}
```

- **`scheme`**：`light` 或 `dark`，决定浏览器原生控件（滚动条、表单）的配色。
- **`tokens`**：至少 8 个，建议写全下面 57 个**核心变量**。没写的核心变量会回落到浅色的「云杉」，所以**深色皮肤务必写全**。`focus`、`chart-1`、`sh-1` 等**派生变量**会根据核心变量自动计算，一般不用写，也可以覆盖。
- **`terminal`**（可选）：网页终端的 xterm 配色，键名为 `background` `foreground` `cursor` `cursorAccent` `selectionBackground` 和 16 个 ANSI 颜色（`black` … `brightWhite`）。
- **`editor`**（可选）：Monaco 编辑器配色，键名为 `background` `foreground` `lineHighlight` `lineNumber` `lineNumberActive` `selection` `inactiveSelection` `cursor` `indentGuide` `comment` `keyword` `string` `number` `type` `diffAdd` `diffAddBg` `diffDel` `diffHunk` `diffMeta`。
- `terminal` 和 `editor` 的值只能是 `#rrggbb` 或 `#rrggbbaa`；省略时根据 `tokens` 自动生成。

| 核心变量 | 作用 |
| --- | --- |
| `bg` `bg-2` `surface` `surface-2` `sunken` | 页面背景、卡片、凹陷区域 |
| `line` `line-2` | 分隔线与边框 |
| `ink` `ink-2` `ink-3` `ink-4` `ink-5` | 文字，由深到浅 |
| `brand` `brand-2` `brand-3` `brand-4` `brand-soft` `brand-tint` `brand-line` `on-brand` | 品牌色：按钮、链接、选中态；`on-brand` 是品牌色按钮上的文字 |
| `amber` `amber-2` `amber-soft` `amber-line` | 提醒、等待确认 |
| `red` `red-soft` `red-line` | 错误、危险操作 |
| `blue` `blue-soft` `ok` | 信息、成功 |
| `side-0` `side` `side-2` `side-3` `side-line` | 左侧栏背景 |
| `side-ink` `side-ink-2` `side-ink-3` `side-accent` `side-ok` `side-warn` `side-bad` | 左侧栏文字与状态 |
| `code-bg` `code-ink` `code-line` `code-accent` `code-muted` | 代码块与命令卡片 |
| `term-bg` `term-bar` `term-ink` `term-ink-2` `term-ink-3` `term-accent` `term-bad` `term-warn` | 执行轨迹与终端外框 |
| `shadow` `modified` | 阴影基色、文件「已修改」标记 |

**值的规则**：只能是颜色和渐变，例如 `#2f6a52`、`rgb(…)`、`oklch(…)`、`color-mix(…)`、`linear-gradient(…)`，以及引用其他工作台变量的 `var(--brand)` 和 `calc()` / `min()` / `max()` / `clamp()`。不能使用 `url()`、字符串或其他函数，单个值最多 240 个字符。所以皮肤**只能改颜色**，无法加载任何资源。

**可读性**：建议正文 `ink` 与 `bg` / `surface` 的对比度至少 7:1，`brand` 作为文字和按钮底色时至少 4.5:1，`ink-4` 等次要文字至少 3:1。内置皮肤都按这个标准调过，「高对比」皮肤更高。

**其他**：皮肤 id 不能与内置皮肤重名，也不能是 `auto`。皮肤只保存在**当前浏览器**里，换设备需要重新选择；终端、编辑器和所有插件会跟着一起换色。

## 打包、分享与导入

```bash
npm run plugin:pack -- my-plugin               # 先找当前目录，再找插件目录
npm run plugin:pack -- ./path/to/folder        # 任意包含 manifest.json 的目录
npm run plugin:pack -- my-plugin --out dist/   # 指定输出目录
```

生成的 `<id>-<version>.json` 就是完整的插件包，同时会打印它的 sha256。打包是确定性的：同样的文件总是得到同样的字节和 sha256。

在工作台的 **创意工坊 → 开发 → 导入插件包…** 里选择这个文件即可安装，启用时同样要确认权限。

此流程只用于普通界面插件与皮肤。带 `backend` 的可信服务端插件不能打包成可网页导入的插件包，必须由管理员审核源码并放入工作台的 `plugins/<id>/` 目录，按独立版本和兼容要求部署后重启服务。

| 限制 | 上限 |
| --- | --- |
| 单个插件的文件数 | 64 个 |
| 解压后的总大小 | 2 MB |
| 插件包大小 | 3 MB |
| 插件存储 | 256 KB |
| 已安装的插件与皮肤 | 64 个 |

<details>
<summary>插件包格式</summary>
<br>

```json
{
  "format": "cloud-ops-workbench-plugin",
  "formatVersion": 1,
  "manifest": { "id": "my-plugin", "…": "…" },
  "files": [
    { "path": "main.js", "encoding": "utf8", "data": "…" },
    { "path": "img/logo.png", "encoding": "base64", "data": "…" }
  ]
}
```

`files` 不能包含 `manifest.json`，`main` 和 `style` 指向的文件必须存在。皮肤包的 `files` 为空。

</details>

## 上架创意工坊

创意工坊的目录就是本仓库的 [`workshop/`](../workshop) 文件夹。工作台默认从 GitHub 读取它（每台工作台缓存 10 分钟），所以 PR 合并后，所有人都能在「创意工坊 → 发现」里看到你的作品。

1. Fork 本仓库，把插件文件夹放到 `workshop/src/<id>/`（目录名等于 `id`），并在 `manifest.json` 里写明 `engines.workbench`。
2. 运行 `npm run workshop:build`，它会把作品打包到 `workshop/packages/<id>-<version>.json`，并更新 `workshop/registry.json`（名称、版本、权限、sha256 与大小）。
3. 运行 `npm test` 和 `npm run workshop:build -- --check`，确认目录是最新的（CI 也会检查）。
4. 提交 PR，写清楚它做什么、申请每个权限的理由，最好附一张截图。

**审核时会看什么**

- 权限是否最少够用。申请 `sessions.read` 或 `composer.insert` 需要说明理由。
- 源码是否可读。不接受混淆或压缩过的代码。
- 是否尊重用户：不伪造工作台界面、不诱导输入口令、不在输入框里塞入误导性的指令。
- 文字和图片是否合规，许可证是否明确（推荐 MIT）。

**更新**：修改代码后**提升 `version`** 再运行 `npm run workshop:build`，旧版本的包会被自动删除。用户会在「发现」里看到「更新到 vX.Y.Z」按钮；新版本申请了新权限时，需要用户重新确认。

**「官方」标记**：[`workshop/official.json`](../workshop/official.json) 列出由本项目维护的作品，只有维护者可以修改。其余作品显示作者名。收录进创意工坊表示通过了上面的审核，不代表本项目为其安全性背书。

**自建目录**：把同样结构的 `registry.json` 和 `packages/` 放到任意 HTTPS 地址，然后设置 `WORKBENCH_WORKSHOP_URL=https://你的地址/`。自定义目录里的作品永远不会显示「官方」标记。设为 `off` 可以关闭创意工坊，导入插件包仍然可用。

## 安全模型

**隔离**

- 每个插件界面都是一个 `sandbox="allow-scripts"` 的 iframe，运行在**不透明源**（opaque origin）里：拿不到工作台的 Cookie、DOM 和 `localStorage`，也无法冒充工作台发请求。
- 插件页面有独立的 CSP：脚本只能来自 SDK 和插件自己的文件，`connect-src` 只允许插件自己的文件，不能加载外部资源、提交表单、嵌套页面或启动 Worker。
- 插件文件通过带 HMAC 签名的地址提供，直接在浏览器里打开时同样处于沙箱中。
- 插件只能通过工作台交给它的私有 `MessageChannel` 通信。每次调用都会核对权限，有频率限制，插件提供的文字会去掉控制字符。
- 普通插件代码不在服务器执行。只有管理员随源码安装、显式启用并授予 `backend` 权限的模块会被服务端宿主导入；这些模块与工作台同进程，拥有服务账号权限，**不受 iframe 沙箱限制**。

**安装**

- 创意工坊只允许 HTTPS 地址，不跟随重定向；安装包必须与目录记录的 sha256、id、版本、类型和权限完全一致。
- 安装前展示全部权限，由你确认；更新申请新权限时会再次确认。

**仍然存在的风险**，请如实了解：

1. **界面欺骗**：插件可以在自己的面板里画任何东西，包括仿冒工作台的界面。工作台**永远不会**在插件面板里要求你输入口令。
2. **侧信道**：CSP 管不到 WebRTC 等少数通道，工作台已经关闭了 DNS 预取，但一个恶意插件仍有可能把它**有权看到的数据**（例如 `sessions.read` 下的会话标题）带出去。请只安装你信任的作者的插件，对「中」风险的权限多留个心。
3. **提示词注入**：拥有 `composer.insert` 的插件可以往输入框里放入误导性的文字。工作台每次都会提示，**发送前请务必读一遍**。
4. **明文存储**：插件数据以明文 JSON 保存在服务器上。
5. **皮肤**只能改颜色，但一款配色糟糕的皮肤可能让页面难以阅读。
6. **可信后端**等同于管理员安装的 Node.js 服务代码。前端权限通道限制的是界面能调用哪些方法，不能把一个恶意后端隔离在服务账号之外；源码审阅、文件权限与独立版本维护仍是管理员责任。

**安全模式有两个范围**：`?safe`（例如 `https://ops.example.com/?safe`）只让当前页面不加载插件界面，并固定默认皮肤；已启用的后端、账号路由和恢复队列继续运行。设置 `WORKBENCH_SAFE_MODE=1` 并重启服务，才会阻止所有插件页面、后端方法与服务端模块加载。两种方式都不删除数据；服务端安全模式仍保留独立配置会话的归属门禁。

## 版本与兼容

- `engines.workbench` 写明插件需要的最低工作台版本。工作台版本更低时，插件会标出「需要工作台 vX.Y.Z」且不会运行，创意工坊也不会提供安装。
- SDK 的协议版本是 `1`（`workbench.version` 与 `info.workbench.sdk`）。之后新增的方法和事件不会改变已有行为；如果有不兼容的变化，会提升协议版本并在发布说明里写清楚。
- 插件按 `x.y.z` 逐段比较版本。创意工坊里有更高版本时，用户会看到「更新到 vX.Y.Z」。
- 底座版本与插件版本分开维护。当前可信后端接口要求底座 `>=1.2.0`；服务端插件更新只改该插件目录及对应测试、提升插件版本，在兼容的底座上重启加载。涉及通用生命周期或 SDK 契约的变化应更新底座版本。对生产环境先备份相应私有数据并确认旧版本的数据兼容性。

## 常见问题

<details>
<summary><b>插件能联网、读文件或执行命令吗？</b></summary>
<br>

普通界面插件不能。需要提供建议指令时，可以用 `composer.insert` 放进输入框，由用户检查、发送，再按该会话选择的权限模式执行。「运维脉搏」使用这种方式。管理员随源码安装的可信后端则可以使用服务账号能力，必须单独申请 `backend` 高风险权限，不能从创意工坊或网页导入。

</details>

<details>
<summary><b>插件没有出现，怎么排查？</b></summary>
<br>

- 点「重新扫描插件目录」后，「已安装」页顶部会列出没有加载的目录和原因，常见的是 `manifest.json` 字段不合法，或目录名和 `id` 不一致。
- 「已安装」里确认插件已启用、权限已确认，并且没有显示「需要工作台 vX.Y.Z」。
- 地址里带着 `?safe` 时，当前页面的插件界面不会加载；服务端安全模式 `WORKBENCH_SAFE_MODE=1` 才会同时停用后端。

</details>

<details>
<summary><b>怎么调试？</b></summary>
<br>

打开浏览器开发者工具，在 Console 的上下文下拉框里选择插件的 iframe（标题是「插件名 · 界面」），就能看到插件的日志、执行代码。调用返回的错误都带有 `code`，见 [调用与错误](#调用与错误)。

</details>

<details>
<summary><b>多个界面之间怎么共享状态？</b></summary>
<br>

用 `storage`：一个界面写入，其他界面会收到 `storage:change` 事件。需要一直运行的逻辑（例如计时器）放在 `background` 界面里，面板和小组件只负责显示。「番茄专注」就是这样做的。

</details>

<details>
<summary><b>手机上能用吗？</b></summary>
<br>

能。面板、小组件和悬浮窗在手机上都可以使用，悬浮窗会自动保持在屏幕范围内。记得让你的布局在 360px 宽度下也能正常显示。

</details>

<details>
<summary><b>可以在插件里使用 React / Vue 吗？</b></summary>
<br>

可以，但需要把库和你的代码一起打包成插件目录里的文件（不能从 CDN 加载），并注意 2 MB 的大小上限。对于大多数小工具，SDK 自带的 `h()` 和基础样式已经足够。

</details>
