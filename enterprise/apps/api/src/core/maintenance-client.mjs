export function maintenanceText(value,now=Date.now()){
 if(value.unreachable)return '更新状态暂时无法读取，请检查网络后重试';
 if(value.paused)return '更新状态仍待确认，请手动重试';
 if(value.state==='recovery_required')return '系统更新暂未完成，需要管理员处理恢复';
 if(value.estimatedSeconds&&now-Date.parse(value.startedAt)>value.estimatedSeconds*1000)return '更新仍在进行，耗时比预计稍长，请稍候';
 return value.estimatedSeconds?'系统正在更新，预计约 '+Math.max(1,Math.ceil(value.estimatedSeconds/60))+' 分钟':'系统正在更新，请稍候';
}
export const maintenanceTitle=value=>value.paused||value.unreachable?'更新状态待确认':value.state==='recovery_required'?'系统更新暂未完成':'系统正在更新';
export const maintenanceHint=value=>value.paused?'请手动重新检查，确认服务恢复后将重新读取页面数据':'恢复后将自动重新加载页面数据';
export function maintenancePresentation(value,now=Date.now()){
 const attention=value.paused||value.unreachable||value.state==='recovery_required',overdue=value.estimatedSeconds&&now-Date.parse(value.startedAt)>value.estimatedSeconds*1000;
 return {title:maintenanceTitle(value),attention,description:value.paused?'自动检查已暂停，请手动检查状态。':value.unreachable?'暂时无法连接，请稍后重试。':value.state==='recovery_required'?'需要管理员处理，请稍后查看。':overdue?'耗时比预计稍长，请稍候。':'请稍候，更新完成后可继续使用。',hint:value.paused?'手动确认恢复后重载数据':'恢复后自动重载当前页数据',estimate:!attention&&!overdue&&value.estimatedSeconds?'预计约 '+Math.max(1,Math.ceil(value.estimatedSeconds/60))+' 分钟':''};
}
// The transport only performs an anonymous status GET. Never retain/replay business requests.
export function createMaintenanceMonitor({read,now=Date.now,schedule=setTimeout,cancel=clearTimeout}){
 let value={state:'unknown',serviceAvailable:false},active=false,pending=null,timer,attempts=0,last=0,generation=0,recoveryVersion=0;
 const listeners=new Set(),recovered=new Set();
 const notify=()=>{for(const callback of listeners)callback({...value,active})};
 const later=()=>{if(timer)cancel(timer);if(listeners.size&&!value.paused)timer=schedule(()=>check(),active?5000:15000)};
 async function check(manual=false){
  if(pending)return pending;
  if(manual){attempts=0;value={...value,paused:false};}
  const own=generation;last=now();
  pending=(async()=>{
   try{
    const next=await read();
    if(own!==generation)return;
    if(next?.protocol!=='qicore-maintenance-v1'||!['ready','updating','recovery_required','unavailable'].includes(next.state)||typeof next.serviceAvailable!=='boolean')throw Error('INVALID_STATUS');
    if(['updating','recovery_required'].includes(next.state))active=true;
    const done=active&&next.state==='ready'&&next.serviceAvailable===true;
    value={...next,unreachable:false,paused:false};
    if(done){active=false;attempts=0;recoveryVersion++;for(const callback of recovered)Promise.resolve().then(callback).catch(()=>{});}
   }catch{if(own===generation&&active)value={...value,unreachable:true};}
   finally{if(own===generation){if(active&&++attempts>=120)value={...value,paused:true};notify();pending=null;later();}}
  })();return pending;
 }
 return {
  subscribe(callback){listeners.add(callback);callback({...value,active});if(listeners.size===1&&!value.paused)void check();return()=>{listeners.delete(callback);if(!listeners.size&&timer)cancel(timer)};},
  recovered(callback){recovered.add(callback);return()=>recovered.delete(callback)},
  recoveryVersion(){return recoveryVersion},
  probe(){if(listeners.size&&!value.paused&&now()-last>=5000)void check();},retry(){return check(true)},
  reset(){generation++;if(timer)cancel(timer);pending=null;active=false;attempts=0;value={state:'unknown',serviceAvailable:false};notify();},
 };
}
