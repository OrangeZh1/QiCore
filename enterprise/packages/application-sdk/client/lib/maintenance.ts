import {onShow,onHide,onUnload} from '@dcloudio/uni-app'
import {onMounted,onBeforeUnmount,watch} from 'vue'
import {runtimeConfig} from './runtime-config'
import {createMaintenanceMonitor} from '@qicore/application-sdk/browser/maintenance-client.mjs'
let base=''
const statusRead=()=>new Promise<any>((resolve,reject)=>{
 const endpoint=runtimeConfig().apiBase
 let done=false,task:UniApp.RequestTask|undefined
 const finish=(callback:()=>void)=>{if(done)return;done=true;clearTimeout(timer);callback()}
 const timer=setTimeout(()=>{finish(()=>reject(Error('STATUS_TIMEOUT')));task?.abort()},5000)
 try{task=uni.request({url:endpoint+'/public/maintenance',method:'GET',timeout:5000,success:r=>finish(()=>r.statusCode===200?resolve((r.data as any)?.data):reject(Error('STATUS_UNAVAILABLE'))),fail:()=>finish(()=>reject(Error('STATUS_UNAVAILABLE')))})}catch(e){finish(()=>reject(e))}
})
const monitor=createMaintenanceMonitor({read:statusRead})
function context(){const next=runtimeConfig().apiBase;if(base!==next){base=next;monitor.reset()}}
export const maintenance={subscribe(callback:(value:any)=>void){try{context();return monitor.subscribe(callback)}catch{return()=>{}}},recovered(callback:()=>unknown){return monitor.recovered(callback)},recoveryVersion:()=>monitor.recoveryVersion(),probe(){try{context();monitor.probe()}catch{}},retry(){context();return monitor.retry()}}
// Register only a data read that preserves the page's drafts; never submit or pay here.
export function useMaintenanceReload(read:()=>unknown,busy:()=>boolean=()=>false){
 let release:(()=>unknown)|undefined,queued=false,active=true,disposed=false,seen=maintenance.recoveryVersion()
 async function flush(){if(disposed||!active||!queued||busy())return;queued=false;try{await read()}catch{/* The page owns its read error and manual retry. */}}
 const register=()=>{if(disposed)return;active=true;if(!release)release=maintenance.recovered(()=>{seen=maintenance.recoveryVersion();if(active){queued=true;void flush()}});if(queued||seen!==maintenance.recoveryVersion()){seen=maintenance.recoveryVersion();queued=true;const wasBusy=busy();queueMicrotask(()=>{if(!wasBusy&&busy())queued=false;else void flush()})}}
 const pause=()=>{active=false;release?.();release=undefined}
 const stop=watch(busy,()=>{if(!busy())void flush()},{flush:'post'})
 const dispose=()=>{disposed=true;queued=false;pause();stop()}
 onMounted(register);onShow(register);onHide(pause);onUnload(dispose);onBeforeUnmount(dispose)
}
