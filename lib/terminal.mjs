import {claudeEnvironment} from './claude-environment.mjs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {readdirSync,readFileSync} from 'node:fs';
import {rootOperationsArgs} from './root-operations.mjs';
import {isModel} from './models.mjs';

const helper=fileURLToPath(new URL('./pty-bridge.py',import.meta.url));
const fail=(status,message)=>Object.assign(new Error(message),{status});
// Emergency fallback if the Python bridge dies before its orderly descendant cleanup.
// Linux production identities include kernel starttime, preventing accidental PID reuse.
function rememberProcesses(t){
 if(process.platform!=='linux')return;
 const table=new Map();
 try{for(const name of readdirSync('/proc')){if(!/^\d+$/.test(name))continue;try{const raw=readFileSync(`/proc/${name}/stat`,'utf8'),f=raw.slice(raw.lastIndexOf(')')+2).split(/\s+/);table.set(Number(name),{parent:Number(f[1]),session:Number(f[3]),birth:f[19]});}catch{}}}catch{return;}
 const owned=new Set([...t.owned].filter(([pid,birth])=>table.get(pid)?.birth===birth).map(([pid])=>pid));
 for(const[pid,row]of table)if(pid===t.child.pid||(t.pgid&&row.session===t.pgid))owned.add(pid);
 for(let changed=true;changed;){changed=false;for(const[pid,row]of table)if(owned.has(row.parent)&&!owned.has(pid)){owned.add(pid);changed=true;}}
 owned.delete(process.pid);for(const pid of owned)t.owned.set(pid,table.get(pid).birth);
}
function killOwned(t){
 rememberProcesses(t);
 if(process.platform==='linux')for(const[pid,birth]of t.owned){try{const raw=readFileSync(`/proc/${pid}/stat`,'utf8'),f=raw.slice(raw.lastIndexOf(')')+2).split(/\s+/);if(f[19]===birth&&pid!==process.pid)process.kill(pid,'SIGKILL');}catch{}}
 else if(t.pgid)try{process.kill(-t.pgid,'SIGKILL');}catch{}
}
export class TerminalManager {
 constructor({binary,python='/usr/bin/python3',idleMs=30*60_000,onUpdate=()=>{}}={}){this.binary=binary;this.python=python;this.idleMs=idleMs;this.onUpdate=onUpdate;this.terminals=new Map();this.closed=false;}
 list(){return [...this.terminals.values()].map(t=>this.public(t));}
 public(t){return {id:t.id,sessionId:t.sessionId,kind:t.kind,status:t.status,createdAt:t.createdAt,exitCode:t.exitCode};}
 get active(){return [...this.terminals.values()].find(t=>t.status==='running');}
 get(id){const t=this.terminals.get(id);if(!t)throw fail(404,'终端不存在。');return t;}
 start({sessionId,cwd,kind='shell',cols=100,rows=28,model='sonnet',effort='auto',permissionMode='bypassPermissions',claudeSessionId,configDir,onExit}={}){
  if(this.closed)throw fail(503,'服务正在关闭。');
  if(!['shell','claude'].includes(kind))throw fail(400,'终端类型不支持。');
  if(!Number.isInteger(cols)||cols<40||cols>240||!Number.isInteger(rows)||rows<10||rows>100)throw fail(400,'终端尺寸无效。');
  if(this.active)throw fail(409,'已有终端运行，请先关闭或重新连接。');
  if(!isModel(model)||!['auto','low','medium','high','xhigh','max'].includes(effort)||!['default','plan','bypassPermissions'].includes(permissionMode))throw fail(400,'会话配置不受支持。');
  if(claudeSessionId&&!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(claudeSessionId))throw fail(400,'原生会话标识无效。');
  const argv=kind==='shell'?['/bin/bash','--noprofile','--norc','-i']:[this.binary,'--model',model,'--permission-mode',permissionMode==='default'?'manual':permissionMode,...(effort==='auto'?[]:['--effort',effort]),...(claudeSessionId?[`--resume=${claudeSessionId}`]:[])];
  const env=claudeEnvironment({configDir});
  Object.assign(env,{TERM:'xterm-256color',COLORTERM:'truecolor',LANG:'C.UTF-8',BROWSER:'true'});
  if(kind==='claude')argv.push(...rootOperationsArgs(env));
  const child=spawn(this.python,['-I',helper],{cwd,env,stdio:['pipe','pipe','pipe']});
  const t={id:randomUUID(),sessionId,kind,status:'running',createdAt:new Date().toISOString(),child,events:new EventEmitter(),frames:[],bytes:0,seq:0,pgid:null,lastActivity:Date.now(),exitCode:null,owned:new Map(),cleanExit:false};
  for(const [id,old]of this.terminals)if(old.status!=='running'){old.events.removeAllListeners();this.terminals.delete(id);}
  this.terminals.set(t.id,t);let pending='';
  const emit=value=>{const frame={...value,seq:++t.seq};t.frames.push(frame);t.bytes+=JSON.stringify(frame).length;while(t.bytes>512*1024&&t.frames.length>1)t.bytes-=JSON.stringify(t.frames.shift()).length;t.events.emit('data',frame);};
  const end=code=>{if(t.status!=='running')return;t.status='exited';t.exitCode=code;clearInterval(t.timer);clearInterval(t.processTimer);clearTimeout(t.killTimer);if(!t.cleanExit)killOwned(t);try{onExit?.(code);}catch{}emit({type:'exit',code});this.onUpdate(this.list());};
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{pending+=chunk;if(pending.length>2*1024*1024){this.stop(t.id);return;}let nl;while((nl=pending.indexOf('\n'))!==-1){const line=pending.slice(0,nl);pending=pending.slice(nl+1);try{const m=JSON.parse(line);if(m.type==='ready'&&Number.isInteger(m.pid)&&m.pid>1){t.pgid=m.pid;rememberProcesses(t);this.onUpdate(this.list());}else if(m.type==='output'&&typeof m.data==='string'&&m.data.length){t.lastActivity=Date.now();emit({type:'output',data:m.data});}else if(m.type==='exit'){t.cleanExit=true;end(m.code);}}catch{}}});
  child.stderr.resume();child.on('error',()=>{emit({type:'output',data:'\r\n终端启动失败，请检查服务。\r\n'});end(-1);});child.on('close',code=>end(code));child.stdin.on('error',()=>{});
  t.done=new Promise(resolve=>child.once('close',resolve));
  this.send(t,{cwd,argv,cols,rows});
  if(process.platform==='linux'){t.processTimer=setInterval(()=>rememberProcesses(t),250);t.processTimer.unref();}
  // Claude may be silently thinking or executing a long task without keyboard input.
  // Only interactive shells are reclaimed, and real PTY output counts as activity.
  if(kind==='shell'){t.timer=setInterval(()=>{if(Date.now()-t.lastActivity>this.idleMs){emit({type:'output',data:'\r\nShell 无输入或输出超过闲置时限，已关闭。\r\n'});this.stop(t.id);}},15000);t.timer.unref();}this.onUpdate(this.list());return this.public(t);
 }
 send(t,value){if(!t.child.stdin.writable||t.child.stdin.destroyed||t.child.stdin.writableLength>262144)return false;t.child.stdin.write(JSON.stringify(value)+'\n');return true;}
 input(id,data){const t=this.get(id);if(t.status!=='running')throw fail(409,'终端已经结束。');if(typeof data!=='string'||Buffer.byteLength(data)>65536)throw fail(400,'终端输入过大。');if(!this.send(t,{type:'input',data}))throw fail(429,'终端输入仍在处理，请稍后重试。');if(data.length)t.lastActivity=Date.now();}
 resize(id,cols,rows){const t=this.get(id);if(!Number.isInteger(cols)||cols<40||cols>240||!Number.isInteger(rows)||rows<10||rows>100)throw fail(400,'终端尺寸无效。');this.send(t,{type:'resize',cols,rows});}
 stop(id){const t=this.get(id);if(t.status!=='running')return;rememberProcesses(t);this.send(t,{type:'stop'});if(t.pgid)t.child.kill('SIGTERM');if(!t.killTimer)t.killTimer=setTimeout(()=>{killOwned(t);t.child.kill('SIGKILL');},3000);}
 async close(){this.closed=true;for(const t of this.terminals.values())if(t.status==='running')this.stop(t.id);await Promise.allSettled([...this.terminals.values()].map(t=>t.done));}
}
