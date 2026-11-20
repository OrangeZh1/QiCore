import {test} from 'node:test';

import assert from 'node:assert/strict';

import {readFile} from 'node:fs/promises';

import {setImmediate} from 'node:timers/promises';

import ts from 'typescript';

import * as vue from 'vue';

import {createDiscardChanges} from '../app/composables/useDiscardChanges.ts';

import * as scheduleHelpers from '../app/utils/task-schedule.ts';

import * as navigation from '../app/utils/console-navigation.ts';

import * as tenantEntry from '../app/utils/tenant-entry.ts';

import * as customerService from '../../api/src/core/customer-service.mjs';
import * as authAppearance from '../../api/src/core/consumer-auth-appearance.mjs';

import {platformConsole} from '../app/config/console.ts';
const applicationNavigation={};
new Function('require','exports',ts.transpileModule(await readFile(new URL('../app/utils/application-navigation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>navigation,applicationNavigation);
const menuExpansionCode=ts.transpileModule((await readFile(new URL('../app/composables/useConsoleMenuExpansion.ts',import.meta.url),'utf8')).replaceAll('import.meta.client','true').replaceAll('import.meta.server','false'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

test('transaction menus use order grants while settings grants remain independent',async t=>{
 for(const permissions of [['orders.read'],['demo:orders.read'],['settings.read'],['tenant:settings.read'],[]]){
  const p=await page(t,'components/tenant/TenantConsoleShell.vue',{tenantId:'fixture',permissions});
  const transactions=p.menuGroups.value.find(group=>group.key==='transactions');
  assert.equal(!!transactions,permissions.some(p=>p.endsWith('orders.read')));
  if(transactions)assert.deepEqual(transactions.items.map(item=>item.to),['/admin/recharge-orders','/admin/after-sales','/admin/transactions']);
  assert.ok(!p.menuGroups.value.some(group=>group.key==='production'));
 }
});

test('after-sales merges only into an authorized application route that declares the shared tab',async t=>{
 for(const routes of [[],[{path:'/admin/orders',label:'订单管理',permission:'orders.read',group:'transactions',icon:'i-lucide-receipt-text',applicationKey:'example'}]]){
  const p=await page(t,'components/tenant/TenantConsoleShell.vue',{tenantId:'fixture',permissions:['tenant:orders.read'],consoleRoutes:routes});
  assert.ok(p.menuGroups.value.find(group=>group.key==='transactions').items.some(item=>item.to==='/admin/after-sales'));
 }
 const route={path:'/admin/orders',label:'订单管理',permission:'orders.read',group:'transactions',icon:'i-lucide-receipt-text',applicationKey:'example',afterSales:true};
 const p=await page(t,'components/tenant/TenantConsoleShell.vue',{tenantId:'fixture',permissions:['example:orders.read'],consoleRoutes:[route],path:'/admin/orders'});
 const items=p.menuGroups.value.find(group=>group.key==='transactions').items;
 assert.equal(items.filter(item=>item.label==='订单管理').length,1);assert.ok(!items.some(item=>item.to==='/admin/after-sales'));assert.equal(items.find(item=>item.to==='/admin/orders').active,true);
});


// Execute the real local page script with deferred requests, without a network or user credentials.
async function page(t,path,options={}){
  const file=await readFile(new URL('../app/'+path,import.meta.url),'utf8'),script=file.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replaceAll('import.meta.dev','true').replaceAll('import.meta.client','true').replaceAll('import.meta.server','false'),requests=[],stops=[],routeGuards=[],routeUpdateGuards=[];
  const session=vue.ref({id:'fixture',role:'root',permissions:['materials.read','materials.write','cache.read','cache.clear','tasks.read','tasks.write','backups.read','backups.create','backups.download','backups.delete','backups.restore','roles.read','roles.write','accounts.read','accounts.write','tenants.read','audit.read','settings.read','services.read','overview.read'],nickname:'原昵称',avatar:null,profileVersion:1});
  const routeState=vue.reactive({query:options.query||{},path:options.path||'/admin',params:{id:'new',...options.params}});
  let restores=0;const cookies=options.cookies||{};
  const request=(name,options={})=>new Promise((resolve,reject)=>requests.push({name,resolve,reject,signal:options.signal,body:options.body,method:options.method}));
  const auth={session,api:(url,method,body,options)=>request(url,{...options,body,method}),restore:()=>++restores===1?Promise.resolve(session.value):request('restore'),login:()=>request('login'),demoLogin:()=>request('demo'),logout:()=>request('logout')};
  const recoveryStorage=options.storage||new Map();
  const env={navigator:{clipboard:{writeText:value=>request('clipboard:'+value)}},sessionStorage:{getItem:k=>recoveryStorage.get(k)||null,setItem:(k,v)=>recoveryStorage.set(k,v),removeItem:k=>recoveryStorage.delete(k)},require:path=>path.includes('async-component')?{defineConsoleAsyncComponent:()=>({})}:path.includes('customer-service')?customerService:path.includes('consumer-auth-appearance')?authAppearance:path.includes('tenant-entry')?tenantEntry:path.includes('task-schedule')?scheduleHelpers:path.includes('application-navigation')?applicationNavigation:path.includes('console-navigation')?navigation:path.includes('/config/console')?{platformConsole}:({platformLanding:()=>'/admin'}),exports:{},useRequestURL:()=>new URL(options.requestUrl||'http://localhost:3400/admin/payments/wechat-virtual'),useState:(_key,init)=>vue.ref(init()),useCookie:key=>cookies[key]||(cookies[key]=vue.ref(null)),toRaw:vue.toRaw,ref:vue.ref,reactive:vue.reactive,computed:vue.computed,watch:(...args)=>{const stop=vue.watch(...args);stops.push(stop);return stop},onBeforeRouteLeave:fn=>routeGuards.push(fn),onBeforeUnmount:fn=>stops.push(fn),onMounted:fn=>{if(options.mounted)fn()},onActivated:()=>{},onDeactivated:()=>{},useRuntimeConfig:()=>({public:{apiBase:'/api/v1'}}),useApi:()=>auth,useToast:()=>({add:()=>{}}),useSiteBranding:()=>({site:vue.ref({platform:{name:'测试平台'},tenant:{name:'测试租户'}}),tenantBrand:vue.ref(null)}),useRoute:()=>routeState,definePageMeta:()=>{},defineProps:()=>({portal:'admin',...options.props}),withDefaults:(value,defaults)=>({...defaults,...value}),defineModel:(name,options)=>vue.ref(typeof options?.default==='function'?options.default():options?.default??[]),defineEmits:()=>()=>{},defineExpose:()=>{},useId:()=>'fixture',useAsyncData:()=>({data:vue.ref(path.includes('scheduled-tasks/[id]')?{task:null,commands:[]}:{items:[],total:0,catalog:[],actions:[],commands:[],count:0,canClear:true,groups:[],canManage:true,canUpload:true,policy:{revisionId:'test',maxFileMb:20,label:'local'}}),error:vue.ref(null)}),navigateTo:async (target,navigationOptions)=>{options.navigations?.push(target);options.navigationOptions?.push(navigationOptions);if(options.deferNavigation)await request('navigate:'+target)},createError:x=>Error(x.statusMessage),window:{addEventListener(){},removeEventListener(){}},document:{addEventListener(){},removeEventListener(){},visibilityState:'visible',createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}}};
  env.useDiscardChanges=blocked=>{const dialog=createDiscardChanges(blocked);stops.push(dialog.dispose);return dialog};
  env.useTenantContext=()=>options.tenantContext||({refresh:signal=>request('tenant-context-refresh',{signal}),current:vue.ref({accountId:session.value.id,site:{id:options.tenantId||'',consoleRoutes:options.consoleRoutes||[]}}),tenantId:vue.computed(()=>options.tenantId||routeState.params.tenantId||''),recent:cookies.qicore_last_tenant_site||(cookies.qicore_last_tenant_site=vue.ref(null)),choose:site=>{cookies.qicore_last_tenant_site.value={accountId:session.value.id,tenantId:site.id}}});
  env.usePageLeaveGuard=guard=>{routeGuards.push(guard);routeUpdateGuards.push(guard)};
  env.useUnsavedBeforeUnload=()=>{};
  const navigationTarget=vue.ref(null);env.useConsoleNavigation=()=>({target:navigationTarget,path:vue.computed(()=>navigationTarget.value?.path||routeState.path)});
  const menuExpansion={};new Function(...Object.keys(env),menuExpansionCode)(...Object.values({...env,require:()=>navigation,exports:menuExpansion}));env.useConsoleMenuExpansion=menuExpansion.useConsoleMenuExpansion;
  env.useRouteTab=(fallback,values)=>vue.computed({get:()=>(typeof values==='function'?values():values).includes(routeState.query.tab)?routeState.query.tab:fallback,set:value=>routeState.query={...routeState.query,tab:value}});
  if(options.asyncData)env.useAsyncData=options.asyncData;
  if(options.permissions)session.value.permissions=options.permissions;
  if(options.model)env.defineModel=()=>vue.ref(options.model);
  if(options.window)Object.assign(env.window,options.window);
  const code=ts.transpileModule(script,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const keys=['methods','needsSync','unifyWechat','current','dialogOpen','dialogAction','taskError','recovering','recoveryError','initialized','recover','refreshTask','runningAction','projects','uploadPrivateKey','refreshEntry','checkingLicense','checkLicense','enterTenant','entering','accountItems','enabled','tab','inspectOperation','checkOperation','executeOperation','operationPreview','operationError','operationChecking','operationExecuting','needsDiscard','hasDefaultMessages','callbackUrl','callbackLocal','open','keyFields','changeSubject','virtualTab','selectVirtualTab','goodsPanel','ordersPanel','refreshPage','generateMessageKey','copyMessageKey','copyingMessage','requestLeave','channel','state','detailAction','move','saving','custom','customBaseline','selectAsset','records','reading','loadRecords','saveCustom','persist','makePreview','previewInfo','previewLoading','previewAction','read','appAction','checkApplication','updateApplication','purchaseGrowthPerYuan','enabledConditions','targetId','deleteOpen','beforeUnload','applicationOptions','applicationBusy','applicationError','applicationLoadSource','loadApplications','userBusy','saving','frameworkOpen','historyOpen','repairOpen','repairTarget','inspectRepair','unavailableReason','filteredApplications','visibleApplications','beginUpdate','executing','resuming','resumeCloseout','applicationOpen','selectedApplication','inspectApplication','copy','copying','checkDomain','checking','domainResult','editCategory','saveCategory','categoryOpen','editorOpen','roleBusy','roleSearch','lookupRoles','guard','readonly','select','breadcrumbs','editor','openRules','saveRules','registrationGrowth','ruleError','rulesOpen','levelFilter','tagFilter','memberTarget','draft','mediaBusy','editorHtml','showPreview','previewHtml','publish','showHistory','showDraft','kind','refundAmount','refundAttempt','refundInfo','refundLookup','reason','actionError','closeAction','autoSelect','selectionAttempt','edit','close','logChannel','changeLogChannel','discard','closeNotification','closeSettings','openSettings','editOpen','openNotification','notificationForm','notificationSaving','notificationDirty','notificationError','saveNotification','cancelNotification','logs','logAction','loadLogs','logsError','checkResult','checkError','resetForm','sending','testPhone','testPurpose','sendTest','testResult','attempt','accessKeyId','secret','value','previewSrc','clear','branding','uploads','editForm','editError','useOriginal','saveEditor','askUpload','askPublish','start','query','confirmAction','uploadCount','publishCount','taskActive','blocked','refundOpen','refundBusy','refundReason','refundError','refundOrder','askRefund','submitRefund','catalog','catalogBusy','history','historyBusy','submitBusy','rowBusy','refreshRow','pending','appSecret','clearSecret','mismatch','secrets','provider','selectProvider','result','from','to','filterError','usagePage','setUsagePage','closeDetail','toggle','changeType','fields','imageBusy','editOpen','mutation','askDelete','deleteUsers','deleteError','chooseApplication','applicationKey','hasUsers','usersPage','prepareCleanup','cleanup','cleanupPreview','cleanupOpen','cleanupResult','cleanupError','showWork','previewTarget','src','loading','detail','detailBusy','detailSource','detailError','readDetail','openDetail','previewBusy','previewError','imageOpen','imageSrc','changeProtocol','changeModel','qualities','customAllowed','sizes','qualityChoice','backgroundChoice','checkAction','submit','latest','apiKey','clearKey','sizeChoice','width','height','changeSize','confirmOpen','testError','cancel','setFormat','addBackground','removeBackground','dirty','locked','retentionDays','uploadMb','askBatchDelete','deleteIds','deleteSource','q','openEditor','formVersion','confirmDelete','deleteVersion','modal','editing','sizeError','refreshing','selectScope','scopeError','money','percent','recent','returnLabel','switching','openSelector','previous','visibleTenants','search','navigating','leave','leaving','leaveError','viewScale','angle','pan','zoom','rotate','resetView','closeView','closeAutoFocus','contentMounted','afterLeave','openGroups','menuGroups','toggleGroup','revealActiveGroup','selectRow','selectAll','selectKind','selectGroup','setPage','setPageSize','upload','selected','kind','group','deleteRows','deleteFolder','dialog','dialogError','target','saveName','move','moveOpen','open','clearCache','confirm','ask','confirmOpen','preview','previewBusy','previewSource','previewError','times','form','formError','ready','commands','requestId','load','filter','reset','busy','loadAction','busyAction','action','active','check','data','checkErrors','checkMotion','page','rows','error','nickname','save','refresh','submit','demoLogin','logout','username','password','exportLogs','exporting','verify','download','askCreate','create','askDelete','remove','selected','deleteOpen','deleteError','askRestore','restoreDatabase','restorePlan','restoreConfirm','restoreStatus','pollRestore','listBusy','listAction'];
  const model=await new (Object.getPrototypeOf(async function(){}).constructor)(...Object.keys(env),code+'\nreturn {'+keys.map(k=>`${k}:typeof ${k}==='undefined'?undefined:${k}`).join(',')+'}')( ...Object.values(env));
  t.after(()=>{for(const stop of stops)stop()});return{...model,requests,routeState,canLeave:(to={fullPath:'/after'})=>routeGuards.map(guard=>guard(to)),canUpdate:()=>routeUpdateGuards.map(guard=>guard()),unmount:()=>stops.forEach(stop=>stop()),sessionRef:session,template:file.split('</script>')[1]};
}


test('shared discard controller keeps drafts until confirmation, respects busy state and cancels pending actions on unmount',()=>{
 const busy=vue.ref(false),dialog=createDiscardChanges(()=>busy.value);let discarded=0;dialog.request(()=>discarded++);assert.equal(dialog.open.value,true);dialog.request(()=>discarded+=10);dialog.keep();assert.equal(discarded,0);assert.equal(dialog.open.value,false);
 dialog.request(()=>discarded++);busy.value=true;dialog.confirm();assert.equal(discarded,0);assert.equal(dialog.open.value,true);busy.value=false;dialog.confirm();dialog.confirm();assert.equal(discarded,1);
 dialog.request(()=>discarded++);dialog.dispose();dialog.confirm();assert.equal(discarded,1);busy.value=true;dialog.request(()=>discarded++);assert.equal(dialog.open.value,false);
});

for(const name of ['tenants','saas-users','roles','administrators','system-logs'])test(`${name}: reset from a later page makes one request; stale success and failure do not cross action states`,async t=>{
  const p=await page(t,'pages/admin/'+name+'.vue');p.page.value=3;p.filter('reset');await vue.nextTick();assert.equal(p.page.value,1);assert.equal(p.requests.length,1);assert.equal(p.loadAction.value,'reset');assert.equal(p.busy.value,true);
  p.filter('search');assert.equal(p.requests.length,2);assert.equal(p.loadAction.value,'search');
  p.requests[0].resolve({items:[{id:'stale'}],total:1});await setImmediate();assert.equal(p.busy.value,true);assert.equal(p.rows.value.items.length,0);
  p.requests[1].reject(Error('simulated failure'));await setImmediate();assert.equal(p.busy.value,false);assert.equal(p.error.value,'simulated failure');
  const refresh=p.load('refresh');assert.equal(p.loadAction.value,'refresh');assert.equal(p.busy.value,true);p.requests[2].resolve({items:[],total:0});await refresh;assert.equal(p.busy.value,false);
  const mutation=p.load('mutation');assert.equal(p.loadAction.value,'mutation');p.requests[3].resolve({items:[],total:0});await mutation;
  assert.doesNotMatch(p.template,/:loading="busy"|:refreshing="busy"/);assert.match(p.template,/loadAction==='search'/);assert.match(p.template,/loadAction==='reset'/);assert.match(p.template,/loadAction==='refresh'/);
});


for(const kind of ['authorization','updates','refresh','execute','resume'])test(`framework ${kind} interrupts background reads without losing the click or accepting stale data`,async t=>{
 const state={canCheck:true,license:{label:'授权正常',lastCheckFailed:false},update:{state:'available',label:'发现新版本',latestVersion:'0.2.0'},installer:{canInstall:true},tasks:kind==='execute'?[]:[{id:'task',status:'recovery_required'}]};
 const p=await page(t,'pages/admin/updates.vue',{permissions:['services.read','services.update'],asyncData:async()=>({data:vue.ref(state),error:vue.ref(null)})});
 const background=p.load(true);assert.equal(p.action.value,null);assert.equal(p.requests.length,1);
 const work=kind==='refresh'?p.load():kind==='execute'?p.beginUpdate():kind==='resume'?p.resumeCloseout():p.check(kind);
 assert.equal(p.requests[0].signal.aborted,true);assert.equal(p.requests.length,2);
 assert.equal(p.action.value,kind==='execute'||kind==='resume'?null:kind);
 const fresh={...state,productName:'fresh'};
 p.requests[1].resolve(kind==='refresh'?fresh:{});await setImmediate();
 if(kind!=='refresh'){assert.equal(p.requests.length,3);p.requests[2].resolve(fresh)}await work;
 p.requests[0].resolve({...state,productName:'stale'});await background;
 assert.equal(p.data.value.productName,'fresh');assert.equal(p.action.value,null);assert.equal(p.executing.value,false);assert.equal(p.resuming.value,false);assert.equal(p.error.value,'');
});

test('framework action reopens an unfinished task without duplicating its request or interrupting a background read',async t=>{
 for(const status of ['running','recovery_required']){
  const state={packageKey:'frm_qa',installer:{canInstall:true},tasks:[{id:'task',packageKey:'frm_qa',status}]};
  const p=await page(t,'pages/admin/updates.vue',{permissions:['services.read','services.update'],asyncData:async()=>({data:vue.ref(state),error:vue.ref(null)})});
  const background=p.load(true);await p.beginUpdate();assert.equal(p.requests.length,1);assert.equal(p.requests[0].signal.aborted,false);assert.equal(p.executing.value,false);p.requests[0].resolve(state);await background;
 }
});

test('compact application cards paginate, filter, switches groups and exposes repair without granting writes',async t=>{
 const installed=Array.from({length:26},(_,i)=>({name:'应用 '+String(i+1).padStart(2,'0'),packageKey:'app_'+i,key:'key-'+i,management:{available:false,reason:'独立修复尚未接通。'}}));
 const state={applications:{installed,purchased:[{...installed[0],packageKey:'app_bought',name:'待安装应用'}]},update:{state:'not_configured'},installer:{canInstall:false}};
 const p=await page(t,'pages/admin/updates.vue',{permissions:['services.read'],asyncData:async()=>({data:vue.ref(state),error:vue.ref(null)})});
 assert.equal(p.visibleApplications.value.length,8);p.page.value=4;assert.equal(p.visibleApplications.value.length,2);
 p.q.value='应用 02';p.filter();assert.equal(p.page.value,1);assert.equal(p.visibleApplications.value.length,1);assert.equal(p.visibleApplications.value[0].packageKey,'app_1');
 p.filter(true);assert.equal(p.filteredApplications.value.length,26);p.setPageSize(16);assert.equal(p.visibleApplications.value.length,16);
 p.selectGroup('purchased');assert.equal(p.page.value,1);assert.equal(p.visibleApplications.value[0].name,'待安装应用');
 p.selectGroup('installed');p.page.value=2;p.data.value.applications.installed=installed.slice(0,2);await vue.nextTick();assert.equal(p.page.value,1);
 p.inspectRepair(installed[0]);assert.equal(p.repairOpen.value,true);assert.equal(p.repairTarget.value.packageKey,'app_0');assert.match(p.unavailableReason(installed[0]),/没有应用管理权限/);
 p.repairOpen.value=false;assert.equal(p.requests.length,0);assert.equal(p.action.value,null);
 assert.match(p.template,/@click="inspectRepair\(app\)"/);assert.match(p.template,/@click="historyOpen=true"/);const cards=p.template.match(/<ul v-if="visibleApplications.length"[\s\S]*?<\/ul>/)?.[0];assert.ok(cards);assert.doesNotMatch(cards,/<details/);
});


test('tenant material context binds requests and cancels the old scope on unmount',async t=>{
 const p=await page(t,'components/console/MaterialBrowser.vue',{props:{portal:'tenant',endpoint:'/admin/tenants/alpha/materials/shared'}});
 const first=p.load('refresh'),retry=p.load('retry');assert.match(p.requests[0].name,/^\/admin\/tenants\/alpha\/materials\/shared\?/);assert.equal(p.requests[0].signal.aborted,true);p.requests[0].resolve({items:[{id:'stale'}],groups:[],total:1});await first;assert.equal(p.loadAction.value,'retry');
 p.requests[1].reject(Error('failed'));await retry;assert.equal(p.busy.value,false);
 const pending=p.load('refresh');p.unmount();assert.equal(p.requests[2].signal.aborted,true);p.requests[2].resolve({items:[{id:'old-scope'}],groups:[],total:1});await pending;assert.equal(p.data.value.items.length,0);
});

test('tenant material scope navigation owns its loading state on failure, cancellation and success',async t=>{
 const p=await page(t,'pages/tenant/materials.vue',{path:'/admin/materials',params:{tenantId:'alpha'},query:{scope:'shared'},deferNavigation:true});
 const first=p.selectScope('id-photo');assert.equal(p.switching.value,true);assert.equal(p.refreshing.value,false);await p.selectScope('other');assert.equal(p.requests.length,1);p.requests[0].reject(Error('failed'));await first;assert.equal(p.switching.value,false);assert.equal(p.scopeError.value,'failed');
 const next=p.selectScope('id-photo');p.requests[1].resolve(false);await next;assert.equal(p.switching.value,false);
 const done=p.selectScope('id-photo');p.requests[2].resolve();await done;assert.equal(p.scopeError.value,'');assert.equal(p.switching.value,false);
});


const templateListing=()=>({items:[{id:'one',name:'一寸',width:25,height:35,unit:'mm',widthPx:295,heightPx:413,source:'示例来源',verifiedAt:'未核验'}],total:3,templateCount:3,page:1,version:3,canWrite:true,limits:{dpi:300,minPixels:64,maxPixels:2000}});

const productionView=()=>({version:3,settings:{autoCleanupWorks:false,retentionHours:24,dpi:300,minPixels:64,maxPixels:2000,maxUploadBytes:10485760,jpgQuality:90,dailyGenerateLimit:30,maxGenerateAttempts:3,formats:['jpg','png'],backgrounds:[{name:'白底',value:'#ffffff'}]},canWrite:true,developmentOnly:true,templateCount:3,limits:{maxRetentionHours:8760,maxDpi:1200,maxPixels:4000,maxUploadBytes:20971520}});


for(const recordKind of ['entitlements','entitlement-ledger','points-ledger','transactions'])test(`${recordKind}: delayed actions, date reset, detail retry/cancellation and application switches stay independent`,async t=>{
 const listing={items:[],total:0,page:1,pageSize:20,applicationKey:'id-photo',applications:[{key:'id-photo',name:'证件照'}],catalog:{types:[],statuses:[]}},p=await page(t,'components/tenant/TenantRecords.vue',{props:{recordKind},tenantId:'alpha',asyncData:async()=>({data:vue.ref(listing),error:vue.ref(null)})});
 assert.equal(p.money('2147483647','CNY'),'¥21,474,836.47');p.from.value='2026-10-12';p.to.value='2026-10-11';p.filter('search');assert.equal(p.requests.length,0);assert.ok(p.filterError.value);
 p.provider.value='wechat-virtual';p.page.value=4;p.filter('reset');assert.equal(p.requests.length,1);assert.equal(p.page.value,1);assert.equal(p.provider.value,'all');assert.equal(new URL(p.requests[0].name,'http://local').searchParams.has('provider'),false);assert.equal(p.from.value,'');assert.equal(p.to.value,'');assert.equal(p.loadAction.value,'reset');
 p.provider.value='wechat-virtual';p.filter('search');assert.equal(new URL(p.requests[1].name,'http://local').searchParams.get('provider'),recordKind==='transactions'?'wechat-virtual':null);assert.equal(p.requests[0].signal.aborted,true);p.requests[0].resolve({...listing,items:[{id:'stale'}]});await setImmediate();assert.equal(p.busy.value,true);p.requests[1].reject(Error('offline'));await setImmediate();assert.equal(p.busy.value,false);assert.equal(p.error.value,'offline');
 p.openDetail({id:'entry'});assert.equal(p.detailSource.value,'row');p.requests[2].reject(Error('detail failed'));await setImmediate();assert.equal(p.detailBusy.value,false);assert.equal(p.busy.value,false);
 const retry=p.readDetail('retry');p.requests[3].resolve({id:'entry',usage:{items:[],total:23,page:1,pageSize:10}});await retry;assert.equal(p.detail.value.id,'entry');p.setUsagePage(2);assert.equal(p.requests[4].name.endsWith('?page=2&pageSize=10'),true);assert.equal(p.detailSource.value,'page');assert.equal(p.busy.value,false);
 p.closeDetail();p.requests[4].resolve({id:'entry',usage:{items:[],total:23,page:2,pageSize:10}});await setImmediate();assert.equal(p.detail.value,null);assert.equal(p.detailBusy.value,false);
 p.openDetail({id:'old-app'});p.chooseApplication('second-app');assert.equal(p.requests[5].signal.aborted,true);p.requests[5].resolve({id:'stale-detail'});p.requests[6].resolve({...listing,applicationKey:'second-app'});await setImmediate();assert.equal(p.detail.value,null);assert.equal(p.rows.value.applicationKey,'second-app');
 const refresh=p.load('refresh');p.unmount();assert.equal(p.requests[7].signal.aborted,true);p.requests[7].resolve({...listing,items:[{id:'unmounted'}]});await refresh;assert.equal(p.rows.value.items.length,0);assert.equal(p.busy.value,false);
 assert.match(p.template,/:loading="busy&&loadAction==='search'"/);assert.match(p.template,/:loading="busy&&loadAction==='reset'"/);assert.match(p.template,/:loading="detailBusy&&detailSource==='row'&&target\?\.id===row.original.id"/);
});


for(const name of ['roles','administrators'])test('tenant '+name+': delayed, failed and superseded queries; save reload and discard own their states',async t=>{
 const listing={items:[],total:0,canWrite:true,catalog:[{key:'tenant:settings.read',label:'查看',group:'站点',grantable:true},{key:'tenant:settings.write',label:'修改',group:'站点',grantable:true}]};
 const p=await page(t,'pages/tenant/'+name+'.vue',{tenantId:'alpha',permissions:['tenant:roles.read','tenant:accounts.read'],asyncData:async()=>({data:vue.ref(listing),error:vue.ref(null)})});
 p.page.value=4;p.q.value='pending';p.filter('search');assert.equal(p.requests.length,1);assert.equal(p.loadAction.value,'search');assert.match(p.requests[0].name,/page=1/);
 p.filter('reset');assert.equal(p.requests.length,2);assert.equal(p.requests[0].signal.aborted,true);assert.equal(p.loadAction.value,'reset');p.requests[0].resolve({...listing,total:99});await setImmediate();assert.equal(p.rows.value.total,0);assert.equal(p.loadAction.value,'reset');
 p.requests[1].reject(Error('查询失败'));await setImmediate();assert.equal(p.loadAction.value,'');assert.equal(p.error.value,'查询失败');
 const refresh=p.load('refresh');assert.equal(p.loadAction.value,'refresh');p.requests[2].resolve(listing);await refresh;assert.equal(p.error.value,'');
 if(name==='roles'){p.open(null);p.form.name='运营';p.select(listing.catalog.slice(1),true);assert.deepEqual(p.form.permissions,['tenant:settings.read','tenant:settings.write'])}
 else {p.open('create');assert.equal(p.roleBusy.value,true);assert.equal(p.loadAction.value,'');p.requests.at(-1).resolve({items:[{id:'role',name:'运营',assignable:true}],total:1});await setImmediate();Object.assign(p.form,{username:'staff001',nickname:'运营',roleId:'role',password:'password-example',confirmPassword:'password-example'})}
 p.guard(()=>p.editorOpen.value=false);assert.equal(p.discard.open.value,true);p.discard.keep();assert.equal(p.editorOpen.value,true);
 const failed=p.save();assert.equal(p.mutation.value,'save');assert.equal(p.loadAction.value,'');p.requests.at(-1).reject(Error('保存失败'));await failed;assert.equal(p.formError.value,'保存失败');assert.equal(p.mutation.value,'');assert.equal(p.editorOpen.value,true);
 const saved=p.save();p.requests.at(-1).resolve({});await setImmediate();assert.equal(p.editorOpen.value,false);assert.equal(p.loadAction.value,'mutation');assert.equal(p.mutation.value,'save');p.requests.at(-1).resolve(listing);await saved;assert.equal(p.loadAction.value,'');assert.equal(p.mutation.value,'');
 const late=p.load('refresh');const pending=p.requests.at(-1);p.unmount();assert.equal(pending.signal.aborted,true);pending.resolve({...listing,total:99});await late;assert.equal(p.rows.value.total,0);
});



test('native app checks and updates isolate delayed states, keep retry identity, reload quietly and ignore unmount',async t=>{
 const app={packageKey:'app_fixture',name:'Fixture',update:{canCheck:true,latestVersion:'1.1.0',manifestSha256:'a'.repeat(64)},management:{available:true}};
 const state={packageKey:'frm_fixture',license:{label:'正常'},update:{state:'available',latestVersion:'2.0.0',manifestSha256:'b'.repeat(64)},installer:{canInstall:true},applications:{installed:[app]},tasks:[]};
 const p=await page(t,'pages/admin/updates.vue',{permissions:['services.read','services.update'],asyncData:async()=>({data:vue.ref(state),error:vue.ref(null)})});
 const check=p.checkApplication(app);assert.deepEqual(p.appAction.value,{key:'app_fixture',kind:'check'});assert.equal(p.action.value,null);assert.equal(p.executing.value,false);
 await p.beginUpdate();await p.load();await p.checkApplication(app);assert.equal(p.requests.length,1);
 p.requests[0].reject(Error('unavailable'));await check;assert.equal(p.appAction.value,null);
 const update=p.updateApplication(app);assert.equal(p.requests[1].body.packageKey,'app_fixture');const body=p.requests[1].body;
 assert.equal(p.executing.value,false);assert.equal(p.action.value,null);p.requests[1].reject(Error('unknown'));await update;
 const retry=p.updateApplication(app);assert.deepEqual(p.requests[2].body,body);p.requests[2].resolve({});await setImmediate();assert.equal(p.appAction.value.kind,'execute');assert.equal(p.action.value,null);p.requests[3].resolve(state);await retry;assert.equal(p.appAction.value,null);
 const final=p.checkApplication(app);p.unmount();p.requests[4].resolve({});await final;assert.equal(p.requests.length,5);assert.equal(p.appAction.value,null);
 assert.ok(p.template.includes("appAction.kind==='check'?'检查中…':'更新中…'"));
 assert.ok(p.template.includes("app.update.state==='available'?'更新':'检查更新'"));
});



test('client access links own delayed copy state across overlap, failure and disposal',async t=>{
 const first=await page(t,'components/console/ConsoleAccessLink.vue',{props:{url:'http://localhost/h5/site/'}}),second=await page(t,'components/console/ConsoleAccessLink.vue',{props:{url:'http://localhost/h5/other/'}});
 const copy=first.copy();assert.equal(first.copying.value,true);assert.equal(second.copying.value,false);await first.copy();assert.equal(first.requests.length,1);first.requests[0].reject(Error('clipboard unavailable'));await copy;assert.equal(first.copying.value,false);
 const retry=first.copy();first.requests[1].resolve();await retry;assert.equal(first.copying.value,false);
 const late=first.copy();first.unmount();first.requests[2].resolve();await late;assert.equal(second.copying.value,false);
});

test('application lifecycle preview cancellation, delayed actions and uncertain submissions keep independent state and identity',async t=>{
 const app={packageKey:'app_fixture',name:'Fixture',management:{canInstall:true,canRepair:true,canUninstall:true,reason:''}},state={tasks:[],applications:{purchased:[app],installed:[]}},plan={targetVersion:'1.0.0',manifestSha256:'a'.repeat(64),pending:0,tenants:0,integrity:[]};
 const p=await page(t,'pages/admin/updates.vue',{permissions:['services.read','services.update'],asyncData:async()=>({data:vue.ref(state),error:vue.ref(null)})});
 const cancelled=p.inspectOperation(app,'install');assert.equal(p.operationChecking.value,'initial');assert.equal(p.action.value,null);assert.equal(p.operationExecuting.value,false);p.repairOpen.value=false;await vue.nextTick();assert.equal(p.requests[0].signal.aborted,true);p.requests[0].resolve(plan);await cancelled;assert.equal(p.operationPreview.value,null);
 const open=p.inspectOperation(app,'install');p.requests[1].resolve(plan);await open;assert.equal(p.operationChecking.value,null);
 const execute=p.executeOperation();const first=p.requests[2].body;assert.equal(p.operationExecuting.value,true);assert.equal(p.executing.value,false);await p.executeOperation();assert.equal(p.requests.length,3);p.requests[2].reject(Error('unknown result'));await execute;assert.equal(p.operationExecuting.value,false);
 const recheck=p.checkOperation('refresh');assert.equal(p.operationChecking.value,'refresh');assert.equal(p.action.value,null);p.requests[3].resolve(plan);await recheck;
 const retry=p.executeOperation();assert.deepEqual(p.requests[4].body,first);p.requests[4].resolve({accepted:true});await setImmediate();assert.equal(p.action.value,null);assert.equal(p.operationExecuting.value,true);p.requests[5].resolve(state);await retry;assert.equal(p.repairOpen.value,false);assert.equal(p.appAction.value,null);
 const late=p.inspectOperation(app,'repair');p.unmount();assert.equal(p.requests[6].signal.aborted,true);p.requests[6].resolve(plan);await late;assert.equal(p.operationChecking.value,null);
});

test('mini ad settings keep save, refresh and retry loading independent and protect unsaved edits',async t=>{
 const view={applicationKey:'id-photo',appId:'wx1234567890abcdef',boundAppId:'',appIdChanged:false,version:0,config:{homeBanner:'',profileBanner:'',homeInterstitial:'',rewarded:''},canWrite:true,updatedAt:null,rewarded:{available:false,message:'待验证'}};
 const p=await page(t,'components/tenant/TenantMiniAds.vue',{props:{endpoint:'/admin/tenants/alpha/mini-program/id-photo/ads'},asyncData:async()=>({data:vue.ref(structuredClone(view)),error:vue.ref(null)})});
 p.form.value.homeBanner='adunit-1234567890abcdef';const first=p.save();assert.equal(p.busy.value,'save');assert.equal(p.refreshing.value,false);await p.refresh();assert.equal(p.requests.length,1);let left=false;p.requestLeave(()=>left=true);assert.equal(left,false);assert.equal(p.discard.open.value,false);
 p.requests[0].reject(Error('保存失败'));await first;assert.equal(p.busy.value,null);assert.equal(p.dirty.value,true);assert.equal(p.form.value.homeBanner,'adunit-1234567890abcdef');
 const retry=p.save();assert.equal(p.requests[1].body.appId,view.appId);assert.deepEqual(Object.keys(p.requests[1].body).sort(),['appId','config','version']);p.requests[1].resolve({...view,version:1,config:{...p.form.value}});await retry;assert.equal(p.dirty.value,false);assert.equal(p.requests.length,2);
 p.form.value.profileBanner='adunit-abcdef1234567890';await p.refresh();assert.equal(p.discard.open.value,true);assert.equal(p.requests.length,2);p.discard.keep();assert.equal(p.dirty.value,true);await p.refresh();p.discard.confirm();assert.equal(p.busy.value,'refresh');assert.equal(p.refreshing.value,true);p.requests[2].reject(Error('读取失败'));await setImmediate();assert.equal(p.busy.value,null);
 const read=p.refresh('retry');assert.equal(p.busy.value,'retry');assert.equal(p.refreshing.value,false);p.unmount();assert.equal(p.requests[3].signal.aborted,true);p.requests[3].resolve({...view,version:99});await read;assert.equal(p.data.value.version,1);
});

test('mini ad settings clear old AppID placements and cannot save a read-only or missing mini identity',async t=>{
 const view={applicationKey:'id-photo',appId:'wx1234567890abcdef',boundAppId:'wxabcdef1234567890',appIdChanged:true,version:2,config:{homeBanner:'adunit-oldoldold',profileBanner:'',homeInterstitial:'',rewarded:''},canWrite:true,updatedAt:null,rewarded:{available:false,message:'待验证'}};
 const p=await page(t,'components/tenant/TenantMiniAds.vue',{props:{endpoint:'/ads'},asyncData:async()=>({data:vue.ref(view),error:vue.ref(null)})});assert.equal(p.form.value.homeBanner,'');const clear=p.save();assert.equal(p.requests[0].body.config.homeBanner,'');p.requests[0].resolve({...view,version:3,appIdChanged:false,config:{...p.form.value}});await clear;
 p.form.value.homeBanner='adunit-1234567890abcdef';p.data.value.canWrite=false;await p.save();assert.equal(p.requests.length,1);p.data.value.canWrite=true;p.data.value.appId='';assert.equal(p.locked.value,false,'missing AppID blocks saving, not selecting a mode or editing a local draft');p.form.value.mode='manual';await p.save();assert.equal(p.requests.length,1);
});

test('direct ad-tab entry falls back to a visible error or application chooser until a usable application is loaded',async t=>{
 const p=await page(t,'pages/tenant/mini-program.vue',{tenantId:'alpha',query:{tab:'ads'},asyncData:async()=>({data:vue.ref(null),error:vue.ref(Error('配置读取失败'))})});
 assert.equal(p.tab.value,'settings');assert.equal(p.error.value,'配置读取失败');p.refreshPage();assert.equal(p.busy.value,'refresh');assert.equal(p.requests.length,1);
 p.requests[0].resolve({applicationKey:'fixture',applications:[],version:1,config:{appId:'wx1234567890abcdef'},canWrite:true});await setImmediate();assert.equal(p.tab.value,'ads');assert.equal(p.busy.value,null);
 p.data.value={...p.data.value,applicationKey:null};assert.equal(p.tab.value,'settings');
});


test('customer service settings keep save, refresh and failed retries independent and preserve edits',async t=>{
 const config={users:{prefix:'HY',digits:8,start:1,defaultAvatar:null},registration:{passwordLoginEnabled:true,smsLoginEnabled:false,showPolicies:false,autoRegister:true,appearance:authAppearance.consumerAuthAppearanceDefaults()},customerService:customerService.customerServiceDefaults()},value={siteName:'测试',applicationKey:'fixture',applications:[],canWrite:true,version:1,config,nextNumber:1};
 const p=await page(t,'components/tenant/TenantConsumerSettings.vue',{tenantId:'fixture',props:{section:'customerService'},asyncData:()=>({data:vue.ref(value),error:vue.ref(null)})});
 p.form.value.customerService.wechat='support';const save=p.save();assert.equal(p.busy.value,'save');assert.match(p.requests[0].name,/customerService$/);assert.equal(p.requests[0].body.config.wechat,'support');assert.equal(p.requests[0].body.config.users,undefined);p.requests[0].reject(Error('save failed'));await save;assert.equal(p.busy.value,null);assert.equal(p.form.value.customerService.wechat,'support');
 p.cancel();const refresh=p.refresh();assert.equal(p.busy.value,'refresh');p.requests[1].resolve(value);await refresh;assert.equal(p.busy.value,null);
 const retry=p.refresh('retry');assert.equal(p.busy.value,'retry');p.unmount();p.requests[2].resolve({...value,version:99});await retry;assert.equal(p.data.value.version,1);
});

test('wallet adjustment waits for explicit activation and keeps delayed reads and writes independent',async t=>{
 const p=await page(t,'components/tenant/ConsumerWallet.vue',{props:{endpoint:'/wallet-fixture',canWrite:true}}),assets={points:{amount:20,version:1},balance:{amount:0,version:0}};
 const load=p.load();assert.equal(p.action.value,'load');assert.equal(p.reading.value,'');p.requests[0].resolve({assets,enabled:false});await load;
 Object.assign(p.form,{amount:'20',reason:'测试赠送'});await p.save();assert.equal(p.requests.length,1);assert.equal(p.enabled.value,false);
 assert.match(p.template,/本站尚未启用公共钱包/);assert.match(p.template,/v-if="canWrite&&data&&enabled"/);
 const refresh=p.load('refresh');p.requests[1].resolve({assets,enabled:true});await refresh;
 const save=p.save();assert.equal(p.action.value,'save');assert.equal(p.reading.value,'');assert.equal(p.requests[2].method,'POST');
 p.requests[2].resolve({assets:{...assets,points:{amount:40,version:2}},enabled:true});await setImmediate();assert.equal(p.action.value,'save');assert.equal(p.reading.value,'mutation');
 p.requests[3].resolve({items:[],total:0,page:1,pageSize:20});await save;assert.equal(p.action.value,'');assert.equal(p.reading.value,'');assert.equal(p.attempt.value,null);
 Object.assign(p.form,{amount:'1',reason:'失效配置'});const denied=p.save();p.requests[4].reject(Object.assign(Error('请先启用公共钱包'),{status:409}));await denied;assert.equal(p.action.value,'');assert.equal(p.attempt.value,null);assert.equal(p.error.value,'请先启用公共钱包');
 const late=p.load('retry');p.unmount();assert.equal(p.requests[5].signal.aborted,true);p.requests[5].resolve({assets,enabled:false});await late;assert.equal(p.enabled.value,true,'disposed reads cannot overwrite the last accepted context');
});

test('tenant login reserves a new tab before the request and closes only its pending blank tab on failure',async t=>{
 const tabs=[],navigations=[];let blocked=false;
 const window={location:{origin:'http://127.0.0.1:3500'},open(url,target){if(blocked)return null;const tab={closed:false,opener:{},location:{href:url,replace(value){this.href=value}},close(){this.closed=true}};tabs.push(tab);assert.equal(target,'_blank');return tab}};
 const p=await page(t,'pages/admin/tenants.vue',{window,navigations});
 const enter=p.enterTenant({id:'target'});assert.equal(tabs.length,1);assert.equal(tabs[0].opener,null);assert.equal(tabs[0].location.href,'about:blank');assert.equal(p.entering.value,'target');assert.equal(p.busy.value,false);assert.equal(p.requests.length,1);
 await p.enterTenant({id:'another'});assert.equal(tabs.length,1);p.requests[0].resolve({tenantId:'target'});await enter;
 assert.equal(tabs[0].location.href,'http://127.0.0.1:3500/tenant/applications');assert.equal(tabs[0].closed,false);assert.deepEqual(navigations,[]);assert.equal(p.entering.value,'');
 const failed=p.enterTenant({id:'target'});p.requests[1].reject(Error('代登录失败'));await failed;assert.equal(tabs[1].closed,true);assert.equal(p.error.value,'代登录失败');assert.equal(p.entering.value,'');
 blocked=true;await p.enterTenant({id:'target'});assert.equal(p.requests.length,2);assert.match(p.error.value,/拦截/);assert.equal(p.entering.value,'');blocked=false;
 const closed=p.enterTenant({id:'target'});tabs[2].close();p.requests[2].resolve({});await closed;assert.match(p.error.value,/已关闭/);
 const abandoned=p.enterTenant({id:'target'});p.unmount();assert.equal(p.requests[3].signal.aborted,true);assert.equal(tabs[3].closed,true);p.requests[3].resolve({});await abandoned;assert.equal(tabs[3].location.href,'about:blank');assert.equal(tabs[0].closed,false);
});

test('single-enterprise logout keeps its own loading state and cannot navigate to a platform session',async t=>{
 const navigations=[],navigationOptions=[],p=await page(t,'components/console/ConsoleFrame.vue',{props:{portal:'tenant'},navigations,navigationOptions});
 p.sessionRef.value={...p.sessionRef.value,role:'tenant',delegated:false};
 const exit=p.leave('header');assert.equal(p.leaving.value,'header');await p.leave('header');assert.equal(p.requests.length,1);
 p.requests[0].reject(Error('退出失败'));await exit;
 assert.equal(p.leaveError.value,'退出失败');assert.equal(p.leaving.value,null);assert.equal(p.sessionRef.value.role,'tenant');assert.deepEqual(navigations,[]);
 assert.equal(p.accountItems.value.at(-1)[0].label,'退出登录');
 const retry=p.leave('header');p.requests[1].resolve({loggedOut:true});await retry;
 assert.deepEqual(navigations,['/admin/login']);assert.deepEqual(navigationOptions,[{replace:true,external:true}]);assert.equal(p.sessionRef.value,null);assert.equal(p.leaving.value,null);
 assert.doesNotMatch(p.template,/退出代登录|返回平台/);
});

test('default workbench refresh, retry and cancellation have independent action state',async t=>{
 const navigations=[],p=await page(t,'pages/tenant/workbench.vue',{navigations});
 const first=p.refresh('refresh');assert.equal(p.loadAction.value,'refresh');await p.refresh('retry');assert.equal(p.requests.length,1);p.requests[0].reject(Error('读取失败'));await first;assert.equal(p.loadAction.value,null);assert.equal(p.error.value,'读取失败');
 const retry=p.refresh('retry');assert.equal(p.loadAction.value,'retry');p.requests[1].resolve({tenant:{id:'site',consoleRoutes:[]},access:'no-applications'});await retry;assert.equal(p.loadAction.value,null);assert.equal(p.error.value,'');
 const cancelled=p.refresh();p.unmount();assert.equal(p.requests[2].signal.aborted,true);p.requests[2].resolve({tenant:{consoleRoutes:[{group:'workbench',path:'/admin/example'}]}});await cancelled;assert.deepEqual(navigations,[]);
});

test('background entry refresh cannot redirect a later navigation',async t=>{
 let resolveEntry;const site={id:'site',consoleRoutes:[{path:'/admin/example',applicationKey:'old'}]},context={current:vue.ref({accountId:'fixture',site}),tenantId:vue.ref('site'),refresh:()=>new Promise(resolve=>{resolveEntry=resolve})},navigations=[];
 const p=await page(t,'components/tenant/TenantConsoleShell.vue',{tenantContext:context,path:'/admin/example',navigations});const pending=p.refreshEntry();p.routeState.path='/admin/site';resolveEntry({tenant:{...site,consoleRoutes:[]},access:'no-applications'});await pending;assert.deepEqual(navigations,[]);
 p.routeState.path='/admin/example';const revoked=p.refreshEntry();resolveEntry({tenant:{...site,consoleRoutes:[]},access:'no-applications'});await revoked;assert.deepEqual(navigations,['/admin/workbench']);
});

test('workbench license and update checks keep permanent icons and independent overlapping state',async t=>{
 const p=await page(t,'pages/admin/index.vue');
 const system={allowed:true,canCheck:true,license:{state:'active',lastCheckFailed:false},update:{currentVersion:'0.1.0',latestVersion:null}};
 p.data.value={system};
 const authorization=p.checkLicense('authorization'),updates=p.checkLicense('updates');assert.deepEqual({...p.checkingLicense},{authorization:true,updates:true});assert.equal(p.busy.value,false);
 p.requests[1].resolve({...system,update:{...system.update,latestVersion:'0.2.0'}});await setImmediate();p.requests[2].resolve({system});await updates;assert.equal(p.checkingLicense.updates,false);assert.equal(p.checkingLicense.authorization,true);assert.equal(p.data.value.system.update.latestVersion,'0.2.0');
 p.requests[0].reject(Error('授权核验失败'));await authorization;assert.equal(p.checkingLicense.authorization,false);assert.equal(p.data.value.system.update.latestVersion,'0.2.0');
 const retry=p.checkLicense('authorization');p.requests[3].resolve({...system,license:{state:'active',label:'最新授权'}});await setImmediate();p.requests[4].resolve({system});await retry;assert.equal(p.data.value.system.license.label,'最新授权');assert.equal(p.data.value.system.update.latestVersion,'0.2.0');
 assert.match(p.template,/animate-spin':checkingLicense.authorization/);assert.match(p.template,/animate-spin':checkingLicense.updates/);assert.doesNotMatch(p.template,/checkingLicense!==null/);
});

test('tenant creation leaves its ID to the server and retains request identity after an unknown response',async t=>{
 const p=await page(t,'pages/admin/tenants.vue');p.open();assert.equal(p.form.id,'');
 p.requests.find(request=>request.name.startsWith('/admin/tenant-admins?')).resolve({items:[{id:'owner',username:'owner',nickname:'Owner',enabled:true}]});
 p.requests.find(request=>request.name==='/admin/tenants/application-options').resolve({items:[{key:'fixture',name:'Fixture',selectable:true}]});await setImmediate();
 Object.assign(p.form,{name:'新租户',applicationKey:'fixture',ownerAdminId:'owner'});
 const saving=p.save(),first=p.requests.find(request=>request.method==='POST');assert.equal(first.name,'/admin/tenants');assert.equal(Object.hasOwn(first.body,'id'),false);assert.ok(first.body.requestId);
 first.reject(Error('结果未知'));await saving;const retry=p.save(),last=p.requests.at(-1);assert.deepEqual(last.body,first.body);last.reject(Error('仍待确认'));await retry;
 assert.match(p.template,/创建时自动生成 5 位随机字母数字/);assert.doesNotMatch(p.template,/自动生成，可在创建前修改/);
});

test('tenant application can be cancelled or changed with independent lookup, retry and save indicators',async t=>{
 const p=await page(t,'pages/admin/tenants.vue');
 p.open({id:'site1',name:'Site',version:4,application:{key:'old',name:'旧应用'},ownerAdminId:'owner'});
 assert.equal(p.applicationBusy.value,true);assert.equal(p.userBusy.value,true);assert.equal(p.saving.value,false);assert.equal(p.busy.value,false);
 p.requests.find(r=>r.name.startsWith('/admin/tenant-admins?')).resolve({items:[{id:'owner',nickname:'Owner',username:'owner',enabled:true}]});
 p.requests.find(r=>r.name==='/admin/tenants/application-options').reject(Error('读取失败'));await setImmediate();assert.equal(p.applicationBusy.value,false);assert.equal(p.applicationError.value,'读取失败');
 const retry=p.loadApplications('retry');assert.equal(p.applicationLoadSource.value,'retry');assert.equal(p.userBusy.value,false);assert.equal(p.saving.value,false);
 p.requests.at(-1).resolve({items:[{key:'old',name:'旧应用',selectable:false},{key:'next',name:'新应用',selectable:true}]});await retry;
 p.form.applicationKey='__none__';const cancel=p.save();assert.equal(p.saving.value,true);assert.equal(p.applicationBusy.value,false);assert.equal(p.busy.value,false);assert.equal(p.requests.at(-1).body.applicationKey,null);assert.equal(p.requests.at(-1).body.version,4);
 p.requests.at(-1).reject(Error('有待完成任务'));await cancel;assert.equal(p.saving.value,false);assert.equal(p.modal.value,true);assert.equal(p.form.applicationKey,'__none__');assert.equal(p.formError.value,'有待完成任务');
 p.form.applicationKey='next';const change=p.save();assert.equal(p.requests.at(-1).body.applicationKey,'next');p.requests.at(-1).resolve({});await setImmediate();assert.equal(p.loadAction.value,'mutation');assert.equal(p.saving.value,true);assert.equal(p.busy.value,true);p.requests.at(-1).resolve({items:[],total:0});await change;assert.equal(p.saving.value,false);assert.equal(p.busy.value,false);
 assert.doesNotMatch(p.template,/已绑定应用不能直接更换/);assert.match(p.template,/可以取消或更换/);
});

test('both admin login forms prevent pre-hydration submits and preserve independent login/logout loading',async t=>{
 for(const portal of ['admin','tenant']){
  const p=await page(t,'components/console/AdminLogin.vue',{props:{portal}});assert.equal(p.ready.value,false);
  p.username.value='fixture';p.password.value='test-only';await p.submit();await p.logout();assert.equal(p.requests.length,0);assert.equal(p.busy.value,false);
  assert.match(p.template,/<form method="post"/);assert.equal((p.template.match(/:disabled="busy\|\|!ready"/g)||[]).length,3);assert.equal((p.template.match(/:disabled="!ready" :readonly="busy"/g)||[]).length,2);
  p.ready.value=true;const login=p.submit();assert.equal(p.busy.value,true);assert.equal(p.busyAction.value,'login');await p.logout();assert.equal(p.requests.length,1);p.requests[0].reject(Error('登录失败'));await login;assert.equal(p.busy.value,false);assert.equal(p.error.value,'登录失败');
  const retry=p.submit();assert.equal(p.error.value,'登录失败','retry keeps the existing error until the response arrives');p.requests[1].resolve({});await retry;assert.equal(p.password.value,'');assert.equal(p.error.value,'');assert.equal(p.busy.value,false);
  const logout=p.logout();assert.equal(p.busyAction.value,'logout');p.requests[2].resolve({});await logout;assert.equal(p.busy.value,false);
 }
});

const miniProject={projectId:'project',templateId:'template',version:'0.1.2',name:'测试应用',artifactSha256:'a'.repeat(64)};
const miniProps={endpoint:'/mini-fixture',settingsVersion:3,canWrite:true,dirty:false,ready:true};
async function miniPage(t){
 const p=await page(t,'components/tenant/TenantMiniProgramUpload.vue',{props:miniProps});
 const recovery=p.recover();assert.equal(p.blocked.value,true);p.requests.at(-1).resolve({items:[]});await recovery;
 const catalogue=p.catalog();assert.equal(p.catalogBusy.value,true);assert.equal(p.runningAction.value,null);p.requests.at(-1).resolve({projects:[miniProject],ready:true});await catalogue;
 return p;
}
test('mini preview opens immediately, polls into QR and isolates action loading',async t=>{
 const p=await miniPage(t),start=p.submit('preview'),request=p.requests.at(-1);
 assert.equal(p.dialogOpen.value,true);assert.equal(p.current.value,null);assert.equal(p.runningAction.value,'preview');assert.equal(p.catalogBusy.value,false);
 await p.submit('preview');await p.submit('upload_trial');assert.equal(p.requests.length,3);
 const row={...request.body,status:'RUNNING',progress:35,message:'正在处理',qrCode:null};request.resolve(row);await start;
 assert.equal(p.submitBusy.value,null);assert.equal(p.runningAction.value,'preview');assert.equal(p.pending.value,null);
 const poll=p.refreshTask();await p.refreshTask();assert.equal(p.requests.length,4);assert.equal(p.catalogBusy.value,false);
 p.requests.at(-1).reject(Error('进度暂时不可用'));await poll;assert.equal(p.runningAction.value,'preview');assert.match(p.taskError.value,/暂时/);
 const retry=p.refreshTask();p.requests.at(-1).resolve({...row,status:'SUCCEEDED',progress:100,qrCode:'data:image/png;base64,fixture'});await retry;
 assert.equal(p.current.value.qrCode,'data:image/png;base64,fixture');assert.equal(p.runningAction.value,null);assert.equal(p.taskError.value,'');assert.equal(p.dialogOpen.value,true);
 assert.doesNotMatch(p.template,/ConsoleDataTable|上传记录|批量删除|查看二维码/);
 const upload=p.submit('upload_trial');assert.equal(p.runningAction.value,'upload_trial');assert.equal(p.current.value,null);p.requests.at(-1).resolve({...row,operationId:p.requests.at(-1).body.operationId,action:'upload_trial',status:'FAILED',message:'上传失败'});await upload;
 assert.equal(p.runningAction.value,null);assert.equal(p.current.value.message,'上传失败');assert.equal(p.blocked.value,false);
});
test('mini unknown submission retries exact identity and aborts late updates after unmount',async t=>{
 const p=await miniPage(t),first=p.submit('preview'),selection=structuredClone(vue.toRaw(p.requests.at(-1).body));
 p.requests.at(-1).reject(Error('响应中断'));await first;assert.deepEqual(p.pending.value,selection);assert.equal(p.submitBusy.value,null);
 p.selected.value='another-template';const retry=p.submit('upload_trial');assert.deepEqual(p.requests.at(-1).body,selection);assert.equal(p.runningAction.value,'preview');
 p.unmount();assert.equal(p.requests.at(-1).signal.aborted,true);p.requests.at(-1).resolve({...selection,status:'SUCCEEDED',qrCode:'late'});await retry;assert.equal(p.current.value,null);
});
test('mini reload recovers the exact accepted task even if it completed while the page reloaded',async t=>{
 const stored={operationId:'accepted-task',action:'preview'},storage=new Map([['qicore:mini-upload:fixture:/mini-fixture',JSON.stringify(stored)]]);
 const p=await page(t,'components/tenant/TenantMiniProgramUpload.vue',{props:miniProps,mounted:true,storage});
 assert.equal(p.pending.value,null);assert.equal(p.blocked.value,true);
 p.requests[0].resolve({items:[{...stored,status:'SUCCEEDED',progress:100,qrCode:'saved-qr'}]});await setImmediate();
 assert.equal(p.dialogOpen.value,true);assert.equal(p.current.value.qrCode,'saved-qr');assert.equal(p.requests.length,1);assert.equal(storage.size,0);
});
test('mini failed recovery blocks new tasks until a successful retry',async t=>{
 const p=await page(t,'components/tenant/TenantMiniProgramUpload.vue',{props:miniProps});
 const first=p.recover();p.requests[0].reject(Error('读取失败'));await first;assert.equal(p.blocked.value,true);await p.submit('preview');assert.equal(p.requests.length,1);
 const retry=p.recover();p.requests[1].resolve({items:[{operationId:'running',action:'upload_trial',status:'RUNNING',progress:20}]});await retry;
 assert.equal(p.runningAction.value,'upload_trial');assert.equal(p.dialogOpen.value,true);const poll=p.refreshTask();p.unmount();assert.equal(p.requests[2].signal.aborted,true);p.requests[2].resolve({operationId:'running',action:'upload_trial',status:'SUCCEEDED'});await poll;assert.equal(p.current.value.status,'RUNNING');
});
test('mini settings preserve the saved upload key on blank submission without a clear control',async t=>{
 const view={applicationKey:'fixture',applications:[],version:3,config:{displayName:'旧名称',appId:'wx1234567890abcdef'},hasUploadPrivateKey:true,canWrite:true};
 const p=await page(t,'pages/tenant/mini-program.vue',{tenantId:'fixture',asyncData:()=>({data:vue.ref(view),error:vue.ref(null)})});
 p.form.value.displayName='新名称';const save=p.save();assert.equal(p.requests[0].body.uploadPrivateKey,'');assert.equal(Object.hasOwn(p.requests[0].body,'clearUploadPrivateKey'),false);p.requests[0].resolve({...view,version:4,config:{...p.form.value}});await save;
 assert.doesNotMatch(p.template,/清除已保存的上传密钥|clearUploadPrivateKey/);assert.match(p.template,/已保存，留空保留/);
});

test('mini recovery reads an exact older task and reports a deleted task without an empty dialog',async t=>{
 const hint={operationId:'old-task',action:'preview'},key='qicore:mini-upload:fixture:/mini-fixture';
 for(const missing of [false,true]){
  const storage=new Map([[key,JSON.stringify(hint)]]),p=await page(t,'components/tenant/TenantMiniProgramUpload.vue',{props:miniProps,mounted:true,storage});
  p.requests[0].resolve({items:Array.from({length:10},(_,i)=>({operationId:'new-'+i,status:'SUCCEEDED'}))});await setImmediate();
  assert.equal(p.requests[1].name,'/mini-fixture/upload-tasks/old-task');assert.equal(p.requests[1].method,'GET');
  if(missing)p.requests[1].reject(Object.assign(Error('不存在'),{status:404}));else p.requests[1].resolve({...hint,status:'SUCCEEDED',qrCode:'restored-qr'});
  await setImmediate();assert.equal(p.dialogOpen.value,true);assert.equal(storage.size,0);assert.equal(p.initialized.value,true);
  if(missing)assert.match(p.taskError.value,/已不存在/);else assert.equal(p.current.value.qrCode,'restored-qr');
 }
});


test('merged WeChat controls preserve old policy until save and keep failed drafts',async t=>{
 const value={applicationKey:'app',canWrite:true,version:1,updatedAt:null,config:{mini:[{provider:'wechat',enabled:false},{provider:'balance',enabled:true},{provider:'wechat-virtual',enabled:true}],official:[],h5:[]},clients:[]};
 const p=await page(t,'pages/tenant/payments.vue',{tenantId:'site',asyncData:()=>({data:vue.ref(structuredClone(value)),error:vue.ref(null)})});
 assert.deepEqual(p.methods('mini').map(row=>row.provider),['wechat-virtual','balance']);assert.equal(p.needsSync.value,true);assert.equal(p.dirty.value,false);assert.equal(p.data.value.config.mini[0].enabled,false);
 p.toggle('mini','wechat-virtual',false);assert.equal(p.form.value.mini.find(row=>row.provider==='wechat').enabled,false);assert.equal(p.form.value.mini.find(row=>row.provider==='wechat-virtual').enabled,false);
 const save=p.save();assert.equal(p.saving.value,true);assert.equal(p.busy.value,'');assert.equal(p.requests.length,1);assert.equal(p.requests[0].body.config.mini.find(row=>row.provider==='wechat-virtual').enabled,false);
 p.requests[0].reject(Error('保存失败'));await save;assert.equal(p.saving.value,false);assert.equal(p.error.value,'保存失败');assert.equal(p.dirty.value,true);assert.equal(p.form.value.mini.find(row=>row.provider==='wechat-virtual').enabled,false);
});

test('recharge image selection blocks save and saving never spins refresh',async t=>{
 const value={applicationKey:'app',canWrite:true,version:1,config:{points:[],balance:{tiers:[],customEnabled:false,minCents:1,maxCents:10000}}};
 const p=await page(t,'pages/tenant/recharge.vue',{tenantId:'site',asyncData:()=>({data:vue.ref(structuredClone(value)),error:vue.ref(null)})});p.edit();Object.assign(p.form,{name:'基础套餐',price:'1.99',points:'20',gift:'0',image:'https://assets.example/cover.webp'});
 p.imageBusy.value=true;await p.save();assert.equal(p.requests.length,0);p.imageBusy.value=false;const save=p.save();assert.equal(p.mutation.value,'save');assert.equal(p.action.value,'');assert.equal(p.requests[0].body.config.points[0].image,p.form.image);
 p.requests[0].reject(Error('暂不可用'));await save;assert.equal(p.mutation.value,'');assert.equal(p.form.image,'https://assets.example/cover.webp');assert.equal(p.editorOpen.value,true);assert.equal(p.formError.value,'暂不可用');
});

test('recharge tab and history changes keep the original draft until discard and cannot carry it into another asset',async t=>{
 const row={id:'11111111-1111-4111-8111-111111111111',name:'原积分套餐',priceCents:199,points:20,giftPoints:0,image:'https://assets.example/original.webp',sort:0,enabled:true};
 const value={applicationKey:'app',canWrite:true,version:1,config:{points:[row],balance:{tiers:[],customEnabled:false,minCents:1,maxCents:10000}}};
 const p=await page(t,'pages/tenant/recharge.vue',{tenantId:'site',asyncData:()=>({data:vue.ref(structuredClone(value)),error:vue.ref(null)})});
 p.edit(row);p.form.image='https://assets.example/draft.webp';p.custom.min='2.00';
 const keep=p.canUpdate();assert.equal(keep.length,1,'query updates must register the same page guard');assert.equal(p.discard.open.value,true);assert.equal(p.kind.value,'points');assert.equal(p.editorOpen.value,true);
 p.discard.keep();assert.equal(await keep[0],false);assert.equal(p.form.image,'https://assets.example/draft.webp');assert.equal(p.custom.min,'2.00');
 for(const field of [p.mutation,p.imageBusy]){field.value=field===p.mutation?'save':true;assert.equal(p.canUpdate()[0],false);assert.equal(p.discard.open.value,false);field.value=field===p.mutation?'':false}
 const discard=p.canUpdate()[0];p.discard.confirm();assert.equal(await discard,true);assert.equal(p.editorOpen.value,false);assert.equal(p.editing.value,null);assert.equal(p.form.image,null);assert.equal(p.form.price,'');assert.equal(p.custom.min,'0.01');assert.equal(p.dirty.value,false);
 // The router applies the accepted query/history change only after the guard resolves.
 p.routeState.query={tab:'balance'};assert.equal(p.kind.value,'balance');p.edit();Object.assign(p.form,{price:'5.00',gift:'0.00'});
 const save=p.save();assert.equal(p.requests.length,1);const saved=p.requests[0].body.config;assert.deepEqual(saved.points,[row]);assert.equal(saved.balance.tiers.length,1);assert.notEqual(saved.balance.tiers[0].id,row.id);assert.equal(saved.balance.tiers[0].image,null);
 p.requests[0].resolve({...value,version:2,config:saved});await save;
 p.routeState.query={};p.edit(row);const unchanged=p.canUpdate()[0];assert.equal(unchanged,undefined);assert.equal(p.editorOpen.value,false,'an unchanged editor also closes before its asset tab changes');
});


test('WeChat tabs keep unsaved drafts and allow resaving a changed mini-program subject',async t=>{
 const ordinary={provider:'wechat',label:'微信支付',version:1,config:{enabled:true,apiVersion:'V3',mchId:'123456',appId:'wx1234567890abcdef'},hasSecrets:{},execution:{implemented:true,enabled:false}},virtual={provider:'wechat-virtual',label:'虚拟支付',version:1,config:{enabled:true,appId:'wx1234567890abcdef',offerId:'123',subjectType:'business',env:1},hasSecrets:{},execution:{implemented:true,enabled:false}},value={applicationKey:'app',applications:[],canWrite:true,canReadVirtualOrders:true,miniProgramAppId:'wx1234567890abcdef',miniProgramSubjectType:'personal',channels:[ordinary,virtual]};
 const p=await page(t,'components/tenant/TenantPaymentSettings.vue',{tenantId:'site',props:{initialProvider:'wechat'},query:{tab:'virtual'},asyncData:()=>({data:vue.ref(structuredClone(value)),error:vue.ref(null)})});
 assert.equal(p.provider.value,'wechat-virtual');assert.equal(p.form.value.subjectType,'personal');assert.equal(p.form.value.env,0);assert.equal(p.dirty.value,true);assert.equal(p.needsDiscard.value,false);
 const save=p.save();assert.equal(p.busy.value,'save');assert.equal(p.requests[0].body.config.subjectType,'personal');assert.equal(p.requests[0].body.config.env,0);p.selectVirtualTab('ordinary');assert.equal(p.virtualTab.value,'virtual');
 const updated=structuredClone(value);updated.channels[1].config.subjectType='personal';updated.channels[1].config.env=0;updated.channels[1].version=2;p.requests[0].resolve(updated);await save;assert.equal(p.dirty.value,false);
 p.selectVirtualTab('ordinary');assert.equal(p.provider.value,'wechat');p.form.value.mchId='unsaved';p.selectVirtualTab('virtual');assert.equal(p.discard.open.value,true);assert.equal(p.provider.value,'wechat');p.discard.keep();assert.equal(p.form.value.mchId,'unsaved');
 p.selectVirtualTab('virtual');p.discard.confirm();assert.equal(p.provider.value,'wechat-virtual');assert.equal(p.form.value.subjectType,'personal');assert.equal(p.discard.open.value,false);
});
