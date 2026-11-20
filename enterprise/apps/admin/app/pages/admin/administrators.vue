<script setup lang="ts">
import ConsoleQueryButton from '../../components/console/ConsoleQueryButton.vue'
const loadAction=ref<'search'|'reset'|'refresh'|'page'|'mutation'|'retry'>('refresh')
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsoleListFilters from '@orangezh1/qisvc-console-ui/components/ConsoleListFilters'
import ConsoleListSearch from '@orangezh1/qisvc-console-ui/components/ConsoleListSearch'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import ConsoleActionConfirmationDialog from '@orangezh1/qisvc-console-ui/components/ConsoleActionConfirmationDialog'
import AccountImageInput from '../../components/console/AccountImageInput.vue'
import AdminConsole from '../../components/console/AdminConsole.vue'
import {dateTime} from '../../utils/update-center'
definePageMeta({layout:'admin'})
type Account={id:string;username:string;nickname:string;avatar:string|null;phone:string;roleId:string;role:{id:string;name:string;systemCode:string|null;enabled:boolean};enabled:boolean;allowMultipleSessions:boolean;version:number;createdAt:string;editable:boolean}
type Listing={items:Account[];total:number}
const auth=useApi(),toast=useToast(),{site}=useSiteBranding(),session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root'||!session.permissions.includes('accounts.read'))throw createError({statusCode:403,statusMessage:'没有管理员访问权限'})
const q=ref(''),search=ref(''),status=ref('all'),page=ref(1),pageSize=ref(20),busy=ref(false),error=ref(''),modal=ref(false),saving=ref(false),formError=ref(''),mode=ref<'create'|'edit'|'password'>('create'),editing=ref<Account|null>(null),requestId=ref(''),imageBusy=ref(false),showPassword=ref(false),toggleOpen=ref(false),toggleTarget=ref<Account|null>(null)
const canWrite=computed(()=>!!auth.session.value?.permissions.includes('accounts.write'))
const params=()=>new URLSearchParams({q:search.value,status:status.value,page:String(page.value),pageSize:String(pageSize.value)})
const initial=await useAsyncData('platform-admin-list',()=>auth.api<Listing>('/admin/platform-admins?'+params()))
const rows=ref<Listing>(initial.data.value??{items:[],total:0});if(initial.error.value)error.value='管理员读取失败，请刷新重试'
const columns=[{id:'staff',header:'管理员'},{accessorKey:'phone',header:'手机号'},{id:'role',header:'所属角色'},{id:'status',header:'状态'},{id:'created',header:'创建时间'},{id:'actions',header:'操作'}]
const form=reactive({username:'',nickname:'',avatar:null as string|null,phone:'',roleId:'',enabled:true,allowMultipleSessions:true,password:'',confirmPassword:''})
const roleSearch=ref(''),roleBusy=ref(false),roleError=ref(''),roleOptions=ref<{label:string;value:string;disabled?:boolean}[]>([]),roleTotal=ref(0)
let loadVersion=0,roleVersion=0
onBeforeUnmount(()=>{loadVersion++;roleVersion++})
async function load(source:typeof loadAction.value='refresh'){const n=++loadVersion;loadAction.value=source;busy.value=true;error.value='';try{const result=await auth.api<Listing>('/admin/platform-admins?'+params());if(n===loadVersion)rows.value=result}catch(e){if(n===loadVersion)error.value=e instanceof Error?e.message:'读取失败'}finally{if(n===loadVersion)busy.value=false}}
async function lookupRoles(){const n=++roleVersion;roleBusy.value=true;roleError.value='';try{const result=await auth.api<{items:{id:string;name:string}[];total:number}>('/admin/platform-admins/roles?'+new URLSearchParams({q:roleSearch.value}));if(n!==roleVersion)return;roleTotal.value=result.total;roleOptions.value=result.items.map(r=>({label:r.name,value:r.id}));if(editing.value&&!roleOptions.value.some(r=>r.value===editing.value!.roleId))roleOptions.value.push({label:editing.value.role.name+(editing.value.role.enabled?'':'（已停用）'),value:editing.value.roleId,disabled:!editing.value.role.enabled})}catch(e){if(n===roleVersion)roleError.value=e instanceof Error?e.message:'角色读取失败'}finally{if(n===roleVersion)roleBusy.value=false}}
watch(roleSearch,()=>{if(modal.value&&mode.value!=='password')void lookupRoles()})
watch(modal,value=>{if(!value){form.password='';form.confirmPassword='';roleVersion++;roleBusy.value=false}})
function filter(source:'search'|'reset'='search'){search.value=q.value.trim();page.value=1;void load(source)}
function open(type:'create'|'edit'|'password',row?:Account){mode.value=type;editing.value=row??null;requestId.value=crypto.randomUUID();Object.assign(form,{username:row?.username??'',nickname:row?.nickname??'',avatar:row?.avatar??null,phone:row?.phone??'',roleId:row?.roleId??'',enabled:row?.enabled??true,allowMultipleSessions:row?.allowMultipleSessions??true,password:'',confirmPassword:''});formError.value='';showPassword.value=false;roleOptions.value=[];roleError.value='';roleSearch.value='';modal.value=true;if(type!=='password')void lookupRoles()}
async function save(){
  if(saving.value||imageBusy.value||mode.value!=='password'&&(roleBusy.value||roleError.value))return;formError.value=''
  if(mode.value!=='edit'&&form.password!==form.confirmPassword){formError.value='两次输入的密码不一致';return}
  if(mode.value!=='password'&&!form.roleId){formError.value='请选择所属角色';return}
  saving.value=true
  try{
    if(mode.value==='password')await auth.api('/admin/platform-admins/'+editing.value!.id+'/password','PUT',{password:form.password,version:editing.value!.version})
    else{const fields={nickname:form.nickname,avatar:form.avatar,phone:form.phone,roleId:form.roleId,enabled:form.enabled,allowMultipleSessions:form.allowMultipleSessions};await auth.api(mode.value==='create'?'/admin/platform-admins':'/admin/platform-admins/'+editing.value!.id,mode.value==='create'?'POST':'PUT',{...fields,...(mode.value==='create'?{username:form.username,password:form.password,requestId:requestId.value}:{version:editing.value!.version})})}
    modal.value=false;toast.add({title:mode.value==='create'?'管理员已创建':mode.value==='password'?'密码已重置，原有登录已失效':'管理员已更新，原有登录已失效',color:'success'});await load('mutation')
  }catch(e){formError.value=e instanceof Error?e.message:'保存失败'}finally{saving.value=false}
}
async function toggle(){const row=toggleTarget.value;if(!row||saving.value)return;saving.value=true;try{await auth.api('/admin/platform-admins/'+row.id+'/status','PUT',{enabled:!row.enabled,version:row.version});toggleOpen.value=false;toast.add({title:row.enabled?'管理员已停用':'管理员已启用',color:'success'});await load('mutation')}catch(e){toast.add({title:e instanceof Error?e.message:'状态修改失败',color:'error'})}finally{saving.value=false}}
</script>
<template><AdminConsole :refreshing="busy&&loadAction==='refresh'" @refresh="load('refresh')"><div class="space-y-5">
  <ConsolePageHeading title="管理员"><template #actions><UButton v-if="canWrite" icon="i-lucide-user-plus" @click="open('create')">新增管理员</UButton></template></ConsolePageHeading>
  <form @submit.prevent="filter('search')"><ConsoleListFilters><ConsoleListSearch v-model="q" placeholder="搜索账号、名称或手机号"/><USelect v-model="status" :items="[{label:'全部状态',value:'all'},{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]" aria-label="管理员状态筛选"/><div class="flex shrink-0 items-center gap-3"><ConsoleQueryButton type="submit" :loading="busy&&loadAction==='search'">查询</ConsoleQueryButton><ConsoleQueryButton kind="reset" color="neutral" variant="outline" :loading="busy&&loadAction==='reset'" @click="q='';status='all';filter('reset')">重置</ConsoleQueryButton></div></ConsoleListFilters></form>
  <ConsoleDataTable :data="rows.items" :columns="columns" :error="error" :page="page" :page-size="pageSize" :total="rows.total" :client-pagination="false" :empty-title="search||status!=='all'?'未找到匹配的管理员':'暂无管理员'" :empty-description="search||status!=='all'?'请调整搜索内容或状态筛选。':'先配置角色，再创建平台管理员。'" @retry="load('retry')" @update:page="page=$event;load('page')" @update:page-size="pageSize=$event;page=1;load('page')">
    <template #staff-cell="{row}"><div class="flex items-center gap-3"><img :src="row.original.avatar||site?.platform.defaultAvatar||'/brand/admin-avatar.png'" alt="管理员头像" class="size-9 shrink-0 rounded-full object-cover"/><div><div class="flex items-center gap-2"><span class="font-medium text-highlighted">{{row.original.nickname}}</span><UBadge v-if="row.original.id===session?.id" size="sm" variant="subtle">本人</UBadge></div><p class="mt-1 text-xs text-muted">{{row.original.username}}</p></div></div></template>
    <template #phone-cell="{row}">{{row.original.phone||'—'}}</template>
    <template #role-cell="{row}">{{row.original.role.name}}<span v-if="!row.original.role.enabled" class="ml-1 text-xs text-warning">角色已停用</span></template>
    <template #status-cell="{row}"><USwitch :model-value="row.original.enabled" :disabled="!row.original.editable||saving" :aria-label="row.original.username+' 管理员状态'" @update:model-value="toggleTarget=row.original;toggleOpen=true"/></template>
    <template #created-cell="{row}"><span class="text-xs text-muted">{{dateTime(row.original.createdAt)}}</span></template>
    <template #actions-cell="{row}"><template v-if="row.original.editable"><UButton class="px-0" size="sm" variant="link" @click="open('edit',row.original)">编辑</UButton><UButton class="px-0" size="sm" variant="link" @click="open('password',row.original)">重置密码</UButton></template><UButton v-else-if="row.original.id===session?.id" class="px-0" size="sm" variant="link" to="/admin/profile">个人资料</UButton><span v-else class="text-xs text-muted">{{row.original.role.systemCode?'内置账号':'只读'}}</span></template>
  </ConsoleDataTable>
  <UModal v-model:open="modal" :title="mode==='create'?'新增管理员':mode==='password'?'重置密码':'编辑管理员'" :description="mode==='password'?'重置后，该管理员所有登录会话将失效。':'管理平台工作人员，权限由所属角色决定。'" :dismissible="!saving&&!imageBusy" :close="!saving&&!imageBusy" :ui="{content:'sm:max-w-xl max-h-[85dvh]',body:'overflow-y-auto'}"><template #body><form id="administrator-form" novalidate class="space-y-5" @submit.prevent="save">
    <UFormField label="登录账号" required><ConsoleInput v-model="form.username" :disabled="saving||mode!=='create'" autocomplete="off" required pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}" :maxlength="32"/></UFormField>
    <template v-if="mode!=='password'"><UFormField label="头像"><AccountImageInput v-model="form.avatar" label="头像" :fallback="site?.platform.defaultAvatar||'/brand/admin-avatar.png'" :disabled="saving" @busy="imageBusy=$event"/></UFormField><div class="grid gap-4 sm:grid-cols-2"><UFormField label="名称" required><ConsoleInput v-model="form.nickname" :maxlength="32" :disabled="saving" required/></UFormField><UFormField label="手机号"><ConsoleInput v-model="form.phone" type="tel" :maxlength="32" :disabled="saving"/></UFormField></div>
      <UFormField label="所属角色" required help="仅可选择权限不超过自己的已启用自定义平台角色。"><USelectMenu v-model="form.roleId" v-model:search-term="roleSearch" :items="roleOptions" value-key="value" ignore-filter :loading="roleBusy" :disabled="saving" class="w-full" placeholder="搜索并选择角色" aria-label="所属角色"/></UFormField><p v-if="!roleBusy&&!roleError&&!roleOptions.length" class="text-xs text-muted">暂无可分配角色，请先在「角色」中创建并启用自定义角色。</p><p v-if="roleTotal>50" class="text-xs text-muted">匹配 {{roleTotal}} 个角色，请输入名称缩小范围。</p><UAlert v-if="roleError" :title="roleError" color="error"><template #actions><UButton size="sm" color="neutral" variant="outline" @click="lookupRoles">重试</UButton></template></UAlert>
    </template>
    <template v-if="mode!=='edit'"><UFormField :label="mode==='create'?'初始密码':'新密码'" required><ConsoleInput v-model="form.password" :type="showPassword?'text':'password'" autocomplete="new-password" required :minlength="6" :maxlength="128" :disabled="saving"><template #trailing><UButton type="button" color="neutral" variant="ghost" size="xs" :icon="showPassword?'i-lucide-eye-off':'i-lucide-eye'" :aria-label="showPassword?'隐藏密码':'显示密码'" @click="showPassword=!showPassword"/></template></ConsoleInput></UFormField><UFormField label="确认密码" required><ConsoleInput v-model="form.confirmPassword" type="password" autocomplete="new-password" required :disabled="saving"/></UFormField></template>
    <template v-if="mode!=='password'"><USwitch v-model="form.allowMultipleSessions" label="允许多处同时登录" :disabled="saving"/><USwitch v-model="form.enabled" label="启用管理员" :disabled="saving"/><p v-if="mode==='edit'" class="text-xs text-muted">保存修改会撤销该账号的原有登录会话。</p></template><UAlert v-if="formError" :title="formError" color="error"/>
  </form></template><template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" :disabled="saving||imageBusy" @click="modal=false">取消</UButton><UButton type="submit" form="administrator-form" :loading="saving" :disabled="imageBusy||mode!=='password'&&(roleBusy||!!roleError||!form.roleId)">{{mode==='create'?'创建管理员':mode==='password'?'确认重置':'保存修改'}}</UButton></ConsoleFormActions></template></UModal>
  <ConsoleActionConfirmationDialog v-model:open="toggleOpen" :title="toggleTarget?.enabled?'停用管理员？':'启用管理员？'" :subject="toggleTarget?.username" description="状态修改后，该账号的现有登录与代登录会话将失效。" :confirm-label="toggleTarget?.enabled?'停用':'启用'" :color="toggleTarget?.enabled?'error':'primary'" :loading="saving" @confirm="toggle"/>
</div></AdminConsole></template>
