<script setup lang="ts">
import ConsoleQueryButton from '../../components/console/ConsoleQueryButton.vue'
import ConsoleDrawer from '../../components/console/ConsoleDrawer.vue'
import ConsoleDiscardChangesDialog from '../../components/console/ConsoleDiscardChangesDialog.vue'
const loadAction=ref<'search'|'reset'|'refresh'|'page'|'mutation'|'retry'>('refresh')
const {site}=useSiteBranding()
definePageMeta({layout:'admin'})
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsoleListFilters from '@orangezh1/qisvc-console-ui/components/ConsoleListFilters'
import ConsoleListSearch from '@orangezh1/qisvc-console-ui/components/ConsoleListSearch'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import AccountImageInput from '../../components/console/AccountImageInput.vue'
import AdminConsole from '../../components/console/AdminConsole.vue'
import {dateTime} from '../../utils/update-center'
type Tenant={application?:{key:string;name:string;enabled:boolean;expiresAt:string|null}|null;applicationConflict?:boolean;id:string;name:string;contactName:string;contactPhone:string;enabled:boolean;version:number;createdAt:string|null;logo:string|null;storageMode:'platform'|'tenant';remark:string;customDomain:string|null;expiresAt:string|null;ownerAdminId:string|null;_count:{adminScopes:number}}
type Listing={items:Tenant[];total:number}
const auth=useApi(),toast=useToast(),session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root'||!session.permissions.includes('tenants.read'))throw createError({statusCode:403,statusMessage:'没有租户列表访问权限'})
const q=ref(''),search=ref(''),status=ref('all'),page=ref(1),pageSize=ref(20),busy=ref(false),error=ref(''),modal=ref(false),saving=ref(false),formError=ref(''),editing=ref<Tenant|null>(null),requestId=ref('')
const initial=await useAsyncData('tenant-list',()=>auth.api<Listing>('/admin/tenants?page=1&pageSize=20'))
const rows=ref<Listing>(initial.data.value??{items:[],total:0});if(initial.error.value)error.value='租户列表读取失败，请重试'
const detailOpen=ref(false),detail=ref<Tenant|null>(null),entering=ref('')
function showDetails(row:Tenant){detail.value=row;detailOpen.value=true}
let entryWindow:Window|null=null,entryController:AbortController|undefined,entryDisposed=false
function closeEntryWindow(){try{if(entryWindow&&!entryWindow.closed&&entryWindow.location.href==='about:blank')entryWindow.close()}catch{}entryWindow=null}
async function enterTenant(row:Tenant){
 if(entering.value||entryDisposed)return
 entering.value=row.id;error.value=''
 try{
  // Reserve the tab during the click gesture, before the asynchronous session request.
  const target=window.open('about:blank','_blank');if(!target)throw Error('浏览器拦截了新窗口，请允许本站弹出窗口后重试')
  entryWindow=target;target.opener=null;entryController=new AbortController()
  await auth.api('/admin/tenants/'+encodeURIComponent(row.id)+'/login','POST',{},{signal:entryController.signal})
  if(entryDisposed)return
  if(target.closed)throw Error('新窗口已关闭，请重新点击登录')
  target.location.replace(new URL('/tenant/applications',window.location.origin).href);entryWindow=null
 }catch(e){closeEntryWindow();if(!entryDisposed)error.value=e instanceof Error?e.message:'进入租户失败'}
 finally{entryController=undefined;if(!entryDisposed)entering.value=''}
}
onBeforeUnmount(()=>{entryDisposed=true;entryController?.abort();closeEntryWindow()})
const imageBusy=ref(false),userSearch=ref(''),userBusy=ref(false),userOptions=ref<{label:string;value:string;disabled:boolean}[]>([])
let lookupTimer:ReturnType<typeof setTimeout>|undefined,lookupVersion=0
async function lookupUsers(term=''){const n=++lookupVersion;userBusy.value=true;try{const result=await auth.api<{items:{id:string;username:string;nickname:string;enabled:boolean}[]}>('/admin/tenant-admins?'+new URLSearchParams({q:term,pageSize:'50'}));if(form.ownerAdminId&&!result.items.some(u=>u.id===form.ownerAdminId)){const owner=await auth.api<{items:{id:string;username:string;nickname:string;enabled:boolean}[]}>('/admin/tenant-admins?'+new URLSearchParams({q:form.ownerAdminId,pageSize:'10'}));result.items.push(...owner.items.filter(u=>u.id===form.ownerAdminId))}if(n===lookupVersion)userOptions.value=result.items.map(u=>({label:u.nickname+'（'+u.username+'）',value:u.id,disabled:!u.enabled}))}catch(e){if(n===lookupVersion)formError.value=e instanceof Error?e.message:'用户读取失败'}finally{if(n===lookupVersion)userBusy.value=false}}
watch(userSearch,term=>{clearTimeout(lookupTimer);lookupTimer=setTimeout(()=>{void lookupUsers(term)},250)})
onBeforeUnmount(()=>{clearTimeout(lookupTimer);lookupVersion++;version++})
function localDate(value:string|null){return value?new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,19):''}
const form=reactive({applicationKey:'__none__',id:'',name:'',contactName:'',contactPhone:'',enabled:true,logo:null as string|null,storageMode:'platform',remark:'',customDomain:'',expiresAt:'',ownerAdminId:''})
const baseline=ref(''),dirty=computed(()=>modal.value&&JSON.stringify(form)!==baseline.value)
const discard=useDiscardChanges(()=>saving.value||imageBusy.value)
function closeNow(){modal.value=false;discard.keep()}
function close(){if(saving.value||imageBusy.value)return;if(dirty.value){discard.request(closeNow);return}closeNow()}
function beforeUnload(event:BeforeUnloadEvent){if(dirty.value||saving.value||imageBusy.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>window.addEventListener('beforeunload',beforeUnload))
onBeforeRouteLeave(to=>{if(!auth.session.value)return;if(saving.value||imageBusy.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(dirty.value){discard.request(()=>{closeNow();void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{if(import.meta.client)window.removeEventListener('beforeunload',beforeUnload)})
type AssignableApplication={key:string;name:string;tenantLimit:number|null;used:number;remaining:number|null;selectable:boolean}
const applicationOptions=ref<AssignableApplication[]>([]),applicationBusy=ref(false),applicationError=ref(''),applicationLoadSource=ref<'initial'|'retry'>('initial')
const selectedApplication=computed(()=>applicationOptions.value.find(app=>app.key===form.applicationKey))
const applicationItems=computed(()=>[{label:'不授权应用',value:'__none__',disabled:false},...applicationOptions.value.map(app=>({label:app.name+(!app.selectable&&app.key!==editing.value?.application?.key?'（坑位已满）':''),value:app.key,disabled:!app.selectable&&app.key!==editing.value?.application?.key})),...(editing.value?.application&&!applicationOptions.value.some(app=>app.key===editing.value?.application?.key)?[{label:editing.value.application.name+'（当前绑定）',value:editing.value.application.key,disabled:false}]:[])])
let applicationSequence=0
async function loadApplications(source:'initial'|'retry'='initial'){
  const sequence=++applicationSequence;applicationBusy.value=true;applicationLoadSource.value=source;applicationError.value=''
  try{const result=await auth.api<{items:AssignableApplication[]}>('/admin/tenants/application-options');if(sequence===applicationSequence)applicationOptions.value=result.items}
  catch(e){if(sequence===applicationSequence){applicationOptions.value=[];applicationError.value=e instanceof Error?e.message:'应用读取失败'}}
  finally{if(sequence===applicationSequence)applicationBusy.value=false}
}
onBeforeUnmount(()=>{applicationSequence++})
const canWrite=computed(()=>!!session?.permissions.includes('tenants.write')),canAccount=computed(()=>!!session?.permissions.includes('accounts.write')&&session?.permissions.includes('accounts.read'))
const columns=[{id:'logo',header:'图标'},{accessorKey:'name',header:'租户名称'},{id:'application',header:'授权应用'},{accessorKey:'id',header:'租户编号'},{id:'contact',header:'联系人'},{id:'admins',header:'管理员'},{id:'status',header:'状态'},{id:'expiry',header:'到期时间'},{id:'actions',header:'操作'}]
const statuses=[{label:'全部状态',value:'all'},{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]
let version=0
async function load(source:typeof loadAction.value='refresh'){if((source==='refresh'||source==='retry')&&modal.value){if(saving.value||imageBusy.value)return;if(dirty.value){discard.request(()=>{closeNow();void load(source)});return}}const n=++version;loadAction.value=source;busy.value=true;error.value='';try{const result=await auth.api<Listing>('/admin/tenants?'+new URLSearchParams({q:search.value,status:status.value,page:String(page.value),pageSize:String(pageSize.value)}));if(n===version)rows.value=result}catch(e){if(n===version)error.value=e instanceof Error?e.message:'读取失败'}finally{if(n===version)busy.value=false}}
function filter(source:'search'|'reset'='search'){search.value=q.value.trim();page.value=1;void load(source)}
function open(row?:Tenant){if(saving.value||imageBusy.value)return;if(dirty.value){discard.request(()=>{closeNow();open(row)});return}applicationSequence++;applicationBusy.value=false;applicationError.value='';applicationOptions.value=[];editing.value=row??null;requestId.value=crypto.randomUUID();Object.assign(form,{applicationKey:row?.application?.key||'__none__',id:row?.id??'',name:row?.name??'',contactName:row?.contactName??'',contactPhone:row?.contactPhone??'',enabled:row?.enabled??true,logo:row?.logo??null,storageMode:row?.storageMode??'platform',remark:row?.remark??'',customDomain:row?.customDomain??'',expiresAt:localDate(row?.expiresAt??null),ownerAdminId:row?.ownerAdminId??''});baseline.value=JSON.stringify(form);discard.keep();formError.value='';modal.value=true;userSearch.value='';if(canAccount.value)void lookupUsers();if(!row?.applicationConflict)void loadApplications()}
watch(modal,value=>{if(!value){clearTimeout(lookupTimer);lookupVersion++;userBusy.value=false;applicationSequence++;applicationBusy.value=false}})
async function save(){
  if(saving.value||imageBusy.value||applicationBusy.value)return;formError.value=''
  if(editing.value?.applicationConflict){formError.value='租户存在多个历史应用绑定，请先核查';return}
  if(form.applicationKey!=='__none__'&&form.applicationKey!==editing.value?.application?.key&&!selectedApplication.value?.selectable){formError.value='请选择授权有效且有剩余坑位的应用';return}
  if(!form.ownerAdminId&&(!editing.value||canAccount.value)){formError.value='请选择关联的 SaaS 用户';return}
  saving.value=true
  try{
    const values={applicationKey:form.applicationKey==='__none__'?null:form.applicationKey,name:form.name,contactName:form.contactName,contactPhone:form.contactPhone,logo:form.logo,enabled:form.enabled,storageMode:form.storageMode,remark:form.remark,customDomain:form.customDomain,expiresAt:form.expiresAt?new Date(form.expiresAt+(form.expiresAt.length===16?':00':'')+'+08:00').toISOString():null,...(canAccount.value?{ownerAdminId:form.ownerAdminId}:{})}
    if(editing.value)await auth.api('/admin/tenants/'+encodeURIComponent(editing.value.id),'PUT',{...values,enabled:form.enabled,version:editing.value.version})
    else await auth.api('/admin/tenants','POST',{...values,requestId:requestId.value})
    baseline.value=JSON.stringify(form);modal.value=false;toast.add({title:editing.value?'租户资料已保存':'租户已创建',color:'success'});await load('mutation')
  }catch(e){formError.value=e instanceof Error?e.message:'保存失败，请重试'}finally{saving.value=false}
}
</script>
<template>
  <AdminConsole :refreshing="busy&&loadAction==='refresh'" @refresh="load('refresh')"><div class="space-y-5">
    <ConsolePageHeading title="租户列表"><template #actions><UButton v-if="canWrite&&canAccount" icon="i-lucide-plus" @click="open()">创建租户</UButton></template></ConsolePageHeading>
    <form @submit.prevent="filter('search')"><ConsoleListFilters><ConsoleListSearch v-model="q" placeholder="搜索租户名称、编号或联系人"/><USelect v-model="status" :items="statuses" aria-label="租户状态"/><div class="flex shrink-0 items-center gap-3"><ConsoleQueryButton type="submit" :loading="busy&&loadAction==='search'">查询</ConsoleQueryButton><ConsoleQueryButton kind="reset" color="neutral" variant="outline" :loading="busy&&loadAction==='reset'" @click="q='';status='all';filter('reset')">重置</ConsoleQueryButton></div></ConsoleListFilters></form>
    <ConsoleDataTable :data="rows.items" :columns="columns" :error="error" :page="page" :page-size="pageSize" :total="rows.total" :client-pagination="false" empty-title="暂无租户" empty-description="创建租户后，可为其配置独立的管理员账号。" @retry="load('retry')" @update:page="page=$event;load('page')" @update:page-size="pageSize=$event;page=1;load('page')">
      <template #logo-cell="{row}"><img :src="row.original.logo||site?.tenant.logo||'/brand/qicore.png'" alt="租户图标" class="size-9 rounded-lg object-cover"/></template>
      <template #name-cell="{row}"><span class="font-medium text-highlighted">{{row.original.name}}</span></template>
      <template #application-cell="{row}"><span :class="row.original.applicationConflict?'text-warning':row.original.application?'text-default':'text-muted'">{{row.original.applicationConflict?'绑定异常':row.original.application?.name||'未授权应用'}}</span></template>
      <template #contact-cell="{row}"><p>{{row.original.contactName||'—'}}</p><p class="text-xs text-muted">{{row.original.contactPhone||''}}</p></template>
      <template #admins-cell="{row}">{{row.original._count.adminScopes}} 人</template>
      <template #status-cell="{row}"><UBadge :color="row.original.enabled?(row.original.expiresAt&&Date.parse(row.original.expiresAt)<=Date.now()?'warning':'success'):'neutral'" variant="subtle">{{row.original.enabled?(row.original.expiresAt&&Date.parse(row.original.expiresAt)<=Date.now()?'已到期':'启用'):'停用'}}</UBadge></template>
      <template #expiry-cell="{row}"><span class="text-xs text-muted">{{row.original.expiresAt?dateTime(row.original.expiresAt):'不限制'}}</span></template>
      <template #actions-cell="{row}"><UButton class="px-0" size="xs" variant="link" @click="showDetails(row.original)">详情</UButton><UButton class="px-0" v-if="canAccount" size="xs" variant="link" :loading="entering===row.original.id" :disabled="!!entering||!row.original.enabled||!row.original.ownerAdminId" @click="enterTenant(row.original)">登录</UButton><UDropdownMenu v-if="canWrite" size="sm" :content="{align:'end',sideOffset:4}" :ui="{content:'w-28 min-w-28 rounded-lg',item:'min-h-7 items-center px-2 py-1.5 text-xs gap-2',itemLeadingIcon:'size-3.5'}" :items="[[{label:'编辑',icon:'i-lucide-pencil',onSelect:()=>open(row.original)}]]"><UButton class="px-0" size="xs" variant="link" color="neutral" trailing-icon="i-lucide-chevron-down">更多</UButton></UDropdownMenu></template>
    </ConsoleDataTable>
    <ConsoleDrawer v-model:open="detailOpen" title="租户详情" description="查看租户配置与关联用户。"><template #body><div v-if="detail" class="drawer-detail space-y-6"><section class="space-y-4"><div class="flex items-center gap-4"><img :src="detail.logo||site?.tenant.logo||'/brand/qicore.png'" alt="租户图标" class="size-14 shrink-0 rounded-lg object-cover"/><div><h2 class="break-words text-lg font-semibold">{{detail.name}}</h2><p class="mt-1 break-all text-xs text-muted">{{detail.id}}</p></div></div></section><section class="space-y-4"><h3 class="drawer-section-title">租户资料</h3><dl class="grid grid-cols-1 gap-x-6 gap-y-5 text-sm sm:grid-cols-2"><div><dt class="text-muted">状态</dt><dd class="mt-2">{{!detail.enabled?'停用':detail.expiresAt&&Date.parse(detail.expiresAt)<=Date.now()?'已到期':'启用'}}</dd></div><div><dt class="text-muted">授权应用</dt><dd class="mt-2">{{detail.applicationConflict?'绑定异常':detail.application?.name||'未授权应用'}}</dd></div><div><dt class="text-muted">云存储配置</dt><dd class="mt-2">{{detail.storageMode==='platform'?'平台统一存储':'租户自行配置'}}</dd></div><div><dt class="text-muted">联系人</dt><dd class="mt-2">{{detail.contactName||'—'}}</dd></div><div><dt class="text-muted">联系电话</dt><dd class="mt-2">{{detail.contactPhone||'—'}}</dd></div><div><dt class="text-muted">客户后台域名</dt><dd class="mt-2 break-all">{{detail.customDomain||'未设置'}}{{detail.customDomain?'（待配置访问）':''}}</dd></div><div><dt class="text-muted">到期时间</dt><dd class="mt-2">{{detail.expiresAt?dateTime(detail.expiresAt):'不限制'}}</dd></div><div><dt class="text-muted">创建时间</dt><dd class="mt-2">{{dateTime(detail.createdAt)}}</dd></div><div><dt class="text-muted">关联用户</dt><dd class="mt-2">{{detail._count.adminScopes}} 人 <UButton v-if="session?.permissions.includes('accounts.read')" size="xs" variant="link" :to="'/admin/saas-users?tenantId='+encodeURIComponent(detail.id)">查看用户</UButton></dd></div><div class="sm:col-span-2"><dt class="text-muted">备注</dt><dd class="mt-2 whitespace-pre-wrap break-words">{{detail.remark||'—'}}</dd></div></dl></section></div></template></ConsoleDrawer>
    <ConsoleDrawer :open="modal" @update:open="!$event&&close()" :title="editing?'编辑租户':'创建租户'" description="设置租户基础信息并关联 SaaS 用户。" :dismissible="!saving&&!imageBusy" :close="!saving&&!imageBusy" wide><template #body>
      <form id="tenant-form" class="space-y-6" @submit.prevent="save">
        <h2 class="drawer-form-section">基础信息</h2>
        <UFormField label="租户图标"><AccountImageInput purpose="tenant" v-model="form.logo" label="图标" :fallback="site?.tenant.logo||'/brand/qicore.png'" :disabled="saving" @busy="imageBusy=$event"/></UFormField>
        <div class="grid gap-5 sm:grid-cols-2"><UFormField label="租户名称" required><ConsoleInput v-model="form.name" required :maxlength="128" :disabled="saving" placeholder="请输入租户名称"/></UFormField><UFormField label="租户编号" :help="editing?'创建后不可更改':'由系统生成，无需填写'"><ConsoleInput v-if="editing" :model-value="form.id" disabled/><p v-else class="flex min-h-8 items-center text-sm text-muted">创建时自动生成 5 位随机字母数字</p></UFormField></div>
        <UFormField label="授权应用">
          <p v-if="editing?.applicationConflict" class="text-sm text-warning">租户存在多个当前应用绑定，请先核查。</p>
          <USelect v-else v-model="form.applicationKey" :items="applicationItems" :loading="applicationBusy&&applicationLoadSource==='initial'" :disabled="saving||applicationBusy" aria-label="授权应用" class="w-full"/>
          <p class="mt-2 text-xs text-muted">最多授权一个应用，可以取消或更换。历史数据保留，取消后应用菜单消失，公共工作台仍可使用。</p>
          <p v-if="selectedApplication" class="mt-2 text-xs text-muted">已授权 {{selectedApplication.used}} 个租户 · {{selectedApplication.tenantLimit===null?'坑位不限':'剩余 '+selectedApplication.remaining+' / 共 '+selectedApplication.tenantLimit+' 个坑位'}}</p>
          <div v-if="!editing?.applicationConflict" class="mt-2 flex flex-wrap items-center gap-2"><p v-if="applicationError" role="status" class="text-xs text-error">{{applicationError}}</p><p v-else-if="!applicationBusy&&!applicationOptions.length" class="text-xs text-muted">暂无已安装且授权有效的应用。</p><UButton v-if="applicationError||applicationBusy&&applicationLoadSource==='retry'||!applicationBusy&&!applicationOptions.length" type="button" color="neutral" variant="link" size="xs" :disabled="applicationBusy" @click="loadApplications('retry')"><UIcon name="i-lucide-refresh-cw" class="size-3.5" :class="{'animate-spin':applicationBusy&&applicationLoadSource==='retry'}"/>重新获取应用</UButton></div>
        </UFormField>
        <UFormField label="租户状态" required><URadioGroup v-model="form.enabled" orientation="horizontal" :items="[{label:'开启',value:true},{label:'关闭',value:false}]" :disabled="saving"/></UFormField>
        <UFormField label="云存储配置" required :help="form.storageMode==='tenant'?'租户在自己的后台配置并启用存储后即可上传文件。':'使用平台当前启用的存储，文件按站点 ID 分目录。'"><URadioGroup v-model="form.storageMode" orientation="horizontal" :items="[{label:'使用平台统一存储',value:'platform'},{label:'租户自行配置',value:'tenant'}]" :disabled="saving"/></UFormField>
        <UFormField label="租户备注"><UTextarea v-model="form.remark" :maxlength="1000" :rows="3" class="w-full" :disabled="saving" placeholder="请输入租户备注"/></UFormField>
        <UFormField label="客户后台域名" help="仅填写域名。保存绑定后，还需配置 DNS、HTTPS 证书与反向代理；当前不会自动开通访问。"><ConsoleInput v-model="form.customDomain" :maxlength="253" :disabled="saving" placeholder="可选，例如 admin.customer.com"/></UFormField>
        <UFormField label="到期时间" help="留空表示不限制租户使用期，不影响作品保存期限。"><div class="flex items-stretch gap-2"><ConsoleInput v-model="form.expiresAt" class="flex-1" type="datetime-local" :step="1" :disabled="saving"/><UButton v-if="form.expiresAt" class="shrink-0 whitespace-nowrap" type="button" color="neutral" variant="ghost" :disabled="saving" @click="form.expiresAt=''">清空</UButton></div></UFormField>
        <div class="grid gap-5 sm:grid-cols-2"><UFormField label="联系人"><ConsoleInput v-model="form.contactName" :maxlength="64" :disabled="saving"/></UFormField><UFormField label="联系电话"><ConsoleInput v-model="form.contactPhone" type="tel" :maxlength="32" :disabled="saving"/></UFormField></div>
        <h2 class="drawer-form-section">关联用户</h2>
        <UFormField label="选择用户" required help="选择已启用的 SaaS 用户作为租户负责人；更换负责人会撤销原负责人的本租户访问权限。"><USelectMenu v-model="form.ownerAdminId" v-model:search-term="userSearch" :items="userOptions" value-key="value" ignore-filter :loading="userBusy" :disabled="saving||!canAccount" class="w-full" placeholder="搜索用户账号或名称" aria-label="关联SaaS用户"/></UFormField>
        <p class="text-xs text-muted">没有可选用户时，请先在 SaaS用户页面创建账号。</p>
        <UAlert v-if="formError" color="error" :title="formError" variant="subtle"/>
      </form>
    </template><template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" :disabled="saving||imageBusy" @click="close">取消</UButton><UButton type="submit" form="tenant-form" :loading="saving" :disabled="imageBusy||applicationBusy||!!editing?.applicationConflict||(!editing&&!canAccount)">{{editing?'保存修改':'创建租户'}}</UButton></ConsoleFormActions></template></ConsoleDrawer>
    <ConsoleDiscardChangesDialog :controller="discard"/>
  </div></AdminConsole>
</template>
