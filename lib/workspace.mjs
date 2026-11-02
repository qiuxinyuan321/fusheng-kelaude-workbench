import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

export const TEXT_LIMIT = 2 * 1024 * 1024;
export const UPLOAD_LIMIT = 8 * 1024 * 1024;
const LIST_LIMIT = 1000, SEARCH_FILES = 4000, SEARCH_BYTES = 32 * 1024 * 1024;
const SEARCH_MATCHES = 200, GIT_LIMIT = 2 * 1024 * 1024;
const locks = new Map();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const utf8 = new TextDecoder('utf-8', { fatal: true });

function fail(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function translated(error) {
  if (error.status) return error;
  if (error.code === 'ENOENT') return fail(404, 'NOT_FOUND', '文件或目录不存在。');
  if (['ELOOP', 'EACCES', 'EPERM'].includes(error.code)) return fail(403, 'ACCESS_DENIED', '不允许访问此路径。');
  if (['EEXIST', 'ENOTEMPTY'].includes(error.code)) return fail(409, 'ALREADY_EXISTS', '目标已经存在。');
  if (['ENOTDIR', 'EISDIR', 'ENAMETOOLONG'].includes(error.code)) return fail(400, 'INVALID_PATH', '路径类型或长度不正确。');
  return fail(500, 'FILESYSTEM_ERROR', '工作区文件操作未完成。');
}
function secretSegment(name) {
  const s = name.toLowerCase();
  if (/^\.env(?:[._-][a-z0-9_-]+)*\.(?:example|sample|template)$/.test(s)) return false;
  return ['.claude', '.codex', '.ssh', '.aws', '.azure', '.gnupg', '.docker', '.kube',
    '.npmrc', '.yarnrc', '.netrc', '.pypirc', '.envrc', '.git-credentials', 'auth.json', 'access.json'].includes(s)
    || s === '.env' || s.startsWith('.env.') || s.startsWith('.env_') || s.startsWith('.env-')
    || /(?:^|[._-])(?:credentials?|secrets?|passwords?|tokens?)(?:[._-]|$)/.test(s)
    || /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(s)
    || /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/.test(s);
}
function hiddenSegment(name) {
  const s = name.toLowerCase();
  return s === '.git' || s === 'node_modules' || /^\.workbench-[a-f0-9-]+\.tmp$/.test(s);
}
function relativePath(value, allowRoot = false) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f\\]/.test(value)
    || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value)) throw fail(400, 'INVALID_PATH', '只能使用工作区内的相对路径。');
  if (value === '' && allowRoot) return '';
  const parts = value.split('/');
  if (!value || parts.some(p => !p || p === '.' || p === '..' || Buffer.byteLength(p) > 255))
    throw fail(400, 'INVALID_PATH', '路径不能包含空段、点段或上级目录。');
  if (parts.some(secretSegment)) throw fail(403, 'SECRET_PATH', '此路径可能包含登录信息或秘密，不能通过网页访问。');
  if (parts.some(hiddenSegment)) throw fail(403, 'HIDDEN_PATH', '此目录不通过网页文件接口开放。');
  return parts.join('/');
}
function textOf(bytes) {
  if (bytes.includes(0)) throw fail(415, 'BINARY_FILE', '二进制文件不能作为文本读取或编辑。');
  let text;
  try { text = utf8.decode(bytes); } catch { throw fail(415, 'BINARY_FILE', '只支持有效 UTF-8 文本。'); }
  // Permit tabs, line breaks, and form feeds, but not binary control bytes.
  if (/[\x01-\x08\x0b\x0e-\x1f\x7f]/.test(text)) throw fail(415, 'BINARY_FILE', '二进制文件不能作为文本读取或编辑。');
  return text;
}
async function locked(key, action) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const next = previous.catch(() => {}).then(() => waiting);
  locks.set(key, next);
  await previous.catch(() => {});
  try { return await action(); }
  finally { release(); if (locks.get(key) === next) locks.delete(key); }
}

