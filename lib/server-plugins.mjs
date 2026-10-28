// Generic lifecycle for trusted, bundled server extensions. Feature logic belongs in plugins/<id>.
// Downloaded/development plugins remain browser-only: their JavaScript is never imported here.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {PluginError} from './plugins.mjs';

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SESSION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fail = (status, message) => { throw new PluginError(status, message); };
const CHOICE = /^[A-Za-z0-9_.:-]{1,64}$/;
// Composer picker values sent with the first message of a conversation: { pluginId: value }.
export const validChoices = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 8 &&
  Object.entries(value).every(([id, choice]) => ID.test(id) && typeof choice === 'string' && CHOICE.test(choice));

export class ServerPluginHost {
  constructor({manager, dataDir, context}) {
    this.manager = manager;
    this.dataDir = path.join(dataDir, 'server-plugin-data');
    this.context = context;
    this.active = new Map();
    this.failures = new Map();
    this.owners = {};
    this.pending = Promise.resolve();
    this.syncing = Promise.resolve();
    this.closed = false;
  }
  async init() {
    await fs.mkdir(this.dataDir, {recursive:true, mode:0o700});
    const stat = await fs.lstat(this.dataDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(500, '服务端插件数据目录不可用。');
    this.ownerFile = path.join(this.dataDir, 'session-contexts.json');
    try {
      const info = await fs.lstat(this.ownerFile);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) throw new Error('invalid owner file');
      const saved = JSON.parse(await fs.readFile(this.ownerFile, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('invalid owner records');
      for (const [id, owners] of Object.entries(saved)) {
        if (!SESSION.test(id) || !Array.isArray(owners) || !owners.every(x=>typeof x==='string'&&ID.test(x))) throw new Error('invalid owner record');
        this.owners[id]=owners;
      }
    } catch (error) { if(error.code!=='ENOENT') fail(500, '服务端插件会话归属记录损坏，请从备份恢复。'); }
    await this.reconcile();
  }
  enabled(id) { return !this.closed && !this.context.isClosing() && this.manager.isActive(id); }
  saveOwners() {
    const text=JSON.stringify(this.owners);
    this.pending=this.pending.catch(()=>{}).then(async()=>{
      const temp=`${this.ownerFile}.${randomUUID()}.tmp`;
      await fs.writeFile(temp,text,{mode:0o600});
      await fs.rename(temp,this.ownerFile);
    });
    return this.pending;
  }
  reconcile() {
    const sync=async()=>{
      for (const [id, instance] of this.active) if(!this.enabled(id)) {
        this.active.delete(id);
        try { await instance.close?.(); } catch { console.error('Server plugin cleanup failed'); }
      }
      this.failures.clear();
      if(this.closed)return;
      for (const [id, plugin] of this.manager.plugins) {
        if(!plugin.manifest.backend || !this.enabled(id) || this.active.has(id))continue;
        try {
          if(plugin.source!=='builtin' || !plugin.manifest.permissions.includes('backend')) fail(403,'服务端扩展必须由管理员随工作台安装。');
          const base=await fs.realpath(this.manager.builtinDir);
          const expected=path.join(base,id), dir=await fs.realpath(plugin.dir);
          if(dir!==expected || (await fs.lstat(expected)).isSymbolicLink())fail(403,'服务端插件目录不能是软链接。');
          const entry=path.join(dir,plugin.manifest.backend), real=await fs.realpath(entry);
          if(real!==entry || !real.startsWith(dir+path.sep) || !(await fs.stat(real)).isFile())fail(403,'服务端插件入口路径无效。');
          const ownDir=path.join(this.dataDir,id);
          await fs.mkdir(ownDir,{recursive:true,mode:0o700});
          if((await fs.lstat(ownDir)).isSymbolicLink())fail(403,'服务端插件数据目录不能是软链接。');
          const module=await import(pathToFileURL(real).href);
          if(typeof module.activate!=='function')fail(500,'服务端插件缺少 activate 接口。');
          const instance=await module.activate({...this.context, dataDir:ownDir, isActive:()=>this.enabled(id)});
          if(!instance || typeof instance!=='object')fail(500,'服务端插件初始化失败。');
          this.active.set(id,instance);
        } catch(error) {
          this.failures.set(id,error instanceof PluginError?error.message:'服务端插件加载失败，请检查服务日志和插件版本。');
          console.error(`Server plugin ${id} could not be activated`);
        }
      }
    };
    this.syncing=this.syncing.then(sync,sync);
    return this.syncing;
  }
  list() {
    const result=this.manager.list();
    return {...result, plugins:result.plugins.map(p=>({...p,...(p.backend?{backendReady:this.active.has(p.id),backendError:this.failures.get(p.id)||null}: {})}))};
  }
  async executionStatus(fallback) {
    const statuses=[];
    for(const [id,error] of this.failures) if(this.enabled(id)) statuses.push({ready:false,label:'服务端插件',detail:error});
    for(const [id,instance] of this.active) if(this.enabled(id) && instance.executionStatus) {
      try {
        const status=await instance.executionStatus();
        if(status && [true,false,null].includes(status.ready)) statuses.push({ready:status.ready,label:String(status.label||'执行环境').slice(0,80),detail:String(status.detail||'').slice(0,300)});
      } catch { statuses.push({ready:false,label:'执行环境',detail:'插件状态检查失败，请刷新后重试。'}); }
    }
    if(!statuses.length)return {ready:fallback?.loggedIn!==false,label:'Claude Code',detail:fallback?.loggedIn===false?'请在服务器上用官方 Claude Code 完成登录后再使用。':''};
    return statuses.find(s=>s.ready===false)||statuses.find(s=>s.ready===null)||statuses[0];
  }
  async call(id, method, params) {
    if(!this.enabled(id))fail(403,'插件未启用，或工作台处于安全模式。');
    if(typeof method!=='string'||!/^[a-zA-Z][a-zA-Z0-9.]{0,63}$/.test(method))fail(400,'插件方法无效。');
    if(Buffer.byteLength(JSON.stringify(params??null))>64*1024)fail(413,'插件参数超过 64 KB。');
    const plugin=this.manager.plugins.get(id);
    if(plugin?.source!=='builtin'||!plugin.manifest.backend||!plugin.manifest.permissions.includes('backend'))fail(403,'这个插件没有服务端扩展权限。');
    const instance=this.active.get(id);
    if(!instance?.call)fail(503,this.failures.get(id)||'插件后端尚未就绪。');
    return instance.call(method,params??{});
  }
  async readUsage(input) {
    if(input.session)this.assertContext(input.session);
    let result=null;
    for(const [id,instance] of this.active) if(this.enabled(id) && instance.readUsage) {
      const snapshot=await instance.readUsage({...input,choice:validChoices(input.choices)&&Object.hasOwn(input.choices,id)?input.choices[id]:null});
      if(snapshot==null)continue;
      if(result!==null)fail(409,'两个插件试图提供同一会话的额度。');
      if(typeof snapshot!=='object'||Array.isArray(snapshot))fail(500,'插件返回了无效的额度数据。');
      result=snapshot;
    }
    return result;
  }
  assertContext(session) {
    for(const id of this.owners[session.id]||[]) if(!this.enabled(id)||!this.active.has(id))fail(409,'此会话使用的服务端插件已停用。请重新启用该插件后续聊，或新建会话。');
  }
  async prepare({session,cwd,request,run,kind='run'}) {
    this.assertContext(session);
    for(const [id,error] of this.failures) if(this.enabled(id))fail(503,error);
    const options={}, owners=new Set(this.owners[session.id]||[]);
    const {choices,...shared}=request||{};
    run.pluginEntries=[];
    for(const [id,instance] of this.active) {
      if(!this.enabled(id))continue;
      run.pluginEntries.push([id,instance]);
      // Reserve ownership durably before an extension may move a CLI session to another context.
      if(instance.managesExecutionContext) {
        owners.add(id); this.owners[session.id]=[...owners]; await this.saveOwners();
      }
      const result=await instance.beforeRun?.({session,cwd,request:{...shared,choice:validChoices(choices)&&Object.hasOwn(choices,id)?choices[id]:null},run,kind});
      if(result?.runnerOptions) {
        for(const [key,value] of Object.entries(result.runnerOptions)) {
          if(!['configDir'].includes(key)||typeof value!=='string'||!path.isAbsolute(value))fail(500,'插件返回了无效的执行配置。');
          if(key in options && options[key]!==value)fail(409,'两个插件试图修改同一个执行配置。');
          options[key]=value;
        }
      }
      if(result?.ownsContext)owners.add(id);
      else if(result?.ownsContext===false)owners.delete(id);
      if(owners.size)this.owners[session.id]=[...owners];else delete this.owners[session.id];
      if(result?.ownsContext!==undefined || instance.managesExecutionContext)await this.saveOwners();
    }
    return options;
  }
  event(payload) {
    const run=payload.run;
    // Hooks observe the event-time status, even when persistence runs after the next event.
    payload={...payload,session:{...payload.session,permissions:structuredClone(payload.session?.permissions||[])},event:structuredClone(payload.event)};
    // Preserve lifecycle order even if a plugin persists asynchronously.
    run.pluginEvents=(run.pluginEvents||Promise.resolve()).then(async()=>{
      for(const [,instance] of run.pluginEntries||[]) {
        try { await instance.onEvent?.(payload); } catch {run.pluginPersistenceError=true;console.error('Server plugin event persistence failed');}
      }
    }).catch(()=>{run.pluginPersistenceError=true;console.error('Server plugin could not persist an execution event');});
  }
  async exit(payload) {
    await payload.run?.pluginEvents;
    for(const [,instance] of payload.run?.pluginEntries||[]) {
      try { await instance.onExit?.(payload); } catch {console.error('Server plugin completion persistence failed');}
    }
  }
  async stop(payload) {
    await payload.run?.pluginEvents;
    for(const instance of this.active.values()) {
      try { await instance.onStop?.(payload); } catch {console.error('Server plugin stop persistence failed');}
    }
  }
  async close() {
    this.closed=true;
    await this.syncing;
    for(const instance of this.active.values()) {
      try { await instance.close?.(); } catch {console.error('Server plugin cleanup failed');}
    }
    this.active.clear();
    await this.pending.catch(()=>console.error('Server plugin ownership persistence failed'));
  }
}
