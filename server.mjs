import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Store,newSession,publicSession,liveSession,summary,applyEvent,now} from './lib/state.mjs';
import {Auth} from './lib/auth.mjs';
import {SystemMonitor} from './lib/system.mjs';
import {createClaudeRun} from './lib/claude-runner.mjs';
import {UsageMonitor} from './lib/usage.mjs';
import {TerminalManager} from './lib/terminal.mjs';
import {registerIDE} from './lib/api-ide.mjs';
import {LiveFeed} from './lib/live.mjs';
import {ModelCatalog,contextKey,isModel} from './lib/models.mjs';
import {PluginManager,PluginError} from './lib/plugins.mjs';
import {ServerPluginHost,validChoices} from './lib/server-plugins.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
// Shown in the page; release is the directory name under releases/ when deployed from a release tree.
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,release=path.basename(path.dirname(root))==='releases'?path.basename(root):null;
// A fresh install has no credential yet: say how to create one instead of failing with a bare ENOENT.
async function readPasswordRecord(file){let text;try{text=await fs.readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')throw new Error(`未找到登录口令文件 ${file}，请先运行 npm run set-password 创建工作台口令。`);throw error;}const record=JSON.parse(text);if(typeof record?.salt!=='string'||typeof record?.hash!=='string')throw new Error(`登录口令文件 ${file} 格式无效，请重新运行 npm run set-password。`);return record;}
export async function createWorkbench(options={}){
 const dataDir=options.dataDir||process.env.WORKBENCH_DATA||path.join(root,'data');
 const workspaceRoot=options.workspaceRoot||process.env.WORKBENCH_WORKSPACES||path.join(dataDir,'workspaces');
 const origin=options.origin||process.env.WORKBENCH_ORIGIN||'http://127.0.0.1:17880';
 const binary=options.binary||process.env.CLAUDE_BINARY||'claude';
 const passwordRecord=options.passwordRecord||await readPasswordRecord(process.env.WORKBENCH_AUTH_FILE||path.join(dataDir,'auth.json'));
 await fs.mkdir(workspaceRoot,{recursive:true,mode:0o700});
 const store=new Store(path.join(dataDir,'sessions'));await store.init();
 const catalog=new ModelCatalog({dataDir});await catalog.init([...store.sessions.values()]);
 const auth=new Auth({dir:dataDir,passwordRecord,userName:passwordRecord.userName||options.userName,secure:new URL(origin).protocol==='https:'});await auth.init();
 const monitor=options.monitor||new SystemMonitor({workspaceRoot,binary});
 const runFactory=options.runFactory||createClaudeRun;
 const runs=new Map(),clients=new Set(),notices=new Map(),legacyNotices=new Map(),mutations=new Set();let shuttingDown=false;
 // Plugins and skins: builtin ones ship in ./plugins, installed and in-development ones live in <data>/plugins.
 const plugins=new PluginManager({dataDir,builtinDir:options.builtinPluginsDir===undefined?path.join(root,'plugins'):options.builtinPluginsDir,workbenchVersion:version,origin,safeMode:options.safeMode??process.env.WORKBENCH_SAFE_MODE==='1',workshopUrl:options.workshopUrl??process.env.WORKBENCH_WORKSHOP_URL,fetchImpl:options.fetchImpl});await plugins.init();
 const usage=options.usageMonitor||new UsageMonitor({binary,cwd:workspaceRoot,onUpdate:snapshot=>event({type:'usage',usage:snapshot})});
 const terminals=options.terminals||new TerminalManager({binary,onUpdate:terminals=>event({type:'terminals',terminals})});
 const busy=()=>Boolean(runs.size||terminals.active||mutations.size);
 // Up to maxRuns conversations run side by side, each with its own workspace and Claude process.
 // One session still runs one turn at a time; exclusive operations (plugin changes, account probes)
 // wait for every task and terminal, and hold back new ones while they run.
 const maxRuns=Math.max(1,Math.min(6,Math.floor(Number(options.maxConcurrentRuns??process.env.WORKBENCH_MAX_RUNS))||3));
 const EXCLUSIVE='exclusive',locked=()=>mutations.has(EXCLUSIVE);
 const sessionBusy=id=>Boolean(runs.has(id)||terminals.active?.sessionId===id||mutations.has(id));
 const runBlocked=s=>locked()?'插件或配置操作正在进行，请完成后再开始任务。':sessionBusy(s.id)?'这个会话的任务或终端仍在运行。请等待完成，或先停止它。':runs.size>=maxRuns?`已有 ${maxRuns} 个任务在并行运行。请等其中一个完成，或先停止一个。`:null;
 async function withExclusive(action){if(shuttingDown)throw new PluginError(503,'工作台正在关闭。');if(busy())throw new PluginError(409,'请等待当前任务、终端或配置操作结束。');mutations.add(EXCLUSIVE);try{return await action();}finally{mutations.delete(EXCLUSIVE);}}
 const serverPlugins=new ServerPluginHost({manager:plugins,dataDir,context:{binary,workspaceRoot,getSession:id=>store.get(id),listSessions:()=>[...store.sessions.values()],startTurn,isBusy:busy,isClosing:()=>shuttingDown,withExclusive,runtimeChanged:()=>event({type:'runtime-updated'}),usageChanged:()=>event({type:'usage-invalidated'})}});
 const effortLevels=['auto','low','medium','high','xhigh','max'];
 const app=express();app.disable('x-powered-by');
 // Only our local reverse proxy may provide a client address; never trust arbitrary X-Forwarded-For chains.
 app.set('trust proxy','loopback');
 app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self' blob:; frame-src ${origin}/plugin-frame/; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`});next();});
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');const requestOrigin=req.headers.origin;if(requestOrigin&&requestOrigin!==origin)return res.status(403).json({error:'请求来源不匹配。'});if(!['GET','HEAD'].includes(req.method)){if(requestOrigin!==origin)return res.status(403).json({error:'请从工作台页面操作。'});if(!req.is('application/json'))return res.status(415).json({error:'请求格式不正确。'});}next();});
 const smallJson=express.json({limit:'96kb',strict:true}),uploadJson=express.json({limit:'12mb',strict:true}),fileJson=express.json({limit:'3mb',strict:true}),pluginJson=express.json({limit:'4mb',strict:true}),storageJson=express.json({limit:'320kb',strict:true});
 // Larger bodies are parsed only after the login and CSRF checks pass.
 const largeParser=req=>/^\/api\/sessions\/[a-f0-9-]{36}\/(upload|file)$/.test(req.path)&&['POST','PUT'].includes(req.method)?(req.path.endsWith('/upload')?uploadJson:fileJson):req.method==='POST'&&req.path==='/api/plugins/install'?pluginJson:req.method==='PUT'&&/^\/api\/plugins\/[a-z0-9-]{2,40}\/storage$/.test(req.path)?storageJson:null;
 app.use((req,res,next)=>{const parser=largeParser(req);if(parser){const login=auth.get(req);if(!login)return res.status(401).json({error:'请先登录。'});if(req.headers['x-csrf-token']!==login.csrfToken)return res.status(403).json({error:'操作凭据已失效。'});return parser(req,res,next);}return smallJson(req,res,next);});
 const send=(res,status,error)=>res.status(status).json({error});
 function event(data,to){const wire=`data: ${JSON.stringify(data)}\n\n`;for(const c of clients){if(c.channel==='terminal'||(to&&(to==='patches')!==Boolean(c.patches)))continue;if(!auth.sessions.has(c.key)||c.expires<Date.now()){c.res.end();clients.delete(c);continue;}if(c.res.writableLength>1024*1024){c.res.destroy();clients.delete(c);}else c.res.write(wire);}}
 const feed=new LiveFeed({broadcast:data=>event(data,'patches')});
 // Responses that the browser adopts as its transcript state carry the live patch position.
 const sessionView=s=>({...publicSession(s),live:feed.info(s.id)});
 // Carry the list summary so other tabs can update status badges without a refetch.
 function notify(id,immediate=false){const fire=()=>{const s=store.get(id);event({type:'session-updated',sessionId:id,...(s?{summary:summary(s)}:{})});};if(immediate){clearTimeout(notices.get(id));notices.delete(id);fire();return;}if(!notices.has(id))notices.set(id,setTimeout(()=>{notices.delete(id);fire();},350));}
 // Pages loaded before live patches existed (no ?patches=1) learn about streamed changes by refetching.
 function legacyNotify(id){if(legacyNotices.has(id)||![...clients].some(c=>c.channel!=='terminal'&&!c.patches))return;legacyNotices.set(id,setTimeout(()=>{legacyNotices.delete(id);const s=store.get(id);event({type:'session-updated',sessionId:id,...(s?{summary:summary(s)}:{})},'legacy');},350));}
 app.get('/healthz',(req,res)=>res.json({ok:true}));
 app.get('/api/auth',(req,res)=>{const s=auth.get(req);res.json(s?{authenticated:true,user:s.user,csrfToken:s.csrfToken}:{authenticated:false});});
 app.post('/api/login',async(req,res)=>{const r=await auth.login(req.body?.password,req.ip);if(r.error)return send(res,r.status,r.error);res.setHeader('Set-Cookie',auth.cookie(r.raw));res.json({authenticated:true,user:r.user,csrfToken:r.csrfToken});});
 app.use('/api',(req,res,next)=>{req.login=auth.get(req);if(!req.login)return send(res,401,'登录已失效，请重新登录。');if(!['GET','HEAD'].includes(req.method)&&req.headers['x-csrf-token']!==req.login.csrfToken)return send(res,403,'操作凭据已失效，请刷新页面。');next();});
 app.post('/api/logout',async(req,res)=>{await auth.logout(req.login);for(const c of clients)if(c.key===req.login.key){c.res.end();clients.delete(c);}res.setHeader('Set-Cookie',auth.cookie('',0));res.status(204).end();});
 app.get('/api/bootstrap',async(req,res)=>{
  const [system,account]=await Promise.all([monitor.sample(runs.size+(terminals.active?1:0)),monitor.auth()]);
  const execution=await serverPlugins.executionStatus(account);
  void usage.refresh().catch(()=>{});
  res.json({execution,user:req.login.user,csrfToken:req.login.csrfToken,sessions:store.list(),system,account,usage:usage.read(),terminals:terminals.list(),config:{version,release,models:catalog.list(),effortLevels,workspaceRoot,rootOperations:process.env.WORKBENCH_ROOT_OPERATIONS==='1',maxConcurrentRuns:maxRuns,maxMessageLength:30000,usageSource:'official-cli',costBasis:'API 等价估算，非 Pro 账单',privateWorkspace:true,plugins:{safeMode:plugins.safeMode,workshop:Boolean(plugins.workshopUrl),sdkVersion:1}}});
 });
 app.get('/api/usage',async(req,res)=>{
  const force=req.query.refresh==='1';
  let choices=null,session=null;
  if(req.query.choices!==undefined){
   if(typeof req.query.choices!=='string'||req.query.choices.length>2048)return send(res,400,'选择器参数无效。');
   try{choices=JSON.parse(req.query.choices);}catch{return send(res,400,'选择器参数无效。');}
   if(!validChoices(choices))return send(res,400,'选择器参数无效。');
  }
  if(req.query.sessionId!==undefined){
   if(typeof req.query.sessionId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(req.query.sessionId))return send(res,400,'会话 id 无效。');
   session=store.get(req.query.sessionId);if(!session)return send(res,404,'会话不存在。');
  }
  if(session||choices){
   const snapshot=await serverPlugins.readUsage({session,choices,refresh:force,inProgress:Boolean(session&&(runs.has(session.id)||terminals.active?.sessionId===session.id))});
   if(snapshot!==null)return res.json(snapshot);
  }
  await usage.refresh({force}).catch(()=>{});res.json(usage.read());
 });
 app.get('/api/sessions',(req,res)=>res.json(store.list()));
 app.get('/api/events',(req,res)=>{if(clients.size>=24)return send(res,429,'打开的实时连接较多，请关闭多余页面。');res.set({'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();const c={res,key:req.login.key,expires:req.login.expires,patches:req.query.patches==='1'};clients.add(c);res.write('retry: 3000\n\n');res.write('data: {"type":"connected"}\n\n');req.on('close',()=>clients.delete(c));});
 let usageTick=0;
 const tick=setInterval(async()=>{try{event({type:'system',system:await monitor.sample(runs.size+(terminals.active?1:0))});if(clients.size&&!shuttingDown&&++usageTick%6===0)void usage.refresh().catch(()=>{});}catch{}},15000);tick.unref();
 app.post('/api/sessions',async(req,res)=>{if(store.sessions.size>=500)return send(res,409,'已达到 500 个会话，请先导出和整理历史。');const {title,model='sonnet',permissionMode='bypassPermissions',effort='auto'}=req.body||{};if(!isModel(model)||!effortLevels.includes(effort)||!['bypassPermissions','default','plan'].includes(permissionMode))return send(res,400,'模型或权限模式不支持。');if(title!=null&&(typeof title!=='string'||title.length>100))return send(res,400,'标题过长。');const s=newSession({title:title?.trim()||'新的对话',model,permissionMode,effort});await fs.mkdir(path.join(workspaceRoot,s.id),{mode:0o700});await store.save(s);notify(s.id,true);res.status(201).json(sessionView(s));});
 app.use('/api/sessions/:id',(req,res,next)=>{req.session=store.get(req.params.id);if(!req.session)return send(res,404,'会话不存在。');next();});
 registerIDE(app,{store,workspaceRoot,terminals,runs,mutations,send,auth,clients,event,isClosing:()=>shuttingDown,isLocked:locked,prepareTerminal:async(session,cwd,kind)=>kind==='claude'?serverPlugins.prepare({session,cwd,request:{source:'terminal'},run:{messageId:randomUUID()},kind:'terminal'}):{}});
 app.get('/api/sessions/:id',(req,res)=>res.json(req.query.view==='live'?{...liveSession(req.session),live:feed.info(req.session.id)}:sessionView(req.session)));
 app.get('/api/sessions/:id/tools/:toolId',(req,res)=>{const tool=req.session.tools?.find(t=>t.id===req.params.toolId);if(!tool)return send(res,404,'工具记录不存在。');res.json(tool);});
 app.patch('/api/sessions/:id',async(req,res)=>{
 const s=req.session,b=req.body||{};
 if('title'in b&&(typeof b.title!=='string'||!b.title.trim()||b.title.length>100))return send(res,400,'标题需为 1–100 个字符。');
 if('archived'in b&&typeof b.archived!=='boolean')return send(res,400,'归档参数不正确。');
 if('model'in b&&!isModel(b.model))return send(res,400,'不支持该模型。');
 if('effort'in b&&!effortLevels.includes(b.effort))return send(res,400,'不支持该思考等级。');
 if('permissionMode'in b&&!['bypassPermissions','default','plan'].includes(b.permissionMode))return send(res,400,'不支持该权限模式。');
 if(sessionBusy(s.id)||locked())return send(res,409,'请先停止当前任务或终端，再修改会话。');
 for(const key of ['title','archived','model','effort','permissionMode'])if(key in b)s[key]=key==='title'?b[key].trim():b[key];
 await store.save(s);notify(s.id,true);res.json(sessionView(s));
 });
 async function startTurn(s,text,request={}){
  const {requestId}=request,fail=(code,msg)=>({code,msg});
  if(shuttingDown)return fail(503,'工作台正在重启，请稍后重试。');
  if(requestId&&s._requestIds?.includes(requestId))return {code:202};
  const blocked=runBlocked(s);if(blocked)return fail(409,blocked);
  if(s.archived)return fail(409,'请先恢复归档会话。');
  // The reservation and completion include asynchronous preflight and persistence.
  let resolveDone, finished=false, staged=null;
  const run={messageId:randomUUID(),usageBase:{...s.metrics},startedAt:Date.now(),handle:null,done:new Promise(resolve=>{resolveDone=resolve;})};
  runs.set(s.id,run);
  async function finish(result){
   if(finished)return run.done;
   finished=true;
   try {
    if(result.preflightFailed && staged)Object.assign(s,staged);
    else if(!result.preflightFailed){
     s.permissions=[];
     if(result.timedOut||result.stopReason==='error'||s.status==='error')s.status='error';
     else if(result.stopped){s.status='idle';s.events.push({type:'stopped',time:now(),message:'任务已停止。'});}
     else if(result.code!==0&&!result.endedAfterResult){s.status='error';s.lastError=s.lastError||'Claude Code 进程已退出，请查看本轮记录后重试。';}
     else s.status='idle';
     s.metrics.durationMs=Math.max(s.metrics.durationMs,run.usageBase.durationMs+Date.now()-run.startedAt);
    }
    try{await store.save(s);}catch{console.error('Failed to persist completed session');}
    await serverPlugins.exit({session:s,run,result:{...result,shutdown:shuttingDown}});
   }finally{runs.delete(s.id);notify(s.id,true);resolveDone();}
  }
  try{
   // Long sessions move older records out of the live window instead of refusing new turns.
   // This runs before the preflight snapshot, so a failed start never restores moved records.
   await store.trimHistory(s).catch(()=>console.error('Session history trim failed'));
   const cwd=path.join(workspaceRoot,s.id);
   const extensionOptions=await serverPlugins.prepare({session:s,cwd,request:{...request,text},run});
   if(!extensionOptions.configDir){const account=await monitor.auth().catch(()=>null);if(account&&account.loggedIn===false)throw new PluginError(409,'Claude Code 尚未登录。请先在服务器完成官方登录，再发送任务。');}
   if(run.cancelRequested||shuttingDown)throw new PluginError(409,'任务启动已取消。');
   staged=structuredClone({status:s.status,lastError:s.lastError,limitHit:s.limitHit,permissions:s.permissions,metrics:s.metrics,messages:s.messages,title:s.title,_requestIds:s._requestIds});
   s.status='running';s.lastError=null;s.limitHit=null;s.permissions=[];s.metrics.turns++;s.metrics.userMessages++;
   const context=contextKey(extensionOptions.configDir),resolvedModel=catalog.resolve(context,s.model);
   s.messages.push({id:randomUUID(),role:'user',text:text.trim(),createdAt:now(),model:s.model,...(resolvedModel?{resolvedModel}:{})});
   if(s.title==='新的对话')s.title=text.trim().replace(/\s+/g,' ').slice(0,32);
   if(requestId)s._requestIds=[...(s._requestIds||[]),String(requestId).slice(0,80)].slice(-100);
   await store.save(s);
   if(run.cancelRequested||shuttingDown)throw new PluginError(409,'任务启动已取消。');
   notify(s.id,true);
   run.handle=runFactory({cwd,sessionId:s.claudeSessionId||undefined,model:s.model,effort:s.effort||'auto',permissionMode:s.permissionMode,prompt:text.trim(),binary,...extensionOptions,
    onEvent:e=>{if(!extensionOptions.configDir&&(e.type==='quota'||e.type==='rate_limit'))usage.observe?.(e);if(e.type==='capabilities'&&e.models?.length&&catalog.observe(context,e.models,e.version))event({type:'models',models:catalog.list()});const before=feed.before(s,e,run);applyEvent(s,e,run);serverPlugins.event({session:s,event:e,run});store.schedule(s);if(!feed.after(s,e,run,before))notify(s.id,e.type==='permission');else legacyNotify(s.id);},
    onExit:finish,
   });
   if(run.cancelRequested||shuttingDown)run.handle?.stop();
   return {code:202};
  }catch(error){
   await finish({code:-1,preflightFailed:!run.handle,stopped:Boolean(run.cancelRequested||shuttingDown)});
   if(error.status>=400&&error.status<500)return fail(error.status,error.message);
   s.lastError='无法启动 Claude Code，请检查服务状态。';
   return fail(503,s.lastError);
  }
 }
 app.post('/api/sessions/:id/messages',async(req,res)=>{
 const s=req.session,text=req.body?.text,requestId=req.body?.requestId,choices=req.body?.choices;
 if(typeof text!=='string'||!text.trim()||text.length>30000)return send(res,400,'请输入 1–30000 个字符。');
 // Values picked in plugin composer pickers before this conversation existed; each plugin only sees its own.
 if(choices!==undefined&&!validChoices(choices))return send(res,400,'输入框选择项无效。');
 const r=await startTurn(s,text,{requestId,...(choices?{choices}:{})});
 if(r.msg)return send(res,r.code,r.msg);
 res.status(202).json(sessionView(s));
 });
 // Guidance for the turn in progress: Claude reads it at its next step instead of after the turn.
 const steerRefused={starting:'任务正在启动，请稍等片刻再发送引导。',ending:'这一轮正在收尾，请等它结束后直接发送。',unsupported:'当前 Claude Code 版本不支持运行中引导，请等本轮结束后再发送。'};
 app.post('/api/sessions/:id/steer',async(req,res)=>{
 const s=req.session,text=req.body?.text,requestId=req.body?.requestId,r=runs.get(s.id);
 if(typeof text!=='string'||!text.trim()||text.length>30000)return send(res,400,'请输入 1–30000 个字符。');
 if(requestId&&s._requestIds?.includes(String(requestId).slice(0,80)))return res.status(202).json(sessionView(s));
 if(!r||r.cancelRequested)return send(res,409,'当前没有运行中的任务，可以直接发送消息。');
 const sent=r.handle?.steer?r.handle.steer(text.trim()):{ok:false,reason:'starting'};if(!sent.ok)return send(res,409,steerRefused[sent.reason]||steerRefused.ending);
 s.metrics.userMessages++;s.messages.push({id:sent.id,role:'user',text:text.trim(),createdAt:now(),steer:'queued'});if(requestId)s._requestIds=[...(s._requestIds||[]),String(requestId).slice(0,80)].slice(-100);
 await store.save(s);notify(s.id,true);res.status(202).json(sessionView(s));
 });
 app.post('/api/sessions/:id/stop',async(req,res)=>{const s=req.session,r=runs.get(s.id);if(r)r.cancelRequested=true;try{await serverPlugins.stop({session:s,run:r,reason:'user'});}finally{r?.handle?.stop();}s.permissions=[];s.events.push({type:'stop_requested',time:now(),message:'正在停止任务…'});await store.save(s);notify(s.id,true);res.json(sessionView(s));});
 app.post('/api/sessions/:id/permissions/:permissionId',async(req,res)=>{
 const s=req.session,r=runs.get(s.id),p=s.permissions.find(x=>x.id===req.params.permissionId);
 if(!r?.handle||!p)return send(res,409,'此审批已经处理或任务已结束。');
 if(typeof req.body?.allow!=='boolean')return send(res,400,'审批结果不正确。');
 let updatedInput;
 if(req.body.allow&&p.toolName==='AskUserQuestion'){
  const answers=req.body.answers,questions=p.input?.questions;
  if(!answers||typeof answers!=='object'||Array.isArray(answers)||!Array.isArray(questions))return send(res,400,'请回答问题后再提交。');
  const safe={};for(const q of questions){const a=answers[q.question];if(typeof a!=='string'||!a.trim()||a.length>10000)return send(res,400,'请填写每个问题的答案。');safe[q.question]=a;}
  updatedInput={answers:safe};
 }else if(req.body.answers!==undefined)return send(res,400,'此工具不接受问题答案。');
 const ok=r.handle.respondPermission(p.id,req.body.allow,updatedInput);if(ok===false)return send(res,409,'此审批已失效。');
 s.permissions=s.permissions.filter(x=>x.id!==p.id);s.status=s.permissions.length?'awaiting_approval':'running';
 if(req.body.allow&&p.toolName==='ExitPlanMode')s.permissionMode='default';
 s.events.push({type:'approval',time:now(),toolName:p.toolName,allow:req.body.allow});await store.save(s);notify(s.id,true);res.json(sessionView(s));
 });
 app.post('/api/sessions/:id/tasks/:taskId/stop',(req,res)=>{const task=req.session.tasks?.find(t=>t.id===req.params.taskId),r=runs.get(req.session.id);if(!task||!r?.handle?.stopTask||r.handle.stopTask(task.id)===false)return send(res,409,'此后台任务无法停止或已结束。');res.status(202).json({ok:true});});
 app.get('/api/sessions/:id/export',async(req,res)=>{let full;try{full=await store.fullHistory(req.session);}catch{return send(res,500,'读取历史记录失败，请稍后重试。');}res.setHeader('Content-Disposition',`attachment; filename="claude-${req.session.id}.json"`);res.json({...publicSession(req.session),...full});});
 // Per-session totals for plugins with the sessions.read permission: summaries and counters only, never message content.
 app.get('/api/stats',(req,res)=>{const keys=['turns','toolCalls','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','costUsd','durationMs','apiDurationMs','contextTokens','contextWindow'];res.json({generatedAt:now(),sessions:[...store.sessions.values()].map(s=>{const {activeAt,...view}=summary(s);return {...view,metrics:Object.fromEntries(keys.map(k=>[k,typeof s.metrics?.[k]==='number'?s.metrics[k]:null]))};})});});
 const pluginRoute=handler=>async(req,res)=>{try{res.json(await handler(req));}catch(error){if(error instanceof PluginError||(error.status>=400&&error.status<500))return send(res,error.status,error.message);throw error;}};
 app.get('/api/plugins',(req,res)=>res.json(serverPlugins.list()));
 app.post('/api/plugins/rescan',pluginRoute(()=>withExclusive(async()=>{await plugins.lock(()=>plugins.scan());await serverPlugins.reconcile();event({type:'runtime-updated'});return serverPlugins.list();})));
 app.post('/api/plugins/install',pluginRoute(req=>req.body?.workshopId!==undefined?plugins.installFromWorkshop(req.body.workshopId):plugins.install(req.body?.bundle,{source:'local'})));
 app.post('/api/plugins/:id/enable',pluginRoute(req=>withExclusive(async()=>{await plugins.setEnabled(req.params.id,req.body?.enabled,req.body?.granted);await serverPlugins.reconcile();event({type:'runtime-updated'});return serverPlugins.list();})));
 app.post('/api/plugins/:id/backend',pluginRoute(req=>serverPlugins.call(req.params.id,req.body?.method,req.body?.params)));
 app.post('/api/plugins/:id/uninstall',pluginRoute(req=>plugins.uninstall(req.params.id)));
 app.get('/api/plugins/:id/storage',pluginRoute(async req=>({data:await plugins.readStorage(req.params.id)})));
 app.put('/api/plugins/:id/storage',pluginRoute(async req=>{await plugins.writeStorage(req.params.id,req.body?.data);return {ok:true};}));
 app.get('/api/workshop',pluginRoute(req=>plugins.registry({refresh:req.query.refresh==='1'})));
 app.use('/api',(req,res)=>send(res,404,'接口不存在。'));
 // Plugin documents need the login cookie and must be framed by the workbench page itself;
 // a plugin frame navigating to another plugin's document arrives cross-site and is refused.
 app.get('/plugin-frame/:id/:surface',(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!auth.get(req))return res.status(401).type('text/plain').send('请先登录工作台。');
  const dest=req.headers['sec-fetch-dest'],site=req.headers['sec-fetch-site'];
  if((dest&&dest!=='iframe')||(site&&site!=='same-origin'))return res.status(403).type('text/plain').send('插件页面只能在工作台中打开。');
  const frame=plugins.frame(req.params.id,req.params.surface,{scheme:req.query.scheme});
  if(!frame)return res.status(404).type('text/plain').send('插件未启用或不存在。');
  res.set({'Content-Security-Policy':frame.csp,'X-Frame-Options':'SAMEORIGIN','X-DNS-Prefetch-Control':'off'}).type('html').send(frame.html);
 });
 app.get('/plugin-assets/:id/:token/*path',async(req,res,next)=>{
  const asset=await plugins.asset(req.params.id,req.params.token,req.params.path);
  if(!asset)return res.status(404).type('text/plain').send('Not found');
  res.set({'Content-Type':asset.type,'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",'Cache-Control':'no-cache'});
  res.sendFile(asset.file,{dotfiles:'allow',etag:true,lastModified:true},error=>{if(error&&!res.headersSent)next(error);});
 });
 app.get('/vendor/marked.js',(req,res)=>res.sendFile(path.join(root,'node_modules/marked/lib/marked.umd.js')));
 app.get('/vendor/purify.js',(req,res)=>res.sendFile(path.join(root,'node_modules/dompurify/dist/purify.min.js')));
 app.get('/vendor/xterm.js',(req,res)=>res.sendFile(path.join(root,'node_modules/@xterm/xterm/lib/xterm.js')));
 app.get('/vendor/xterm.css',(req,res)=>res.sendFile(path.join(root,'node_modules/@xterm/xterm/css/xterm.css')));
 app.get('/vendor/xterm-addon-fit.js',(req,res)=>res.sendFile(path.join(root,'node_modules/@xterm/addon-fit/lib/addon-fit.js')));
 app.use(express.static(path.join(root,'public'),{dotfiles:'deny',etag:true,maxAge:0}));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);const status=err.type==='entity.too.large'?413:err instanceof SyntaxError?400:err.status>=400&&err.status<500?err.status:500;send(res,status,status===500?'服务暂时无法完成请求。':err.status?err.message:'请求内容无效或过大。');});
 async function close(){
  shuttingDown=true;
  const pending=[...runs.entries()];
  for(const [,r] of pending)r.cancelRequested=true;
  for(const [id,r] of pending){try{await serverPlugins.stop({session:store.get(id),run:r,reason:'shutdown'});}finally{r.handle?.stop();}}
  clearInterval(tick);for(const t of [...notices.values(),...legacyNotices.values()])clearTimeout(t);
  feed.close();await terminals.close();
  await Promise.allSettled(pending.map(([,r])=>r.done));
  await serverPlugins.close();await usage.close();for(const c of clients)c.res.end();await store.flush();
 }
 await serverPlugins.init();
 return {app,store,auth,runs,terminals,usage,monitor,plugins,serverPlugins,catalog,close};
}
if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url)){
 process.umask(0o077);const wb=await createWorkbench().catch(error=>{console.error(error.message);process.exit(1);});const server=wb.app.listen(Number(process.env.PORT||17880),process.env.WORKBENCH_HOST||'127.0.0.1',()=>console.log('浮生氪劳德工作台已启动，监听本机回环地址'));
 let closing=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(closing)return;closing=true;server.close();await wb.close();process.exit(0);});
}
