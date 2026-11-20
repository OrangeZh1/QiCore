import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as vue from 'vue';
import {createDiscardChanges} from '../app/composables/useDiscardChanges.ts';

async function settings(t,siteId){
 const source=await readFile(new URL('../app/components/console/StorageSettings.vue',import.meta.url),'utf8');
 const initial={siteId,inherited:false,canWrite:true,version:1,active:{provider:'local',label:'本地存储',revisionId:'local'},providers:[{provider:'local',label:'本地存储',enabled:true,isDefault:true,revisionId:'local',status:'passed',bucket:'',region:'',privateDomain:'',maxFileMb:20},{provider:'qiniu',label:'七牛',enabled:false,isDefault:false,revisionId:'cloud',status:'passed',bucket:'fixture',region:'',privateDomain:'https://files.example.com',maxFileMb:20}]};
 const requests=[],disposals=[],session=vue.ref({id:'actor',role:siteId?'tenant':'root',permissions:[siteId?'tenant:settings.read':'settings.read']});
 const env={ref:vue.ref,reactive:vue.reactive,computed:vue.computed,require:()=>({}),exports:{},defineProps:()=>({siteId}),useApi:()=>({session,restore:async()=>session.value,api:(url,method,body,options)=>new Promise((resolve,reject)=>requests.push({url,method,body,options,resolve,reject}))}),useAsyncData:async()=>({data:vue.ref(initial),error:vue.ref(null)}),useToast:()=>({add:()=>{}}),useDiscardChanges:blocked=>createDiscardChanges(blocked),onBeforeUnmount:fn=>disposals.push(fn),onBeforeRouteLeave:()=>{},navigateTo:async()=>{},createError:input=>Error(input.statusMessage)};
 const code=ts.transpileModule(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1],{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const model=await new AsyncFunction(...Object.keys(env),code+'\nreturn {action,refresh,busy,form,data,error,openSettings,endpoint};')(...Object.values(env));
 t.after(()=>disposals.forEach(fn=>fn()));return {...model,requests,initial,dispose:()=>disposals.forEach(fn=>fn()),template:source.split('</script>')[1]};
}

for(const siteId of [undefined,'site-a'])test(`storage settings ${siteId||'platform'} keep save, test, activation and refresh indicators independent`,async t=>{
 const page=await settings(t,siteId);assert.equal(page.endpoint,siteId?'/admin/tenants/site-a/storage':'/admin/storage');
 page.openSettings('qiniu');
 for(const kind of ['save','test','default']){
  const pending=page.action(kind);assert.equal(page.busy.value,kind);const request=page.requests.at(-1);
  await page.refresh();await page.action('save');assert.equal(page.requests.at(-1),request,'overlapping clicks do not dispatch a second action');
  request.resolve({...page.initial,version:page.data.value.version+1});await pending;assert.equal(page.busy.value,null);
 }
 const failed=page.action('test');page.requests.at(-1).reject(Error('测试失败'));await failed;assert.equal(page.busy.value,null);assert.equal(page.error.value,'测试失败');
 const refresh=page.refresh();assert.equal(page.busy.value,'refresh');page.requests.at(-1).resolve(page.initial);await refresh;assert.equal(page.busy.value,null);
 const abandoned=page.action('test');const request=page.requests.at(-1);page.dispose();assert.equal(request.options.signal.aborted,true);request.resolve({...page.initial,version:999});await abandoned;assert.notEqual(page.data.value.version,999);assert.equal(page.busy.value,null);
 assert.doesNotMatch(page.template,/USwitch|:loading="busy"/);for(const action of ['save','test','default'])assert.ok(page.template.includes(`:loading="busy==='${action}'"`));
});
