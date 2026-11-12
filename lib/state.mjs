import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const idPattern=/^[a-f0-9-]{36}$/;
export const validId=id=>typeof id==='string'&&idPattern.test(id);
export const now=()=>new Date().toISOString();
export function emptyMetrics(){return {turns:0,userMessages:0,assistantMessages:0,toolCalls:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,costUsd:0,durationMs:0,apiDurationMs:0,contextTokens:0,contextWindow:null,tokensPerSecond:null,contextHistory:[]};}
const CONTINUED_PROMPT=/^上一轮因「[^」]*」.{0,20}用尽中断，工作台已自动换到「/;
export function cleanPreview(text){if(typeof text!=='string')return '';const marker='\n\n引用当前工作区文件：\n',cut=text.lastIndexOf(marker);return (cut>=0?text.slice(0,cut):text).replace(/\s+/g,' ').trim().slice(0,120);}
const previewOf=s=>{const m=s.messages?.findLast(x=>x.role==='user'&&!x.steer&&!x.handoff&&typeof x.text==='string'&&x.text.trim()&&!CONTINUED_PROMPT.test(x.text));return m?cleanPreview(m.text):'';};
export function newSession({title='新的对话',model='sonnet',permissionMode='bypassPermissions',effort='auto'}={}){return {id:randomUUID(),title,model,permissionMode,effort,pinned:false,archived:false,status:'idle',createdAt:now(),updatedAt:now(),messages:[],tools:[],tasks:[],permissions:[],events:[],metrics:emptyMetrics(),claudeSessionId:null};}
// activeAt (the last message the user sent) orders the session list; updatedAt moves with every streamed save.
export function summary(s){const {id,title,model,permissionMode,status,archived,createdAt,updatedAt}=s;const lastPrompt=s.messages?.findLast(m=>m.role==='user'&&!m.steer)||s.messages?.findLast(m=>m.role==='user');return {id,title,model,permissionMode,effort:s.effort||'auto',pinned:Boolean(s.pinned),preview:previewOf(s),status,archived,createdAt,updatedAt,activeAt:lastPrompt?.createdAt||createdAt};}
export function publicSession(s){const {claudeSessionId,_requestIds,_usageBase,...safe}=s;return {...safe};}
// Live UI payload: the browser refetches this on every update, so drop the audit log and
// cap large tool text. The full record stays available from the tool and export routes.
const clip=(value,limit)=>typeof value==='string'&&value.length>limit?value.slice(0,limit):value;
export function liveTool(t,outputLimit=4000,inputLimit=20000){let inputTruncated=false;const input=t.input&&typeof t.input==='object'&&!Array.isArray(t.input)?Object.fromEntries(Object.entries(t.input).map(([k,v])=>{const c=clip(v,inputLimit);if(c!==v)inputTruncated=true;return [k,c];})):t.input;const output=clip(t.output,outputLimit);return {...t,input,output,...(output!==t.output?{outputTruncated:true,outputLength:t.output.length}:{}),...(inputTruncated?{inputTruncated:true}:{})};}
export function liveSession(s){const {events,...safe}=publicSession(s);return {...safe,tools:(safe.tools||[]).map(t=>liveTool(t))};}
export class Store{
 constructor(dir){this.dir=dir;this.sessions=new Map();this.pending=new Map();this.timers=new Map();}
 async init(){await fs.mkdir(this.dir,{recursive:true,mode:0o700});for(const f of await fs.readdir(this.dir)){if(!f.endsWith('.json')||!validId(f.slice(0,-5)))continue;try{const s=JSON.parse(await fs.readFile(path.join(this.dir,f),'utf8'));if(!validId(s.id))continue;if(s.limitHit)delete s.limitHit.auto;if(['running','awaiting_approval'].includes(s.status)){s.status='error';s.permissions=[];for(const m of s.messages||[])if(m.steer==='queued')m.steer='dropped';s.events.push({type:'interrupted',time:now(),message:'服务重启，上一轮已中断。你可以继续对话。'});}this.sessions.set(s.id,s);}catch{console.error('Skipped unreadable session file');}}}
 list(){return [...this.sessions.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(summary);}
 get(id){return validId(id)?this.sessions.get(id):undefined;}
 async save(s){s.updatedAt=now();this.sessions.set(s.id,s);const value=JSON.stringify(s);const old=this.pending.get(s.id)||Promise.resolve();const next=old.catch(()=>{}).then(async()=>{const tmp=path.join(this.dir,`${s.id}.${randomUUID()}.tmp`);await fs.writeFile(tmp,value,{mode:0o600});await fs.rename(tmp,path.join(this.dir,`${s.id}.json`));});this.pending.set(s.id,next);try{await next;}finally{if(this.pending.get(s.id)===next)this.pending.delete(s.id);}}
 schedule(s){if(this.timers.has(s.id))return;this.timers.set(s.id,setTimeout(()=>{this.timers.delete(s.id);this.save(s).catch(()=>console.error('Session persistence failed'));},400));}
 async flush(){for(const [id,t]of this.timers){clearTimeout(t);this.timers.delete(id);await this.save(this.sessions.get(id));}await Promise.allSettled([...this.pending.values()]);}
 // Long sessions keep only a recent window in the live record; older messages and tool records move to an
 // append-only <id>.history.jsonl that export merges back. Claude's own context is separate (the CLI resumes
 // its transcript and compacts it), so moving history never changes what the model sees.
 historyFile(id){return path.join(this.dir,`${id}.history.jsonl`);}
 async trimHistory(s,{maxMessages=600,maxTools=600,keepMessages=300,keepTools=300}={}){
  const messages=s.messages||[],tools=s.tools||[];
  if(messages.length<=maxMessages&&tools.length<=maxTools)return 0;
  const keepFrom=(list,keep)=>list.length>keep?list[list.length-keep].createdAt||'':'';
  let since=[keepFrom(messages,keepMessages),keepFrom(tools,keepTools)].sort().at(-1);
  // The window starts at a user message, so a turn is never split: the first turn after the cut, or the turn
  // the cut falls in when that is the newest one (a single turn can hold more records than the window keeps).
  // Guidance sent during a turn belongs to that turn and never starts one.
  const starts=m=>m.role==='user'&&!m.steer;
  const turn=messages.find(m=>starts(m)&&m.createdAt>=since)||messages.findLast(m=>starts(m)&&m.createdAt<since);if(turn)since=turn.createdAt;
  const old=x=>(x.createdAt||'')<since,oldMessages=messages.filter(old),oldTools=tools.filter(old);
  if(!oldMessages.length&&!oldTools.length)return 0;
  const lines=[...oldMessages.map(m=>({kind:'message',...m})),...oldTools.map(t=>({kind:'tool',...t}))].map(x=>JSON.stringify(x)+'\n').join('');
  await fs.appendFile(this.historyFile(s.id),lines,{mode:0o600});
  const h=s.history||{},count=(key,n)=>(h[key]||0)+n;
  s.history={messages:count('messages',oldMessages.length),tools:count('tools',oldTools.length),turns:count('turns',oldMessages.filter(starts).length),
   replies:count('replies',oldMessages.filter(m=>m.role==='assistant'&&(m.text||'').trim()).length),assistantMessages:count('assistantMessages',oldMessages.filter(m=>m.role==='assistant').length),until:since};
  s.messages=messages.filter(x=>!old(x));s.tools=tools.filter(x=>!old(x));
  return oldMessages.length+oldTools.length;
 }
 // Full record for export: moved history first, then the live window. A crash between the append and the
 // next save can leave a record in both places; the live copy wins.
 async fullHistory(s){
  let text='';try{text=await fs.readFile(this.historyFile(s.id),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  const messages=new Map(),tools=new Map();
  for(const line of text.split('\n')){if(!line)continue;try{const {kind,...x}=JSON.parse(line);(kind==='tool'?tools:messages).set(x.id,x);}catch{console.error('Skipped unreadable history line');}}
  for(const m of s.messages||[])messages.set(m.id,m);for(const t of s.tools||[])tools.set(t.id,t);
  return {messages:[...messages.values()],tools:[...tools.values()]};
 }
}
// Streaming targets the newest messages, so search from the end.
function messageFor(s,id,time,role='assistant'){let m=s.messages.findLast(x=>x.id===id);if(!m){m={id,role,text:'',createdAt:time};s.messages.push(m);}return m;}
// Thinking ends when its block stops, or at the latest when the reply text begins.
const endThinking=(m,time)=>{if(m.thinkingStartedAt&&!m.thinkingEndedAt)m.thinkingEndedAt=time;};
// A rejected rate limit (or a CLI error naming one) leaves the turn unfinished. Record which
// limit was hit and when it resets, so the UI can show the user why the turn stopped.
const LIMIT_TEXT=/rate_limit|usage limit|hit your limit|limit reached|额度/i;
function markLimitHit(s,run,time,resetAt,limitType){
 s.limitHit={at:s.limitHit?.at||time,resetAt:resetAt||s.limitHit?.resetAt||null,limitType:limitType||s.limitHit?.limitType||null};
}
// An error during a turn marks the run as failed; the session shows it as an error once the process has
// exited. Until then it is still running, so the page keeps offering Stop and never offers a send that the
// server would refuse.
export function applyEvent(s,e,run){
 const time=now();
 switch(e.type){
 case 'session':s.claudeSessionId=e.sessionId;break;
 case 'capabilities':s.capabilities={commands:e.commands||[],models:e.models||[],agents:e.agents||[],version:e.version};break;
 case 'thinking_start':case 'thinking_stop':case 'thinking_progress':case 'thinking_delta':case 'thinking':{
  if(e.type==='thinking_progress'&&!e.messageId)break;
  const m=messageFor(s,e.id||e.messageId||run.messageId,time);
  if(e.type!=='thinking_stop')m.thinkingStartedAt||=time;
  // A later block in the same message is separated once its first text arrives.
  if(e.type==='thinking_start'){delete m.thinkingEndedAt;if(m.thinking)(run.thinkingBreaks||=new Set()).add(m.id);}
  else if(e.type==='thinking_stop')m.thinkingEndedAt=time;
  else if(e.type==='thinking_progress'){if(Number.isFinite(e.estimatedTokens))m.thinkingTokens=Math.max(m.thinkingTokens||0,e.estimatedTokens);}
  else if(e.type==='thinking_delta'){const gap=run.thinkingBreaks?.delete(m.id)&&m.thinking&&!m.thinking.endsWith('\n\n')?'\n\n':'';m.thinking=((m.thinking||'')+gap+e.text).slice(0,300000);}
  // A redacted block has no readable text; it must not erase thinking already streamed.
  else{if(e.text||!e.redacted)m.thinking=String(e.text||'').slice(0,300000);if(e.redacted)m.thinkingRedacted=true;}
  break;}
 case 'task':{s.tasks||=[];let t=s.tasks.find(x=>x.id===e.id);if(!t){t={id:e.id,createdAt:time};s.tasks.push(t);}Object.assign(t,e);s.tasks=s.tasks.slice(-100);break;}
 case 'text_delta':{const m=messageFor(s,e.messageId||run.messageId,time);m.text=(m.text+e.text).slice(0,600000);endThinking(m,time);break;}
 case 'message':{const m=messageFor(s,e.id||e.messageId||run.messageId,time,e.role||'assistant');m.text=String(e.text||'').slice(0,600000);if(typeof e.model==='string'&&e.model.length<=80)m.model=e.model;endThinking(m,time);s.metrics.assistantMessages=(s.history?.assistantMessages||0)+s.messages.filter(x=>x.role==='assistant').length;break;}
 case 'tool':{let t=s.tools.find(x=>x.id===e.id);if(!t){t={id:e.id,createdAt:time};s.tools.push(t);}Object.assign(t,e);if(typeof t.output==='string')t.output=t.output.slice(0,32000);s.metrics.toolCalls=(s.history?.tools||0)+s.tools.length;break;}
 case 'permission':s.permissions.push({id:e.id,toolName:e.toolName,input:e.input,createdAt:time});s.status='awaiting_approval';break;
 case 'permission_cancelled':s.permissions=s.permissions.filter(p=>p.id!==e.id);if(s.status==='awaiting_approval'&&!s.permissions.length)s.status='running';break;
 case 'usage':{
 const keys=['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','costUsd'];
 if(e.final!==false&&e.scope!=='response')for(const k of keys)if(Number.isFinite(e[k])){const scope=k==='costUsd'?(e.costScope||e.scope):e.scope;s.metrics[k]=scope==='turn'?(run.usageBase[k]||0)+e[k]:Math.max(run.usageBase[k]||0,e[k]);}
 for(const k of ['contextTokens','contextWindow','model','tokensPerSecond'])if(e[k]!=null)s.metrics[k]=e[k];
 if(e.modelUsage)s.metrics.modelUsage=e.modelUsage;
 if(Number.isFinite(e.durationMs))s.metrics.durationMs=run.usageBase.durationMs+e.durationMs;
 if(Number.isFinite(e.apiDurationMs))s.metrics.apiDurationMs=run.usageBase.apiDurationMs+e.apiDurationMs;
 if(e.contextTokens!=null){const p={step:s.metrics.contextHistory.length+1,tokens:e.contextTokens,inputTokens:e.inputTokens||0,outputTokens:e.outputTokens||0,cacheReadTokens:e.cacheReadTokens||0,cacheWriteTokens:e.cacheWriteTokens||0,time};const last=s.metrics.contextHistory.at(-1);if(!last||last.tokens!==p.tokens)s.metrics.contextHistory.push(p);s.metrics.contextHistory=s.metrics.contextHistory.slice(-200);}
 break;}
 case 'rate_limit':if(e.rateLimited)markLimitHit(s,run,time,e.cooldownUntil,e.limitType);break;
 case 'error':if(run)run.failed=true;else s.status='error';s.lastError=e.message;if(LIMIT_TEXT.test(String(e.message||'')))markLimitHit(s,run,time,null);break;
 case 'steer':{const m=s.messages.findLast(x=>x.id===e.id&&x.steer);if(m)m.steer=e.state;break;}
 case 'done':if(s.status!=='error')s.status='idle';s.permissions=[];for(const m of s.messages)if(m.steer==='queued')m.steer='dropped';for(let i=s.messages.length-1;i>=0&&(s.messages[i].role!=='user'||s.messages[i].steer);i--)endThinking(s.messages[i],time);break;
 }
 // Tool input/output already lives in s.tools; the audit log keeps only the transition
 // (not the progress of a tool call whose input is still being generated).
 if(!['text_delta','message','thinking_delta','thinking','thinking_start','thinking_stop','thinking_progress','usage','quota','capabilities','session'].includes(e.type)&&!(e.type==='tool'&&e.status==='preparing')){s.events.push(e.type==='tool'?{type:'tool',id:e.id,name:e.name,status:e.status,durationMs:e.durationMs,time}:{...e,time});s.events=s.events.slice(-1000);}
}