/** A single server-selected session directory. Never construct the root from a web request.
 * All paths are relative; links, credential-shaped paths, and Git internals are excluded.
 * Existing file updates require an exact SHA-256. Use expectedHash=null to create a file.
 */
export class Workspace {
  constructor(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw fail(400, 'INVALID_ROOT', '工作区根目录必须是服务器提供的绝对路径。');
    this.root = path.resolve(root);
    this.initializing = null;
  }
  async _root() {
    if (!this.initializing) this.initializing = (async () => {
      const stat = await fs.lstat(this.root);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail(403, 'UNSAFE_ROOT', '工作区根目录不是普通目录。');
      return { real: await fs.realpath(this.root), stat };
    })();
    const initial = await this.initializing;
    const stat = await fs.lstat(this.root);
    if (stat.isSymbolicLink() || !sameFile(stat, initial.stat) || await fs.realpath(this.root) !== initial.real)
      throw fail(409, 'ROOT_CHANGED', '工作区目录已被替换，请重新打开会话。');
    return initial.real;
  }
  async _resolve(relative, { root = false, missing = false } = {}) {
    const rel = relativePath(relative, root), base = await this._root();
    let full = base, stat = await fs.lstat(base);
    const parts = rel ? rel.split('/') : [];
    for (let i = 0; i < parts.length; i++) {
      full = path.join(full, parts[i]);
      try { stat = await fs.lstat(full); }
      catch (error) {
        if (missing && error.code === 'ENOENT') return { rel, full: path.join(base, ...parts), stat: null };
        throw error;
      }
      if (stat.isSymbolicLink()) throw fail(403, 'SYMLINK_PATH', '网页文件接口不允许符号链接。');
      if (i < parts.length - 1 && !stat.isDirectory()) throw fail(400, 'INVALID_PATH', '上级路径不是目录。');
      const real = await fs.realpath(full);
      if (real !== base && !real.startsWith(base + path.sep)) throw fail(403, 'OUTSIDE_WORKSPACE', '路径超出了当前工作区。');
    }
    return { rel, full, stat };
  }
  async _directory(relative = '') {
    const item = await this._resolve(relative, { root: true });
    if (!item.stat.isDirectory()) throw fail(400, 'NOT_DIRECTORY', '目标不是目录。');
    return item;
  }
  async _openDirectory(relative = '') {
    const item = await this._directory(relative);
    const handle = await fs.open(item.full, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat(), check = await this._directory(relative);
      if (!sameFile(stat, item.stat) || !sameFile(stat, check.stat)) throw fail(409, 'PATH_CHANGED', '目录已改变，请重试。');
      // Linux deployment anchors mutations to the already validated directory inode.
      const anchor = process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : item.full;
      return { ...item, handle, anchor, check: async () => {
        const current = await this._directory(relative);
        if (!sameFile(stat, current.stat)) throw fail(409, 'PATH_CHANGED', '目录已改变，请重试。');
      } };
    } catch (error) { await handle.close(); throw error; }
  }
  async _bytes(relative, limit = TEXT_LIMIT) {
    const item = await this._resolve(relative);
    if (!item.stat.isFile()) throw fail(400, 'NOT_FILE', '目标不是普通文件。');
    if (item.stat.nlink !== 1) throw fail(403, 'HARDLINK_FILE', '网页文件接口不允许硬链接文件。');
    if (item.stat.size > limit) throw fail(413, 'FILE_TOO_LARGE', '文件超过当前操作的大小限制。');
    const parent = path.posix.dirname(item.rel);
    const directory = await this._openDirectory(parent === '.' ? '' : parent);
    let handle;
    try {
      handle = await fs.open(path.join(directory.anchor, path.posix.basename(item.rel)), constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await handle.stat(), current = await this._resolve(relative);
      if (!before.isFile() || before.nlink !== 1 || !sameFile(before, item.stat) || !sameFile(before, current.stat))
        throw fail(409, 'PATH_CHANGED', '文件已改变，请重新读取。');
      if (before.size > limit) throw fail(413, 'FILE_TOO_LARGE', '文件超过当前操作的大小限制。');
      const bytes = Buffer.alloc(Math.min(limit + 1, before.size + 1));
      let count = 0;
      while (count < bytes.length) {
        const { bytesRead } = await handle.read(bytes, count, bytes.length - count, count);
        if (!bytesRead) break;
        count += bytesRead;
      }
      const after = await handle.stat(), verified = await this._resolve(relative);
      if (!sameFile(after, verified.stat) || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || after.ctimeMs !== before.ctimeMs || count !== before.size)
        throw fail(409, 'FILE_CHANGED', '文件在读取期间发生了变化，请重试。');
      if (count > limit) throw fail(413, 'FILE_TOO_LARGE', '文件超过当前操作的大小限制。');
      return { ...item, stat: after, bytes: bytes.subarray(0, count) };
    } finally { await handle?.close(); await directory.handle.close(); }
  }
  async list(relative = '') {
    try {
      const dir = await this._directory(relative), entries = [];
      let examined = 0, truncated = false;
      const stream = await fs.opendir(dir.full);
      for await (const entry of stream) {
        if (++examined > 10000) { truncated = true; break; }
        if (secretSegment(entry.name) || hiddenSegment(entry.name) || entry.isSymbolicLink()) continue;
        let item;
        try { item = await this._resolve([dir.rel, entry.name].filter(Boolean).join('/')); }
        catch (error) { if (error.code === 'ENOENT' || error.status === 403 || error.status === 400) continue; throw error; }
        if ((!item.stat.isFile() && !item.stat.isDirectory()) || item.stat.isFile() && item.stat.nlink !== 1) continue;
        entries.push({ name: entry.name, path: item.rel, type: item.stat.isDirectory() ? 'directory' : 'file',
          size: item.stat.isFile() ? item.stat.size : null, modifiedAt: item.stat.mtime.toISOString() });
        if (entries.length === LIST_LIMIT) { truncated = true; break; }
      }
      entries.sort((a, b) => (a.type === b.type ? 0 : a.type === 'directory' ? -1 : 1) || a.name.localeCompare(b.name));
      return { path: dir.rel, entries, truncated };
    } catch (error) { throw translated(error); }
  }
  async read(relative) {
    try {
      const item = await this._bytes(relative);
      return { path: item.rel, text: textOf(item.bytes), hash: sha256(item.bytes), size: item.bytes.length,
        modifiedAt: item.stat.mtime.toISOString() };
    } catch (error) { throw translated(error); }
  }
  async _save(relative, bytes, expectedHash, textOnly) {
    const rel = relativePath(relative);
    if (expectedHash !== null && (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)))
      throw fail(400, 'HASH_REQUIRED', '保存已有文件需要读取时的 SHA-256；创建新文件使用 null。');
    const root = await this._root();
    return locked(path.join(root, rel), async () => {
      const parent = path.posix.dirname(rel), directory = await this._openDirectory(parent === '.' ? '' : parent);
      const name = path.posix.basename(rel), target = path.join(directory.anchor, name);
      const temp = path.join(directory.anchor, `.workbench-${randomUUID()}.tmp`);
      let opened, tempExists = false;
      try {
        let prior = await this._resolve(rel, { missing: true });
        if (prior.stat) {
          if (expectedHash === null) throw fail(409, 'FILE_EXISTS', '文件已存在，请先读取再保存。');
          prior = await this._bytes(rel, textOnly ? TEXT_LIMIT : UPLOAD_LIMIT);
          if (textOnly) textOf(prior.bytes);
          if (sha256(prior.bytes) !== expectedHash) throw fail(409, 'HASH_MISMATCH', '文件已被其他任务修改，请重新读取后合并。');
        } else if (expectedHash !== null) throw fail(409, 'FILE_MISSING', '原文件已被删除，请重新确认。');
        await directory.check();
        opened = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        tempExists = true;
        await directory.check();
        await opened.writeFile(bytes);
        await opened.chmod(prior.stat ? prior.stat.mode & 0o777 : 0o600);
        await opened.sync(); await opened.close(); opened = null;
        await directory.check();
        if (prior.stat) {
          const current = await this._bytes(rel, textOnly ? TEXT_LIMIT : UPLOAD_LIMIT);
          if (!sameFile(current.stat, prior.stat) || sha256(current.bytes) !== expectedHash)
            throw fail(409, 'HASH_MISMATCH', '文件已被其他任务修改，请重新读取后合并。');
          await directory.check();
          await fs.rename(temp, target); tempExists = false;
        } else {
          // link() is an atomic, no-clobber publication; rename() would replace a concurrent creator.
          await fs.link(temp, target);
          await fs.unlink(temp); tempExists = false;
        }
        try { await directory.handle.sync(); } catch { /* Some filesystems do not fsync directories. */ }
        const final = await this._resolve(rel);
        return { path: rel, hash: sha256(bytes), size: bytes.length, modifiedAt: final.stat.mtime.toISOString() };
      } finally {
        await opened?.close().catch(() => {});
        if (tempExists) await fs.unlink(temp).catch(() => {});
        await directory.handle.close();
      }
    });
  }
  async write(relative, text, expectedHash) {
    try {
      if (typeof text !== 'string') throw fail(400, 'INVALID_TEXT', '文件内容必须是文本。');
      const bytes = Buffer.from(text, 'utf8');
      if (bytes.length > TEXT_LIMIT) throw fail(413, 'FILE_TOO_LARGE', '文本编辑上限为 2 MiB。');
      if (utf8.decode(bytes) !== text) throw fail(400, 'INVALID_TEXT', '文本包含无效 Unicode。');
      textOf(bytes);
      return await this._save(relative, bytes, expectedHash, true);
    } catch (error) { throw translated(error); }
  }
  async upload(relative, base64, expectedHash = null) {
    try {
      if (typeof base64 !== 'string' || base64.length > 4 * Math.ceil(UPLOAD_LIMIT / 3))
        throw fail(typeof base64 === 'string' ? 413 : 400, 'INVALID_UPLOAD', '上传内容必须是最多 8 MiB 文件的 Base64。');
      if (base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64))
        throw fail(400, 'INVALID_BASE64', '上传内容不是规范的 Base64。');
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length > UPLOAD_LIMIT) throw fail(413, 'FILE_TOO_LARGE', '上传上限为 8 MiB。');
      if (bytes.toString('base64') !== base64) throw fail(400, 'INVALID_BASE64', '上传内容不是规范的 Base64。');
      const result = await this._save(relative, bytes, expectedHash, false);
      let binary = false; try { textOf(bytes); } catch { binary = true; }
      return { ...result, binary };
    } catch (error) { throw translated(error); }
  }
  async mkdir(relative) {
    try {
      const rel = relativePath(relative), root = await this._root();
      return await locked(path.join(root, rel), async () => {
        const parent = path.posix.dirname(rel), directory = await this._openDirectory(parent === '.' ? '' : parent);
        try {
          await this._resolve(rel, { missing: true }); await directory.check();
          await fs.mkdir(path.join(directory.anchor, path.posix.basename(rel)), { mode: 0o700 });
          await directory.check();
          return { path: rel, type: 'directory' };
        } finally { await directory.handle.close(); }
      });
    } catch (error) { throw translated(error); }
  }
  async search(query) {
    try {
      if (typeof query !== 'string' || !query.trim() || query.length > 200 || /[\x00-\x1f\x7f]/.test(query))
        throw fail(400, 'INVALID_QUERY', '搜索词需为 1–200 个字符的单行文本。');
      const needle = query.toLocaleLowerCase(), matches = [], queue = [''];
      let scannedFiles = 0, scannedBytes = 0, truncated = false, directories = 0;
      outer: while (queue.length) {
        const relative = queue.shift();
        if (++directories > 1000) { truncated = true; break; }
        const page = await this.list(relative); truncated ||= page.truncated;
        for (const entry of page.entries) {
          if (entry.type === 'directory') {
            if (entry.path.split('/').length < 16 && queue.length < 1000) queue.push(entry.path); else truncated = true;
            continue;
          }
          if (++scannedFiles > SEARCH_FILES) { truncated = true; break outer; }
          if (entry.size > TEXT_LIMIT) continue;
          if (scannedBytes + entry.size > SEARCH_BYTES) { truncated = true; break outer; }
          let item;
          try { item = await this.read(entry.path); }
          catch (error) { if ([400, 403, 404, 409, 413, 415].includes(error.status)) continue; throw error; }
          scannedBytes += item.size;
          const lines = item.text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const index = lines[i].toLocaleLowerCase().indexOf(needle);
            if (index === -1) continue;
            const start = Math.max(0, index - 200);
            matches.push({ path: entry.path, line: i + 1, text: lines[i].slice(start, start + 500), column: index + 1 });
            if (matches.length >= SEARCH_MATCHES) { truncated = true; break outer; }
          }
        }
      }
      return { query, matches, truncated, scannedFiles, scannedBytes };
    } catch (error) { throw translated(error); }
  }
  async _gitReady() {
    const root = await this._root(), admin = path.join(root, '.git');
    let stat; try { stat = await fs.lstat(admin); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    // Linked worktrees and external Git directories can read outside the session boundary.
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail(403, 'EXTERNAL_GIT_DIR', '仅支持工作区内部的普通 Git 仓库。');
    // Git follows its own refs/object/config files, outside the normal file-reader checks.
    // Reject links throughout the bounded metadata tree before starting any Git process.
    const queue = [admin]; let metadataCount = 0;
    while (queue.length) {
      const directory = await fs.opendir(queue.pop());
      for await (const entry of directory) {
        if (++metadataCount > 20000) throw fail(413, 'GIT_METADATA_LIMIT', 'Git 元数据过多，网页查询已停止。');
        const full = path.join(directory.path, entry.name), info = await fs.lstat(full);
        if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1)
          throw fail(403, 'UNSAFE_GIT_METADATA', 'Git 元数据包含链接文件。');
        if (info.isDirectory()) queue.push(full);
        else if (!info.isFile()) throw fail(403, 'UNSAFE_GIT_METADATA', 'Git 元数据不是普通文件。');
      }
    }
    for (const name of ['config', 'config.worktree', 'index', 'HEAD', 'objects', 'objects/info', 'refs', 'info', 'packed-refs']) {
      try { if ((await fs.lstat(path.join(admin, name))).isSymbolicLink()) throw fail(403, 'UNSAFE_GIT_METADATA', 'Git 元数据包含符号链接。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const name of ['commondir', 'objects/info/alternates', 'objects/info/http-alternates']) {
      try { const info = await fs.lstat(path.join(admin, name)); if (info.size || info.isSymbolicLink()) throw fail(403, 'EXTERNAL_GIT_DIR', '不支持引用外部对象或共享目录的 Git 仓库。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const name of ['config', 'config.worktree']) {
      try {
        const configPath = path.join(admin, name), info = await fs.stat(configPath);
        if (info.size > 256 * 1024) throw fail(413, 'GIT_CONFIG_LIMIT', 'Git 配置文件过大。');
        if (/^\s*\[\s*include(?:if)?\b/im.test(await fs.readFile(configPath, 'utf8')))
          throw fail(403, 'EXTERNAL_GIT_CONFIG', '网页 Git 查询不加载包含其他文件的配置。');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return root;
  }
  async _git(root, args, limit = GIT_LIMIT) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat', PAGER: 'cat', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1', GIT_ATTR_NOSYSTEM: '1' });
    const argv = ['--no-pager', '--no-optional-locks', '--literal-pathspecs',
      `--git-dir=${path.join(root, '.git')}`, `--work-tree=${root}`,
      '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=',
      '-c', 'core.attributesFile=/dev/null', '-c', 'core.excludesFile=/dev/null',
      '-c', 'core.quotePath=false', '-c', 'color.ui=false', ...args];
    return new Promise((resolve, reject) => {
      execFile('git', argv, { cwd: root, env, timeout: 8000, maxBuffer: limit, encoding: 'utf8', windowsHide: true }, (error, stdout) => {
        if (!error) return resolve({ stdout, truncated: false });
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve({ stdout: stdout || '', truncated: true });
        reject(fail(503, error.killed ? 'GIT_TIMEOUT' : 'GIT_UNAVAILABLE', error.killed ? 'Git 查询超时。' : 'Git 查询未完成。'));
      });
    });
  }
  async gitStatus() {
    try {
      const root = await this._gitReady();
      if (!root) return { available: false, branch: null, entries: [], truncated: false };
      const result = await this._git(root, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=normal', '--ignore-submodules=all']);
      const fields = result.stdout.split('\0'), entries = [];
      let branch = null, hidden = 0, truncated = result.truncated;
      for (let i = 0; i < fields.length - 1; i++) {
        const value = fields[i];
        if (value.startsWith('## ')) { branch = value.slice(3); continue; }
        const status = value.slice(0, 2), file = value.slice(3);
        let originalPath;
        if (/[RC]/.test(status)) {
          if (i + 1 >= fields.length - 1 || !fields[i + 1]) { truncated = true; break; }
          originalPath = fields[++i];
        }
        const normalized = file.endsWith('/') ? file.slice(0, -1) : file;
        try {
          relativePath(normalized); if (originalPath) relativePath(originalPath);
          const item = await this._resolve(normalized, { missing: true });
          if (item.stat?.isFile() && item.stat.nlink !== 1) throw fail(403, 'HARDLINK_FILE', '不允许硬链接文件。');
          if (originalPath) {
            const original = await this._resolve(originalPath, { missing: true });
            if (original.stat?.isFile() && original.stat.nlink !== 1) throw fail(403, 'HARDLINK_FILE', '不允许硬链接文件。');
          }
        } catch { hidden++; continue; }
        entries.push({ path: normalized, status, index: status[0], workingTree: status[1], ...(originalPath ? { originalPath } : {}) });
        if (entries.length >= 500) { truncated = true; break; }
      }
      return { available: true, branch, entries, hidden, truncated };
    } catch (error) { throw translated(error); }
  }
  async diff(relative) {
    try {
      const root = await this._gitReady();
      if (!root) return { available: false, diff: '', stagedDiff: '', workingDiff: '', untrackedPaths: [], truncated: false };
      if (relative !== undefined) await this._resolve(relativePath(relative), { missing: true });
      const status = await this.gitStatus();
      const selected = status.entries.filter(entry => relative === undefined || entry.path === relative || entry.originalPath === relative);
      const untrackedPaths = selected.filter(entry => entry.status === '??').map(entry => entry.path);
      const paths = [...new Set(selected.filter(entry => entry.status !== '??').flatMap(entry => [entry.path, entry.originalPath].filter(Boolean)))].slice(0, 200);
      if (!paths.length) return { available: true, diff: '', stagedDiff: '', workingDiff: '', untrackedPaths, truncated: status.truncated };
      const common = ['--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--ignore-submodules=all'];
      const staged = await this._git(root, ['diff', '--cached', ...common, '--', ...paths], GIT_LIMIT / 2);
      const working = await this._git(root, ['diff', ...common, '--', ...paths], GIT_LIMIT / 2);
      return { available: true, diff: [staged.stdout, working.stdout].filter(Boolean).join('\n'),
        stagedDiff: staged.stdout, workingDiff: working.stdout, untrackedPaths,
        truncated: status.truncated || staged.truncated || working.truncated || selected.length > 200 };
    } catch (error) { throw translated(error); }
  }
}
