import os from 'node:os';
import fs from 'node:fs/promises';
import {execFile}from 'node:child_process';
import {promisify}from 'node:util';
const exec=promisify(execFile);
const cpu=()=>os.cpus().reduce((a,c)=>{a.idle+=c.times.idle;a.total+=Object.values(c.times).reduce((x,y)=>x+y,0);return a;},{idle:0,total:0});
export class SystemMonitor{
 constructor({workspaceRoot,binary}){this.root=workspaceRoot;this.binary=binary;this.last=cpu();this.account={loggedIn:false,subscriptionType:null,version:null};this.lastAccount=0;}
 async sample(activeRuns=0){const c=cpu(),delta=c.total-this.last.total;const cpuPercent=delta?Math.max(0,100*(1-(c.idle-this.last.idle)/delta)):0;this.last=c;let total=os.totalmem(),available=os.freemem(),swapTotal=0,swapFree=0;try{const v=Object.fromEntries((await fs.readFile('/proc/meminfo','utf8')).split('\n').map(l=>l.match(/^(\w+):\s+(\d+)/)).filter(Boolean).map(x=>[x[1],Number(x[2])*1024]));total=v.MemTotal;available=v.MemAvailable;swapTotal=v.SwapTotal;swapFree=v.SwapFree;}catch{}let disk={};try{const s=await fs.statfs(this.root);disk={totalBytes:s.bsize*s.blocks,usedBytes:s.bsize*(s.blocks-s.bfree),availableBytes:s.bsize*s.bavail};disk.percent=100*disk.usedBytes/disk.totalBytes;}catch{}return {cpuPercent,memory:{totalBytes:total,availableBytes:available,usedBytes:total-available,percent:100*(total-available)/total},swap:{totalBytes:swapTotal,usedBytes:swapTotal-swapFree},disk,load:os.loadavg(),uptimeSeconds:os.uptime(),activeRuns,queueLimit:1,sampledAt:new Date().toISOString()};}
 // Results are reused for 60 s. A caller that should not wait (starting a turn, answering the page) gets a login
 // confirmed in the last 10 minutes at once, while the check refreshes it in the background.
 async auth({wait=true,force=false}={}){const age=Date.now()-this.lastAccount;if(!force&&age<60000)return this.account;if(!force&&!wait&&this.account.loggedIn===true&&age<600000){void this.#check();return this.account;}return this.#check();}
 async #check(){this.lastAccount=Date.now();try{const [{stdout:a},{stdout:v}]=await Promise.all([exec(this.binary,['auth','status'],{timeout:12000,maxBuffer:32768}),exec(this.binary,['--version'],{timeout:12000,maxBuffer:4096})]);const j=JSON.parse(a);this.account={loggedIn:j.loggedIn,subscriptionType:j.subscriptionType,authMethod:j.authMethod,version:v.trim()};}catch{this.account={...this.account,loggedIn:false};}return this.account;}
}
