import path from 'node:path';
import fs from 'node:fs/promises';
import {Workspace} from './workspace.mjs';

export function registerIDE(app,{store,workspaceRoot,terminals,runs,mutations,send,auth,clients,event,isClosing=()=>false,isLocked=()=>false,prepareTerminal=async()=>({})}){
 const workspace=req=>new Workspace(path.join(workspaceRoot,req.session.id));
 const mutate=async(req,res,action,status=200)=>{const id=req.session.id;if(isClosing())return send(res,503,'工作台正在关闭。');if(runs.has(id)||terminals.active?.sessionId===id||mutations.has(id)||isLocked()){return send(res,409,'这个会话有任务、终端或文件操作正在进行，请稍后再试。');}mutations.add(id);try{res.status(status).json(await action(workspace(req)));}finally{mutations.delete(id);}};
 app.get('/api/sessions/:id/files',async(req,res)=>res.json(await workspace(req).list(req.query.path||'')));
 app.get('/api/sessions/:id/file',async(req,res)=>res.json(await workspace(req).read(req.query.path)));
 app.put('/api/sessions/:id/file',async(req,res)=>mutate(req,res,w=>w.write(req.body?.path,req.body?.text,req.body?.hash)));
 app.post('/api/sessions/:id/upload',async(req,res)=>mutate(req,res,w=>w.upload(req.body?.path,req.body?.base64,req.body?.hash??null),201));
 app.post('/api/sessions/:id/directories',async(req,res)=>mutate(req,res,w=>w.mkdir(req.body?.path),201));
 app.get('/api/sessions/:id/search',async(req,res)=>res.json(await workspace(req).search(req.query.q)));
 app.get('/api/sessions/:id/git',async(req,res)=>res.json(await workspace(req).gitStatus()));
 app.get('/api/sessions/:id/diff',async(req,res)=>res.json(await workspace(req).diff(req.query.path)));
 app.get('/api/terminals',(req,res)=>res.json(terminals.list()));
 app.post('/api/terminals',async(req,res)=>{
  const s=store.get(req.body?.sessionId);if(!s)return send(res,404,'请先创建或选择会话。');
  if(s.archived)return send(res,409,'请先恢复归档会话。');
  if(isClosing())return send(res,503,'工作台正在关闭。');
  if(runs.has(s.id)||mutations.has(s.id)||isLocked()||terminals.active)return send(res,409,'请等待这个会话的任务、已打开的终端或插件配置操作结束。');
  mutations.add(s.id);
  try{
   const cwd=path.join(workspaceRoot,s.id);const stat=await fs.lstat(cwd);if(!stat.isDirectory()||stat.isSymbolicLink())return send(res,403,'工作目录不可用。');
   if(isClosing())return send(res,503,'工作台正在关闭。');
   let onExit;
   try{
    const prepared=await prepareTerminal(s,cwd,req.body?.kind||'shell')||{};
    onExit=prepared.onExit;const {onExit:_drop,...extensionOptions}=prepared;
    if(isClosing()){onExit?.(-1);return send(res,503,'工作台正在关闭。');}
    const t=terminals.start({...extensionOptions,onExit,sessionId:s.id,cwd,kind:req.body?.kind,cols:req.body?.cols??100,rows:req.body?.rows??28,model:s.model,effort:s.effort||'auto',permissionMode:s.permissionMode,claudeSessionId:s.claudeSessionId});
    onExit=null;res.status(201).json(t);
   }catch(error){try{onExit?.(-1);}catch{}throw error;}
  }finally{mutations.delete(s.id);}
 });
 app.get('/api/terminals/:terminalId/events',(req,res)=>{
  if(clients.size>=24)return send(res,429,'实时连接较多，请关闭多余页面。');
  const t=terminals.get(req.params.terminalId);res.set({'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();res.write('retry: 1500\n\n');
  const c={res,key:req.login.key,expires:req.login.expires,channel:'terminal'};clients.add(c);
  const write=frame=>{if(!auth.sessions.has(c.key)||c.expires<Date.now()){res.end();return;}if(res.writableLength>1024*1024){res.destroy();return;}res.write(`id: ${frame.seq}\ndata: ${JSON.stringify(frame)}\n\n`);};
  const after=Number(req.headers['last-event-id']||0);for(const frame of t.frames)if(frame.seq>after)write(frame);
  t.events.on('data',write);const heartbeat=setInterval(()=>{if(!auth.sessions.has(c.key)||c.expires<Date.now())res.end();else res.write(': heartbeat\n\n');},15000);heartbeat.unref();
  req.on('close',()=>{t.events.off('data',write);clearInterval(heartbeat);clients.delete(c);});
 });
 app.post('/api/terminals/:terminalId/input',(req,res)=>{terminals.input(req.params.terminalId,req.body?.data);res.status(204).end();});
 app.post('/api/terminals/:terminalId/resize',(req,res)=>{terminals.resize(req.params.terminalId,req.body?.cols,req.body?.rows);res.status(204).end();});
 app.post('/api/terminals/:terminalId/stop',(req,res)=>{terminals.stop(req.params.terminalId);res.json(terminals.public(terminals.get(req.params.terminalId)));});
}
