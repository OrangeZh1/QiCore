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
import AdminConsole from '../../components/console/AdminConsole.vue'
definePageMeta({layout:'admin'})
type Role={id:string;name:string;permissions:string[];systemCode:string|null;enabled:boolean;version:number;userCount:number;editable:boolean}
type Permission={key:string;label:string;group:string;grantable:boolean}
type Listing={items:Role[];total:number;catalog:Permission[]}
const auth=useApi(),toast=useToast(),session=await auth.restore()
if(!session)await navigateTo('/admin/login',{replace:true})
else if(session.role!=='root'||!session.permissions.includes('roles.read'))throw createError({statusCode:403,statusMessage:'没有角色访问权限'})
const q=ref(''),search=ref(''),status=ref('all'),page=ref(1),pageSize=ref(20),busy=ref(false),error=ref(''),saving=ref(false),formOpen=ref(false),editing=ref<Role|null>(null),detail=ref<Role|null>(null),detailOpen=ref(false),toggleTarget=ref<Role|null>(null),toggleOpen=ref(false),formError=ref(''),requestId=ref('')
const params=()=>new URLSearchParams({q:search.value,status:status.value,page:String(page.value),pageSize:String(pageSize.value)})
const initial=await useAsyncData('platform-role-list',()=>auth.api<Listing>('/admin/roles?'+params()))
const rows=ref<Listing>(initial.data.value??{items:[],total:0,catalog:[]});if(initial.error.value)error.value='角色读取失败，请刷新重试'
const canWrite=computed(()=>!!auth.session.value?.permissions.includes('roles.write')),available=computed(()=>rows.value.catalog.filter(p=>p.grantable)),groups=computed(()=>[...new Set(available.value.map(p=>p.group))].map(name=>({name,items:available.value.filter(p=>p.group===name)})))
const columns=[{accessorKey:'name',header:'角色名称'},{id:'type',header:'类型'},{id:'permissions',header:'功能权限'},{accessorKey:'userCount',header:'关联管理员'},{id:'status',header:'状态'},{id:'actions',header:'操作'}]
const form=reactive({name:'',permissions:[] as string[],enabled:true})
const permissionName=(key:string)=>rows.value.catalog.find(p=>p.key===key)?.label||key
let sequence=0
onBeforeUnmount(()=>{sequence++})
async function load(source:typeof loadAction.value='refresh'){const seq=++sequence;loadAction.value=source;busy.value=true;error.value='';try{const result=await auth.api<Listing>('/admin/roles?'+params());if(seq===sequence)rows.value=result}catch(e){if(seq===sequence)error.value=e instanceof Error?e.message:'读取失败'}finally{if(seq===sequence)busy.value=false}}
function filter(source:'search'|'reset'='search'){search.value=q.value.trim();page.value=1;void load(source)}
function open(role:Role|null){editing.value=role;formError.value='';requestId.value=crypto.randomUUID();Object.assign(form,{name:role?.name??'',permissions:[...(role?.permissions??[])],enabled:role?.enabled??true});formOpen.value=true}
function state(items:Permission[]):boolean|'indeterminate'{const count=items.filter(p=>form.permissions.includes(p.key)).length;return count===0?false:count===items.length?true:'indeterminate'}
function select(items:Permission[],value:boolean|'indeterminate'){const keys=items.map(p=>p.key);form.permissions=value===true?[...new Set([...form.permissions,...keys])]:form.permissions.filter(k=>!keys.includes(k))}
async function save(){if(saving.value)return;saving.value=true;formError.value='';try{await auth.api(editing.value?'/admin/roles/'+editing.value.id:'/admin/roles',editing.value?'PUT':'POST',{...form,...(editing.value?{version:editing.value.version}:{requestId:requestId.value})});formOpen.value=false;toast.add({title:editing.value?'角色已修改，关联管理员需重新登录':'角色已创建',color:'success'});await load('mutation')}catch(e){formError.value=e instanceof Error?e.message:'保存失败'}finally{saving.value=false}}
async function toggle(){const role=toggleTarget.value;if(!role||saving.value)return;saving.value=true;try{await auth.api('/admin/roles/'+role.id,'PUT',{name:role.name,permissions:role.permissions,enabled:!role.enabled,version:role.version});toggleOpen.value=false;toast.add({title:role.enabled?'角色已停用':'角色已启用',color:'success'});await load('mutation')}catch(e){toast.add({title:e instanceof Error?e.message:'操作失败',color:'error'})}finally{saving.value=false}}
</script>
<template><AdminConsole :refreshing="busy&&loadAction==='refresh'" @refresh="load('refresh')"><div class="space-y-5">
  <ConsolePageHeading title="角色"><template #actions><UButton v-if="canWrite" icon="i-lucide-plus" :disabled="!!error" @click="open(null)">新增角色</UButton></template></ConsolePageHeading>
  <form @submit.prevent="filter('search')"><ConsoleListFilters><ConsoleListSearch v-model="q" placeholder="搜索角色名称"/><USelect v-model="status" :items="[{label:'全部状态',value:'all'},{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]" aria-label="角色状态筛选"/><div class="flex shrink-0 items-center gap-3"><ConsoleQueryButton type="submit" :loading="busy&&loadAction==='search'">查询</ConsoleQueryButton><ConsoleQueryButton kind="reset" color="neutral" variant="outline" :loading="busy&&loadAction==='reset'" @click="q='';status='all';filter('reset')">重置</ConsoleQueryButton></div></ConsoleListFilters></form>
  <ConsoleDataTable :data="rows.items" :columns="columns" :error="error" :page="page" :page-size="pageSize" :total="rows.total" :client-pagination="false" empty-title="暂无角色" empty-description="按工作职责创建角色，再分配给管理员。" @retry="load('retry')" @update:page="page=$event;load('page')" @update:page-size="pageSize=$event;page=1;load('page')">
    <template #name-cell="{row}"><span class="font-medium text-highlighted">{{row.original.name}}</span></template>
    <template #type-cell="{row}"><UBadge :color="row.original.systemCode?'neutral':'primary'" variant="subtle">{{row.original.systemCode?'内置':'自定义'}}</UBadge></template>
    <template #permissions-cell="{row}">{{row.original.permissions.length}} 项权限</template>
    <template #status-cell="{row}"><UBadge :color="row.original.enabled?'success':'neutral'" variant="subtle">{{row.original.enabled?'启用':'停用'}}</UBadge></template>
    <template #actions-cell="{row}"><UButton class="px-0" variant="link" size="sm" @click="detail=row.original;detailOpen=true">详情</UButton><UButton v-if="row.original.editable" class="px-0" variant="link" size="sm" @click="open(row.original)">编辑</UButton><UButton v-if="row.original.editable" class="px-0" variant="link" size="sm" :color="row.original.enabled?'error':'primary'" @click="toggleTarget=row.original;toggleOpen=true">{{row.original.enabled?'停用':'启用'}}</UButton></template>
  </ConsoleDataTable>
  <UModal v-model:open="formOpen" :title="editing?'编辑角色':'新增角色'" description="仅可授予当前账号已有的权限，新角色默认不勾选权限。" :dismissible="!saving" :close="!saving" :ui="{content:'sm:max-w-2xl max-h-[85dvh]',body:'overflow-y-auto'}"><template #body><form id="role-form" class="space-y-5" @submit.prevent="save">
    <UFormField label="角色名称" required><ConsoleInput v-model="form.name" required :maxlength="50" :disabled="saving" placeholder="例如：平台运营"/></UFormField>
    <div class="flex items-center justify-between rounded-lg bg-elevated/50 p-3"><UCheckbox label="全选权限" :model-value="state(available)" :disabled="saving" @update:model-value="select(available,$event)"/><span class="text-xs text-muted">已选 {{form.permissions.length}} 项</span></div>
    <section v-for="group in groups" :key="group.name" class="rounded-lg border border-default p-4"><UCheckbox :label="group.name+'（全选）'" :model-value="state(group.items)" :disabled="saving" @update:model-value="select(group.items,$event)"/><div class="mt-3 grid gap-3 sm:grid-cols-2"><UCheckbox v-for="item in group.items" :key="item.key" :label="item.label" :model-value="form.permissions.includes(item.key)" :disabled="saving" @update:model-value="select([item],$event)"/></div></section>
    <USwitch v-model="form.enabled" label="启用角色" :disabled="saving"/><p v-if="editing" class="text-xs leading-6 text-muted">保存修改后，关联管理员的现有登录会话失效。</p><UAlert v-if="formError" color="error" :title="formError"/>
  </form></template><template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" :disabled="saving" @click="formOpen=false">取消</UButton><UButton type="submit" form="role-form" :loading="saving">{{editing?'保存修改':'创建角色'}}</UButton></ConsoleFormActions></template></UModal>
  <UModal v-model:open="detailOpen" title="角色详情" description="查看当前角色的功能权限。" :ui="{content:'sm:max-w-xl'}"><template #body><div v-if="detail" class="space-y-5"><div class="flex items-center gap-3"><h3 class="font-semibold">{{detail.name}}</h3><UBadge :color="detail.enabled?'success':'neutral'" variant="subtle">{{detail.enabled?'启用':'停用'}}</UBadge></div><p class="text-sm text-muted">关联管理员：{{detail.userCount}} 人{{detail.systemCode?' · 内置角色受保护':''}}</p><div class="flex flex-wrap gap-2"><UBadge v-for="key in detail.permissions" :key="key" color="neutral" variant="subtle">{{permissionName(key)}}</UBadge><p v-if="!detail.permissions.length" class="text-sm text-muted">未配置功能权限</p></div></div></template><template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" @click="detailOpen=false">关闭</UButton></ConsoleFormActions></template></UModal>
  <ConsoleActionConfirmationDialog v-model:open="toggleOpen" :title="toggleTarget?.enabled?'停用角色？':'启用角色？'" :subject="toggleTarget?.name" description="状态变更会使关联管理员的现有登录会话失效。" :confirm-label="toggleTarget?.enabled?'停用角色':'启用角色'" :color="toggleTarget?.enabled?'error':'primary'" :loading="saving" @confirm="toggle"/>
</div></AdminConsole></template>
