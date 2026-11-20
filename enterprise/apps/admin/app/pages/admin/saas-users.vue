<script setup lang="ts">
import ConsoleQueryButton from '../../components/console/ConsoleQueryButton.vue'
const loadAction=ref<'search'|'reset'|'refresh'|'page'|'mutation'|'retry'>('refresh')
const {site}=useSiteBranding()
definePageMeta({layout:'admin'})
import ConsoleActionConfirmationDialog from '@orangezh1/qisvc-console-ui/components/ConsoleActionConfirmationDialog'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsoleListFilters from '@orangezh1/qisvc-console-ui/components/ConsoleListFilters'
import ConsoleListSearch from '@orangezh1/qisvc-console-ui/components/ConsoleListSearch'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import AccountImageInput from '../../components/console/AccountImageInput.vue'
import AdminConsole from '../../components/console/AdminConsole.vue'
import {dateTime} from '../../utils/update-center'
type Account={id:string;username:string;nickname:string;avatar:string|null;phone:string;allowMultipleSessions:boolean;enabled:boolean;version:number;createdAt:string;scopes:{tenant:{id:string;name:string;enabled:boolean}}[]}
type Listing={items:Account[];total:number}
const auth=useApi(),toast=useToast(),route=useRoute(),session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root'||!session.permissions.includes('accounts.read'))throw createError({statusCode:403,statusMessage:'没有SaaS用户访问权限'})
const q=ref(''),tenantFilter=ref(String(route.query.tenantId||'')),search=ref(''),selectedTenant=ref(tenantFilter.value),status=ref('all'),page=ref(1),pageSize=ref(20),busy=ref(false),error=ref(''),modal=ref(false),saving=ref(false),formError=ref(''),mode=ref<'create'|'edit'|'password'>('create'),editing=ref<Account|null>(null),requestId=ref('')
const params=()=>new URLSearchParams({q:search.value,tenantId:selectedTenant.value,status:status.value,page:String(page.value),pageSize:String(pageSize.value)})
const initial=await useAsyncData('saas-user-list',()=>auth.api<Listing>('/admin/tenant-admins?'+params()))
const rows=ref<Listing>(initial.data.value??{items:[],total:0});if(initial.error.value)error.value='SaaS用户读取失败，请重试'
const canWrite=computed(()=>!!session?.permissions.includes('accounts.write')),canCreate=computed(()=>canWrite.value)
// Zero horizontal padding keeps action labels aligned with their shared column heading.
const columns=[{id:'avatar',header:'头像'},{accessorKey:'username',header:'登录账号'},{accessorKey:'nickname',header:'名称'},{accessorKey:'phone',header:'手机号'},{id:'tenant',header:'关联租户'},{id:'status',header:'账号状态'},{id:'created',header:'创建时间'},{id:'actions',header:'操作'}]
const statuses=[{label:'全部状态',value:'all'},{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]
const deleting=ref(false),deleteOpen=ref(false),deleteTarget=ref<Account|null>(null),deleteError=ref(''),toggling=ref('')
function askDelete(row:Account){deleteTarget.value=row;deleteError.value='';deleteOpen.value=true}
async function removeUser(){if(deleting.value||!deleteTarget.value)return;deleting.value=true;try{await auth.api('/admin/tenant-admins/'+deleteTarget.value.id,'DELETE',{version:deleteTarget.value.version});deleteOpen.value=false;toast.add({title:'用户已删除',color:'success'});await load('mutation')}catch(e){deleteError.value=e instanceof Error?e.message:'删除失败'}finally{deleting.value=false}}
async function toggleUser(row:Account,value:boolean){if(toggling.value)return;toggling.value=row.id;error.value='';try{await auth.api('/admin/tenant-admins/'+row.id,'PUT',{nickname:row.nickname,enabled:value,version:row.version});toast.add({title:value?'用户已启用':'用户已停用',color:'success'});await load('mutation')}catch(e){error.value=e instanceof Error?e.message:'状态修改失败'}finally{toggling.value=''}}
const imageBusy=ref(false),showPassword=ref(false)
const form=reactive({username:'',nickname:'',enabled:true,password:'',confirmPassword:'',avatar:null as string|null,phone:'',allowMultipleSessions:true})
let version=0
onBeforeUnmount(()=>{version++})
async function load(source:typeof loadAction.value='refresh'){const n=++version;loadAction.value=source;busy.value=true;error.value='';try{const result=await auth.api<Listing>('/admin/tenant-admins?'+params());if(n===version)rows.value=result}catch(e){if(n===version)error.value=e instanceof Error?e.message:'读取失败'}finally{if(n===version)busy.value=false}}
function filter(source:'search'|'reset'='search'){search.value=q.value.trim();selectedTenant.value=tenantFilter.value.trim();page.value=1;void load(source)}
function open(type:'create'|'edit'|'password',row?:Account){mode.value=type;editing.value=row??null;requestId.value=crypto.randomUUID();Object.assign(form,{username:row?.username??'',nickname:row?.nickname??'',enabled:row?.enabled??true,password:'',confirmPassword:'',avatar:row?.avatar??null,phone:row?.phone??'',allowMultipleSessions:row?.allowMultipleSessions??true});formError.value='';showPassword.value=false;modal.value=true}
watch(modal,value=>{if(!value){form.password='';form.confirmPassword=''}})
async function save(){
  if(saving.value||imageBusy.value)return;formError.value=''
  if(mode.value!=='edit'&&form.password!==form.confirmPassword){formError.value='两次输入的密码不一致';return}
  saving.value=true
  try{
    if(mode.value==='create')await auth.api('/admin/tenant-admins','POST',{username:form.username,nickname:form.nickname,password:form.password,avatar:form.avatar,phone:form.phone,allowMultipleSessions:form.allowMultipleSessions,enabled:form.enabled,requestId:requestId.value})
    else if(mode.value==='password')await auth.api('/admin/tenant-admins/'+editing.value!.id+'/password','PUT',{password:form.password,version:editing.value!.version})
    else await auth.api('/admin/tenant-admins/'+editing.value!.id,'PUT',{nickname:form.nickname,enabled:form.enabled,avatar:form.avatar,phone:form.phone,allowMultipleSessions:form.allowMultipleSessions,version:editing.value!.version})
    modal.value=false;toast.add({title:mode.value==='create'?'SaaS用户已创建':mode.value==='password'?'密码已重置，原有登录已失效':'账号资料已保存',color:'success'});await load('mutation')
  }catch(e){formError.value=e instanceof Error?e.message:'保存失败，请重试'}finally{saving.value=false}
}
</script>
<template>
  <AdminConsole :refreshing="busy&&loadAction==='refresh'" @refresh="load('refresh')"><div class="space-y-5">
    <ConsolePageHeading title="SaaS用户"><template #actions><UButton v-if="canCreate" icon="i-lucide-user-plus" @click="open('create')">新增用户</UButton></template></ConsolePageHeading>
    <form @submit.prevent="filter('search')"><ConsoleListFilters><ConsoleListSearch v-model="q" placeholder="搜索账号、名称或手机号"/><ConsoleInput v-model="tenantFilter" class="sm:!w-48" placeholder="按租户编号筛选" aria-label="租户编号筛选"/><USelect v-model="status" :items="statuses" aria-label="账号状态"/><div class="flex shrink-0 items-center gap-3"><ConsoleQueryButton type="submit" :loading="busy&&loadAction==='search'">查询</ConsoleQueryButton><ConsoleQueryButton kind="reset" color="neutral" variant="outline" :loading="busy&&loadAction==='reset'" @click="q='';tenantFilter='';status='all';filter('reset')">重置</ConsoleQueryButton></div></ConsoleListFilters></form>
    <ConsoleDataTable :data="rows.items" :columns="columns" :error="error" :page="page" :page-size="pageSize" :total="rows.total" :client-pagination="false" empty-title="暂无SaaS用户" empty-description="先创建 SaaS 用户，再在租户列表关联到具体租户。" @retry="load('retry')" @update:page="page=$event;load('page')" @update:page-size="pageSize=$event;page=1;load('page')">
      <template #avatar-cell="{row}"><img :src="row.original.avatar||site?.tenant.defaultAvatar||'/brand/admin-avatar.png'" alt="用户头像" class="size-9 rounded-full object-cover"/></template>
      <template #username-cell="{row}"><span class="font-medium text-highlighted">{{row.original.username}}</span></template>
      <template #tenant-cell="{row}"><span v-if="!row.original.scopes.length" class="text-xs text-muted">未关联租户</span><div v-for="scope in row.original.scopes" :key="scope.tenant.id"><p>{{scope.tenant.name}} <span v-if="!scope.tenant.enabled" class="text-xs text-warning">租户已停用</span></p><p class="text-xs text-muted">{{scope.tenant.id}}</p></div></template>
      <template #status-cell="{row}"><USwitch :model-value="row.original.enabled" :disabled="!canWrite||!!toggling" :loading="toggling===row.original.id" :aria-label="row.original.username+' 用户状态'" @update:model-value="toggleUser(row.original,$event)"/></template>
      <template #created-cell="{row}"><span class="text-xs text-muted">{{dateTime(row.original.createdAt)}}</span></template>
      <template #actions-cell="{row}"><UButton class="px-0" v-if="canWrite" size="xs" variant="link" @click="open('edit',row.original)">编辑</UButton><UButton class="px-0" v-if="canWrite" size="xs" variant="link" color="error" @click="askDelete(row.original)">删除</UButton></template>
    </ConsoleDataTable>
    <ConsoleActionConfirmationDialog v-model:open="deleteOpen" title="删除SaaS用户？" :subject="deleteTarget?.username" :description="deleteError||'删除后账号将停用并移出列表，登录会话立即失效；历史审计保留。仍作为租户负责人的用户需先更换负责人；其他租户访问权限会一并撤销。'" confirm-label="删除用户" :loading="deleting" @confirm="removeUser"/>
    <UModal v-model:open="modal" :title="mode==='create'?'新增用户':mode==='password'?'重置密码':'编辑SaaS用户'" :description="mode==='password'?'重置后，该账号的原有登录会话将全部失效。':'创建后可在租户列表关联此用户，不授予平台管理权限。'" :dismissible="!saving&&!imageBusy" :close="!saving&&!imageBusy" :ui="{content:'sm:max-w-xl max-h-[90dvh]',body:'overflow-y-auto'}"><template #body>
      <form id="saas-user-form" class="space-y-5" novalidate @submit.prevent="save">

        <UFormField label="登录账号" required><ConsoleInput v-model="form.username" :disabled="saving||mode!=='create'" autocomplete="off" required pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}" :maxlength="32"/></UFormField>
        <div v-if="mode==='edit'" class="flex items-center justify-between rounded-lg bg-elevated/50 px-4 py-3"><span class="text-sm text-muted">账号密码</span><UButton type="button" size="sm" color="neutral" variant="outline" :disabled="saving||imageBusy" @click="open('password',editing!)">重置密码</UButton></div>
        <UFormField v-if="mode!=='password'" label="头像"><AccountImageInput :fallback="site?.tenant.defaultAvatar||'/brand/admin-avatar.png'" v-model="form.avatar" label="头像" :disabled="saving" @busy="imageBusy=$event"/></UFormField>
        <UFormField v-if="mode!=='password'" label="名称" required><ConsoleInput v-model="form.nickname" required :maxlength="32" :disabled="saving"/></UFormField>
        <UFormField v-if="mode!=='password'" label="手机号"><ConsoleInput v-model="form.phone" type="tel" :maxlength="32" :disabled="saving"/></UFormField>
        <template v-if="mode!=='edit'"><UFormField :label="mode==='create'?'初始密码':'新密码'" required><ConsoleInput v-model="form.password" :type="showPassword?'text':'password'" autocomplete="new-password" required :minlength="6" :maxlength="128" :disabled="saving"><template #trailing><UButton type="button" size="xs" variant="ghost" color="neutral" :icon="showPassword?'i-lucide-eye-off':'i-lucide-eye'" :aria-label="showPassword?'隐藏密码':'显示密码'" @click="showPassword=!showPassword"/></template></ConsoleInput></UFormField><UFormField label="确认密码" required><ConsoleInput v-model="form.confirmPassword" type="password" autocomplete="new-password" required :disabled="saving"/></UFormField></template>
        <template v-if="mode!=='password'"><UFormField label="多处登录" help="关闭后，同一账号仅保留最新一次登录；保存修改会使现有会话失效。"><USwitch v-model="form.allowMultipleSessions" label="允许多处同时登录" :disabled="saving"/></UFormField><UFormField label="用户状态"><USwitch v-model="form.enabled" label="启用用户" :disabled="saving"/></UFormField></template>
        <UAlert v-if="formError" color="error" :title="formError" variant="subtle"/>
      </form>
    </template><template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" :disabled="saving||imageBusy" @click="modal=false">取消</UButton><UButton type="submit" form="saas-user-form" :loading="saving" :disabled="imageBusy">{{mode==='create'?'创建用户':mode==='password'?'确认重置':'保存修改'}}</UButton></ConsoleFormActions></template></UModal>
  </div></AdminConsole>
</template>
