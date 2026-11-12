// Adapter to the generic workbench lifecycle; all routing policy lives beside this file.
import {createAccountPool, PRIMARY_ACCOUNT_ID} from './server.mjs';
export async function activate(context) {
  // Automatic account switches and continuations reach open pages as a runtime change.
  const pool=await createAccountPool({...context,onNotes:()=>context.runtimeChanged?.()});
  return {
    managesExecutionContext:true,
    async call(method,params) {
      const result=await pool.call(method,params);
      if(['create','update','settings','bind','refresh'].includes(method))context.runtimeChanged?.();
      return result;
    },
    executionStatus:()=>pool.executionStatus(),
    refresh:options=>pool.refreshAll(options),
    async beforeRun(input) {
      const selected=await pool.beforeRun(input);
      return {
        runnerOptions:selected.configDir?{configDir:selected.configDir}:{},
        ownsContext:selected.accountId!==PRIMARY_ACCOUNT_ID,
        ...(selected.onExit?{onExit:selected.onExit}:{}),
      };
    },
    onEvent:payload=>pool.onEvent(payload),
    onExit:payload=>pool.onExit(payload),
    close:()=>pool.close(),
  };
}
