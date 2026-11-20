<script setup lang="ts">
import AdminConsole from '../../components/console/AdminConsole.vue'
import ConsoleDrawer from '../../components/console/ConsoleDrawer.vue'
import ConsoleQueryButton from '../../components/console/ConsoleQueryButton.vue'
import ConsoleDiscardChangesDialog from '../../components/console/ConsoleDiscardChangesDialog.vue'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsoleListFilters from '@orangezh1/qisvc-console-ui/components/ConsoleListFilters'
import ConsoleListSearch from '@orangezh1/qisvc-console-ui/components/ConsoleListSearch'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import ConsoleActionConfirmationDialog from '@orangezh1/qisvc-console-ui/components/ConsoleActionConfirmationDialog'
import {dateTime} from '../../utils/update-center'
definePageMeta({layout:'tenant',key:route=>route.path})
type Role={id:string;name:string;permissions:string[];enabled:boolean;version:number;userCount:number;editable:boolean;createdAt:string}
type Permission={key:string;label:string;group:string;grantable:boolean}
type Listing={items:Role[];total:number;catalog:Permission[];canWrite:boolean}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/roles',toast=useToast()
if(!auth.session.value?.permissions.includes('tenant:roles.read'))throw createError({statusCode:403,statusMessage:'没有角色访问权限'})
const q=ref(''),search=ref(''),status=ref('all'),appliedStatus=ref('all'),page=ref(1),pageSize=ref(20),loadAction=ref(''),mutation=ref(''),error=ref('')
const params=()=>new URLSearchParams({q:search.value,status:appliedStatus.value,page:String(page.value),pageSize:String(pageSize.value)})
const initial=await useAsyncData('tenant-roles:'+auth.session.value.id+':'+tenantId,(_nuxt,{signal})=>auth.api<Listing>(endpoint+'?'+params(),'GET',undefined,{signal}))
const rows=ref<Listing>(initial.data.value??{items:[],total:0,catalog:[],canWrite:false});error.value=initial.error.value?.message||''
const columns=[{accessorKey:'name',header:'角色名称'},{id:'permissions',header:'功能权限'},{accessorKey:'userCount',header:'关联管理员'},{id:'status',header:'状态'},{id:'created',header:'创建时间'},{id:'actions',header:'操作'}]
const editing=ref<Role|null>(null),editorOpen=ref(false),readonly=ref(false),formError=ref(''),requestId=ref(''),form=reactive({name:'',permissions:[] as string[],enabled:true}),baseline=ref('')
const dirty=computed(()=>editorOpen.value&&!readonly.value&&JSON.stringify(form)!==baseline.value),discard=useDiscardChanges(()=>!!mutation.value)
const available=computed(()=>rows.value.catalog.filter(p=>p.grantable)),groups=computed(()=>[...new Set(rows.value.catalog.map(p=>p.group))].map(name=>({name,items:rows.value.catalog.filter(p=>p.group===name)})))
const confirmOpen=ref(false),target=ref<Role|null>(null),operation=ref<'toggle'|'delete'>('toggle')
const lifetime=new AbortController();let disposed=false,sequence=0,controller:AbortController|undefined
async function load(source='refresh'){
 controller?.abort();controller=new AbortController();const seq=++sequence;loadAction.value=source
 try{const value=await auth.api<Listing>(endpoint+'?'+params(),'GET',undefined,{signal:AbortSignal.any([lifetime.signal,controller.signal])});if(!disposed&&seq===sequence){rows.value=value;error.value=''}}catch(e:any){if(!disposed&&seq===sequence)error.value=e.message}finally{if(!disposed&&seq===sequence)loadAction.value=''}
}
function guard(action:()=>void){if(mutation.value)return;if(dirty.value)discard.request(action);else action()}
function refresh(){guard(()=>{editorOpen.value=false;void load('refresh')})}
function filter(source:'search'|'reset'){if(source==='reset'){q.value='';status.value='all'}search.value=q.value.trim();appliedStatus.value=status.value;page.value=1;void load(source)}
function open(row:Role|null,view=false){editing.value=row;readonly.value=view;formError.value='';requestId.value=crypto.randomUUID();Object.assign(form,{name:row?.name||'',permissions:[...(row?.permissions||[])],enabled:row?.enabled??true});baseline.value=JSON.stringify(form);editorOpen.value=true}
function state(items:Permission[]):boolean|'indeterminate'{const count=items.filter(p=>form.permissions.includes(p.key)).length;return count===0?false:count===items.length?true:'indeterminate'}
function select(items:Permission[],value:boolean|'indeterminate'){
 const keys=items.filter(p=>p.grantable).map(p=>p.key),selected=new Set(form.permissions)
 for(const key of keys){if(value===true){selected.add(key);const read=key.replace(/\.(write|manage)$/,'.read');if(rows.value.catalog.some(p=>p.key===read&&p.grantable))selected.add(read)}else{selected.delete(key);if(key.endsWith('.read'))for(const suffix of ['write','manage'])selected.delete(key.replace(/read$/,suffix))}}
 form.permissions=[...selected].sort()
}
async function save(){if(mutation.value||readonly.value)return;mutation.value='save';formError.value='';try{await auth.api(endpoint+(editing.value?'/'+editing.value.id:''),editing.value?'PUT':'POST',{...form,...(editing.value?{version:editing.value.version}:{requestId:requestId.value})},{signal:lifetime.signal});if(!disposed){editorOpen.value=false;toast.add({title:'角色已保存',color:'success'});await load('mutation')}}catch(e:any){if(!disposed)formError.value=e.message}finally{if(!disposed)mutation.value=''}}
function ask(row:Role,action:'toggle'|'delete'){target.value=row;operation.value=action;confirmOpen.value=true}
async function confirm(){const row=target.value;if(!row||mutation.value)return;mutation.value='confirm';try{await auth.api(endpoint+'/'+row.id,operation.value==='delete'?'DELETE':'PUT',operation.value==='delete'?{version:row.version}:{name:row.name,permissions:row.permissions,enabled:!row.enabled,version:row.version},{signal:lifetime.signal});if(!disposed){confirmOpen.value=false;toast.add({title:operation.value==='delete'?'角色已删除':'角色状态已更新',color:'success'});await load('mutation')}}catch(e:any){if(!disposed)toast.add({title:e.message,color:'error'})}finally{if(!disposed)mutation.value=''}}
onBeforeRouteLeave(to=>{if(mutation.value)return false;if(dirty.value){discard.request(()=>{editorOpen.value=false;void navigateTo(to.fullPath)});return false}})
function beforeUnload(event:BeforeUnloadEvent){if(dirty.value||mutation.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>window.addEventListener('beforeunload',beforeUnload));onBeforeUnmount(()=>{disposed=true;sequence++;controller?.abort();lifetime.abort();if(import.meta.client)window.removeEventListener('beforeunload',beforeUnload)})
</script>
<template><AdminConsole :refreshing="loadAction==='refresh'" @refresh="refresh"><div class="space-y-5">
 <ConsolePageHeading title="角色"><template #actions><UButton v-if="rows.canWrite" icon="i-lucide-plus" :disabled="!!error||!!mutation" @click="open(null)">新增角色</UButton></template></ConsolePageHeading>
 <form @submit.prevent="filter('search')"><ConsoleListFilters><ConsoleListSearch v-model="q" placeholder="搜索角色名称"/><USelect v-model="status" :items="[{label:'全部状态',value:'all'},{label:'启用',value:'enabled'},{label:'停用',value:'disabled'}]" aria-label="角色状态筛选"/><div class="flex shrink-0 items-center gap-3"><ConsoleQueryButton type="submit" :loading="loadAction==='search'">查询</ConsoleQueryButton><ConsoleQueryButton kind="reset" color="neutral" variant="outline" :loading="loadAction==='reset'" @click="filter('reset')">重置</ConsoleQueryButton></div></ConsoleListFilters></form>
 <ConsoleDataTable :data="rows.items" :columns="columns" :error="error" :page="page" :page-size="pageSize" :total="rows.total" :client-pagination="false" empty-title="暂无角色" empty-description="按工作职责创建角色，再分配给本站管理员。" @retry="load('retry')" @update:page="page=$event;load('page')" @update:page-size="pageSize=$event;page=1;load('page')">
  <template #name-cell="{row}"><span class="font-medium text-highlighted">{{row.original.name}}</span></template><template #permissions-cell="{row}">{{row.original.permissions.length}} 项权限</template>
  <template #status-cell="{row}"><UBadge :color="row.original.enabled?'success':'neutral'" variant="subtle">{{row.original.enabled?'启用':'停用'}}</UBadge></template><template #created-cell="{row}"><span class="text-xs text-muted">{{dateTime(row.original.createdAt)}}</span></template>
  <template #actions-cell="{row}"><div class="flex gap-3"><UButton class="px-0" variant="link" size="sm" @click="open(row.original,true)">详情</UButton><template v-if="row.original.editable"><UButton class="px-0" variant="link" size="sm" @click="open(row.original)">编辑</UButton><UButton class="px-0" variant="link" size="sm" :color="row.original.enabled?'error':'primary'" @click="ask(row.original,'toggle')">{{row.original.enabled?'停用':'启用'}}</UButton><UButton class="px-0" variant="link" size="sm" color="error" @click="ask(row.original,'delete')">删除</UButton></template></div></template>
 </ConsoleDataTable>
 <ConsoleDrawer :open="editorOpen" :title="readonly?'角色详情':editing?'编辑角色':'新增角色'" :dismissible="!mutation" :close="!mutation" wide @update:open="!$event&&guard(()=>editorOpen=false)"><template #body><form id="tenant-role-form" class="space-y-6" @submit.prevent="save">
  <ConsoleSettingsField label="角色名称" required><ConsoleInput v-model="form.name" aria-label="角色名称" required :maxlength="50" :disabled="!!mutation||readonly" placeholder="例如：运营人员"/></ConsoleSettingsField>
  <div class="flex items-center justify-between border-y border-default py-4"><UCheckbox v-if="!readonly" label="全选可授予权限" :model-value="state(available)" :disabled="!!mutation" @update:model-value="select(available,$event)"/><span class="text-sm text-muted">已选 {{form.permissions.length}} 项</span></div>
  <section v-for="group in groups" :key="group.name" class="space-y-4 border-b border-default pb-5"><h3 v-if="readonly" class="drawer-section-title">{{group.name}}</h3><UCheckbox v-else :label="group.name+'（全选）'" :model-value="state(group.items.filter(p=>p.grantable))" :disabled="!!mutation||!group.items.some(p=>p.grantable)" @update:model-value="select(group.items,$event)"/><div class="grid gap-3 sm:grid-cols-2"><UCheckbox v-for="item in group.items" :key="item.key" :label="item.label" :model-value="form.permissions.includes(item.key)" :disabled="!!mutation||readonly||!item.grantable" @update:model-value="select([item],$event)"/></div></section>
  <p v-for="key in form.permissions.filter(key=>!rows.catalog.some(p=>p.key===key))" :key="key" class="text-sm text-muted">{{key}}（当前不可授予）</p>
  <ConsoleSettingsField label="状态"><USwitch v-model="form.enabled" label="启用角色" :disabled="!!mutation||readonly"/></ConsoleSettingsField><p v-if="editing&&!readonly" class="text-xs text-muted">修改权限或状态后，关联管理员需重新登录。</p><UAlert v-if="formError" color="error" :title="formError"/>
 </form></template><template #footer><ConsoleFormActions class="w-full"><UButton color="neutral" variant="outline" :disabled="!!mutation" @click="guard(()=>editorOpen=false)">{{readonly?'关闭':'取消'}}</UButton><UButton v-if="!readonly" type="submit" form="tenant-role-form" :loading="mutation==='save'">{{editing?'保存修改':'创建角色'}}</UButton></ConsoleFormActions></template></ConsoleDrawer>
 <ConsoleActionConfirmationDialog v-model:open="confirmOpen" :title="operation==='delete'?'删除角色？':target?.enabled?'停用角色？':'启用角色？'" :subject="target?.name" :description="operation==='delete'?'有关联管理员的角色不能删除，请先调整管理员角色。':'状态变更后，关联管理员需重新登录。'" :confirm-label="operation==='delete'?'删除':target?.enabled?'停用':'启用'" :color="operation==='delete'||target?.enabled?'error':'primary'" :loading="mutation==='confirm'" @confirm="confirm"/>
 <ConsoleDiscardChangesDialog :controller="discard"/>
</div></AdminConsole></template>
