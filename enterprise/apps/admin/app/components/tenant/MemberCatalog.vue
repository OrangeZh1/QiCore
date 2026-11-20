<script setup lang="ts">
import AdminConsole from '../console/AdminConsole.vue'
import ConsoleDrawer from '../console/ConsoleDrawer.vue'
import ConsoleQueryButton from '../console/ConsoleQueryButton.vue'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsoleListFilters from '@orangezh1/qisvc-console-ui/components/ConsoleListFilters'
import ConsoleListSearch from '@orangezh1/qisvc-console-ui/components/ConsoleListSearch'
import ConsoleSettingsField from '@orangezh1/qisvc-console-ui/components/ConsoleSettingsField'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import {dateTime} from '../../utils/update-center'
const props=defineProps<{kind:'levels'|'tags'}>(),isLevel=props.kind==='levels',title=isLevel?'会员等级':'会员标签',noun=isLevel?'等级':'标签'
type Row={id:string;name:string;benefits?:Record<string,number>;threshold?:number;rank:number;upgradeMode:'all'|'any';conditions:{growth?:number;paidCents?:string;paidOrders?:number}|null;description:string;version:number;memberCount:number;updatedAt:string|null}
type BenefitDefinition={key:string;label:string;unit:string;scale:number;min:number;max:number;step:number;defaultValue:number;help:string}
type View={benefitDefinitions?:BenefitDefinition[];applicationKey:string|null;applications:{key:string;name:string}[];canWrite:boolean;items:Row[];total:number;page:number;pageSize:number;rule:{registrationGrowth:number;purchaseGrowthPerYuan?:number;version:number}}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/member-'+props.kind,toast=useToast()
const q=ref(''),search=ref(''),page=ref(1),pageSize=ref(20),applicationKey=ref(''),action=ref(''),mutation=ref(''),selected=ref<(string|number)[]>([])
const params=()=>new URLSearchParams({q:search.value,page:String(page.value),pageSize:String(pageSize.value),...(applicationKey.value?{applicationKey:applicationKey.value}:{})})
const initial=await useAsyncData('member-'+props.kind+':'+auth.session.value?.id+':'+tenantId,(_,{signal})=>auth.api<View>(endpoint+'?'+params(),'GET',undefined,{signal}))
const data=ref<View>(initial.data.value||{applicationKey:null,applications:[],canWrite:false,items:[],total:0,page:1,pageSize:20,rule:{registrationGrowth:0,version:0}}),error=ref(initial.error.value?.message||'')
applicationKey.value=data.value.applicationKey||''
const columns=[{accessorKey:'name',header:noun+'名称'},...(isLevel?[{accessorKey:'rank',header:'等级序号'},{id:'conditions',header:'升级条件'},{id:'benefits',header:'会员权益'}]:[]),{accessorKey:'memberCount',header:'关联用户'},{accessorKey:'description',header:'备注'},{accessorKey:'updatedAt',header:'修改时间'},{id:'actions',header:'操作'}]
const editor=ref(false),editing=ref<Row|null>(null),targetId=ref(''),form=reactive({name:'',description:'',autoUpgrade:true,threshold:'0',rank:'',upgradeMode:'all',growthEnabled:true,spendEnabled:false,ordersEnabled:false,paidAmount:'',paidOrders:'',benefits:{} as Record<string,string>}),baseline=ref(''),formError=ref('')
const rulesOpen=ref(false),registrationGrowth=ref('0'),purchaseGrowthPerYuan=ref('0'),ruleError=ref(''),ruleBaseline=ref(''),ruleVersion=ref(0)
const ruleState=()=>JSON.stringify([registrationGrowth.value,purchaseGrowthPerYuan.value])
const deleteRows=ref<Row[]>([]),deleteOpen=ref(false),deleteError=ref(''),dirty=computed(()=>editor.value&&JSON.stringify(form)!==baseline.value||rulesOpen.value&&ruleState()!==ruleBaseline.value)
const enabledConditions=computed(()=>Number(form.growthEnabled)+Number(form.spendEnabled)+Number(form.ordersEnabled))
const discard=useDiscardChanges(()=>!!mutation.value),lifetime=new AbortController();let disposed=false,sequence=0,request:AbortController|undefined
async function load(source='refresh',key=applicationKey.value){
 if(mutation.value&&source!=='mutation')return
 if(dirty.value){discard.request(()=>{editor.value=false;rulesOpen.value=false;void load(source,key)});return}
 request?.abort();request=new AbortController();const current=++sequence;action.value=source;applicationKey.value=key
 try{const value=await auth.api<View>(endpoint+'?'+params(),'GET',undefined,{signal:AbortSignal.any([lifetime.signal,request.signal])});if(!disposed&&current===sequence){data.value=value;applicationKey.value=value.applicationKey||'';page.value=value.page;selected.value=[];error.value=''}}catch(e:any){if(!disposed&&current===sequence)error.value=e.message}finally{if(!disposed&&current===sequence)action.value=''}
}
function filter(source:'search'|'reset'){if(source==='reset')q.value='';search.value=q.value.trim();page.value=1;void load(source)}
function setPage(value:number){if(page.value===value)return;page.value=value;void load('page')}
function setPageSize(value:number){pageSize.value=value;page.value=1;void load('page')}
function formatAmount(cents:string){const n=BigInt(cents);return (n/100n).toString()+'.'+(n%100n).toString().padStart(2,'0')}
function parseAmount(value:string){if(!/^(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,2})?$/.test(value))return '';const [whole,fraction='']=value.split('.'),cents=BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));return cents>0n&&cents<1000000000000000n?cents.toString():''}
function conditionText(row:Row){if(row.id==='default')return '默认等级，无需升级';const c=row.conditions||{growth:row.threshold},parts=[];if(c.growth!==undefined)parts.push('成长值 ≥ '+c.growth);if(c.paidCents)parts.push('累计实付 ≥ '+formatAmount(c.paidCents)+' 元');if(c.paidOrders)parts.push('有效订单 ≥ '+c.paidOrders+' 笔');return parts.join(row.upgradeMode==='any'?' 或 ':' 且 ')||'手动设置，未开启自动升级'}
function open(row:Row|null=null){editing.value=row;targetId.value=row?.id||crypto.randomUUID();Object.assign(form,{name:row?.name||'',description:row?.description||'',autoUpgrade:!row?.conditions||Object.keys(row.conditions).length>0,threshold:String(row?.conditions?.growth??row?.threshold??0),rank:row?String(row.rank):'',upgradeMode:row?.upgradeMode||'all',growthEnabled:!row?.conditions||!Object.keys(row.conditions).length||row.conditions.growth!==undefined,spendEnabled:row?.conditions?.paidCents!==undefined,ordersEnabled:row?.conditions?.paidOrders!==undefined,paidAmount:row?.conditions?.paidCents?formatAmount(row.conditions.paidCents):'',paidOrders:row?.conditions?.paidOrders?String(row.conditions.paidOrders):'',benefits:Object.fromEntries((data.value.benefitDefinitions||[]).map(d=>[d.key,String((row?.benefits?.[d.key]??d.defaultValue)/d.scale)]))});baseline.value=JSON.stringify(form);formError.value='';editor.value=true}
function close(){if(mutation.value)return;if(dirty.value)discard.request(()=>{editor.value=false;rulesOpen.value=false});else{editor.value=false;rulesOpen.value=false}}
async function save(){
 if(mutation.value||!data.value.canWrite)return
 const threshold=Number(form.threshold),rank=Number(form.rank),orderCount=Number(form.paidOrders),paidCents=parseAmount(form.paidAmount)
 if(!form.name.trim()){formError.value='请填写名称';return}
 if(isLevel&&editing.value?.id!=='default'&&(!/^\d+$/.test(form.rank)||rank>2147483647)){formError.value='请填写有效的等级序号';return}
 if(isLevel&&form.autoUpgrade&&(!enabledConditions.value||form.growthEnabled&&(!/^\d+$/.test(form.threshold)||threshold>2147483647)||form.spendEnabled&&!paidCents||form.ordersEnabled&&(!/^\d+$/.test(form.paidOrders)||orderCount<1||orderCount>2147483647))){formError.value='请选择至少一个有效升级条件，金额最多两位小数';return}
 const benefits:Record<string,number>={};
 for(const d of data.value.benefitDefinitions||[]){const value=form.benefits[d.key]||'';if(!/^(?:0|[1-9][0-9]{0,2})(?:\.[0-9])?$/.test(value)||Number(value)<d.min||Number(value)>d.max){formError.value='请填写有效的'+d.label;return}const [whole,decimal='0']=value.split('.');benefits[d.key]=Number(BigInt(whole!)*BigInt(d.scale)+BigInt(decimal)*BigInt(d.scale)/10n)}
 const conditions=form.autoUpgrade?{...(form.growthEnabled?{growth:threshold}:{}),...(form.spendEnabled?{paidCents}:{}),...(form.ordersEnabled?{paidOrders:orderCount}:{})}:{}
 mutation.value='save';formError.value=''
 try{await auth.api(endpoint+'/'+encodeURIComponent(applicationKey.value)+'/'+targetId.value,'PUT',{version:editing.value?.version||0,name:form.name.trim(),description:form.description.trim(),...(isLevel?{rank,upgradeMode:form.upgradeMode,conditions,benefits}:{})},{signal:lifetime.signal});if(!disposed){editor.value=false;toast.add({title:noun+'已保存',color:'success'});await load('mutation')}}catch(e:any){if(!disposed)formError.value=e.message}finally{if(!disposed)mutation.value=''}
}
function openRules(){registrationGrowth.value=String(data.value.rule.registrationGrowth);purchaseGrowthPerYuan.value=String(data.value.rule.purchaseGrowthPerYuan||0);ruleBaseline.value=ruleState();ruleVersion.value=data.value.rule.version;ruleError.value='';rulesOpen.value=true}
async function saveRules(){
 if(mutation.value||!data.value.canWrite)return;const growth=Number(registrationGrowth.value),perYuan=Number(purchaseGrowthPerYuan.value);if([registrationGrowth.value,purchaseGrowthPerYuan.value].some(v=>!/^\d+$/.test(v)||Number(v)>2147483647)){ruleError.value='请输入 0–2147483647 的整数';return}mutation.value='rules';ruleError.value=''
 try{await auth.api(endpoint+'/'+encodeURIComponent(applicationKey.value)+'/rules','PUT',{version:ruleVersion.value,registrationGrowth:growth,purchaseGrowthPerYuan:perYuan},{signal:lifetime.signal});if(!disposed){rulesOpen.value=false;toast.add({title:'成长规则已保存',color:'success'});await load('mutation')}}catch(e:any){if(!disposed)ruleError.value=e.message}finally{if(!disposed)mutation.value=''}
}
function askDelete(row?:Row){deleteRows.value=(row?[row]:data.value.items.filter(r=>selected.value.includes(r.id)));if(!deleteRows.value.length)return;deleteError.value='';deleteOpen.value=true}
async function remove(){if(mutation.value)return;mutation.value='delete';deleteError.value='';try{await auth.api(endpoint+'/'+encodeURIComponent(applicationKey.value)+'/delete','POST',{items:deleteRows.value.map(r=>({id:r.id,version:r.version}))},{signal:lifetime.signal});if(!disposed){deleteOpen.value=false;await load('mutation')}}catch(e:any){if(!disposed)deleteError.value=e.message}finally{if(!disposed)mutation.value=''}}
function unload(event:BeforeUnloadEvent){if(dirty.value||mutation.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>window.addEventListener('beforeunload',unload))
onBeforeRouteLeave(to=>{if(mutation.value)return false;if(dirty.value){discard.request(()=>{editor.value=false;rulesOpen.value=false;void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{disposed=true;sequence++;request?.abort();lifetime.abort();window.removeEventListener('beforeunload',unload)})
</script>

<template><AdminConsole :refreshing="action==='refresh'" @refresh="load()"><div class="space-y-5">
 <ConsolePageHeading :title="title"><template #actions><UButton v-if="isLevel" color="neutral" variant="outline" icon="i-lucide-settings" :disabled="!data.applicationKey||!!mutation" @click="openRules">成长规则</UButton><UButton v-if="data.canWrite" icon="i-lucide-plus" :disabled="!data.applicationKey||!!mutation" @click="open()">新建{{noun}}</UButton></template></ConsolePageHeading>
 <form @submit.prevent="filter('search')"><ConsoleListFilters><ConsoleListSearch v-model="q" :placeholder="'搜索'+noun+'名称'" :maxlength="100"/><USelect v-if="data.applications.length>1" :model-value="applicationKey" :items="data.applications.map(a=>({label:a.name,value:a.key}))" aria-label="所属应用" @update:model-value="page=1;load('application',String($event))"/><div class="flex shrink-0 gap-3"><ConsoleQueryButton type="submit" :loading="action==='search'" :disabled="!!mutation">查询</ConsoleQueryButton><ConsoleQueryButton kind="reset" color="neutral" variant="outline" :loading="action==='reset'" :disabled="!!mutation" @click="filter('reset')">重置</ConsoleQueryButton></div></ConsoleListFilters></form>
 <ConsoleDataTable v-model:selected-ids="selected" :selectable="data.canWrite" :data="data.items" :columns="columns" :page="page" :page-size="pageSize" :page-size-items="[10,20,50]" :total="data.total" :client-pagination="false" :error="error" :empty-title="'暂无匹配的'+noun" empty-description="请调整搜索条件后重试。" min-table-width="840px" @update:page="setPage" @update:page-size="setPageSize" @retry="load('retry')">
  <template #errorActions><UButton :loading="action==='retry'" @click="load('retry')">重试</UButton></template>
  <template #selection="{selectedCount}"><UButton color="error" variant="outline" icon="i-lucide-trash-2" :disabled="!selectedCount||!!mutation" @click="askDelete()">批量删除（{{selectedCount}}）</UButton></template>
  <template #name-cell="{row}"><div class="flex items-center gap-2"><span class="font-medium">{{row.original.name}}</span></div></template>
  <template #rank-cell="{row}">{{row.original.id==='default'?'基础':row.original.rank}}</template>
  <template #conditions-cell="{row}"><p class="max-w-80 whitespace-normal text-xs leading-6">{{conditionText(row.original)}}</p></template>
  <template #benefits-cell="{row}"><p class="max-w-64 whitespace-normal text-xs leading-6">购买 {{(row.original.benefits?.discountBps??10000)/1000}} 折 · 成长值 {{(row.original.benefits?.growthMultiplierBps??10000)/10000}} 倍</p></template>
  <template #description-cell="{row}"><span class="block max-w-64 truncate" :title="row.original.description">{{row.original.description||'—'}}</span></template>
  <template #updatedAt-cell="{row}"><span class="whitespace-nowrap text-xs">{{row.original.updatedAt?dateTime(row.original.updatedAt):'—'}}</span></template>
  <template #actions-cell="{row}"><div v-if="data.canWrite" class="flex gap-3"><UButton variant="link" size="sm" :disabled="!!mutation" @click="open(row.original)">编辑</UButton><UButton variant="link" color="error" size="sm" :disabled="!!mutation" @click="askDelete(row.original)">删除</UButton></div><span v-else class="text-xs text-muted">只读</span></template>
 </ConsoleDataTable>
 <ConsoleDrawer :open="editor" :title="(editing?'编辑':'新建')+noun" :dismissible="!mutation" @update:open="!$event&&close()">
  <template #body><form id="member-catalog-form" class="space-y-6" @submit.prevent="save">
   <UAlert v-if="formError" color="error" :title="formError"/>
   <section class="space-y-5">
    <h3 v-if="isLevel" class="drawer-section-title">基本信息</h3>
    <ConsoleSettingsField :label="noun+'名称'" input-id="member-name"><ConsoleInput id="member-name" v-model="form.name" :placeholder="'请输入'+noun+'名称'" required :maxlength="32" :disabled="!!mutation"/></ConsoleSettingsField>
    <ConsoleSettingsField v-if="isLevel&&editing?.id!=='default'" label="等级序号" input-id="member-rank"><ConsoleInput id="member-rank" v-model="form.rank" type="number" min="0" max="2147483647" step="1" placeholder="请输入等级序号" required :disabled="!!mutation"/><p class="mt-2 text-xs text-muted">序号越大等级越高，每个等级序号唯一。</p></ConsoleSettingsField>
   </section>
   <section v-if="isLevel&&editing?.id!=='default'" class="space-y-5 border-t border-default pt-5">
    <h3 class="drawer-section-title">升级设置</h3>
    <ConsoleSettingsField label="自动升级"><USwitch v-model="form.autoUpgrade" aria-label="自动升级" :disabled="!!mutation"/><p class="mt-2 text-xs text-muted">关闭后仅支持在用户资料中手动设置此等级。</p></ConsoleSettingsField>
    <template v-if="form.autoUpgrade">
     <p class="text-xs leading-5 text-muted">勾选参与判断的条件，并填写对应门槛。</p>
     <div class="divide-y divide-default border-y border-default">
      <div class="member-condition-row"><UCheckbox v-model="form.growthEnabled" label="成长值" :disabled="!!mutation"/><div class="flex min-w-0 items-center gap-2"><span class="shrink-0 text-xs text-muted">达到</span><ConsoleInput v-model="form.threshold" aria-label="成长值门槛" type="number" min="0" max="2147483647" step="1" :required="form.growthEnabled" :disabled="!!mutation||!form.growthEnabled" class="min-w-0 flex-1"/><span class="w-6 shrink-0 text-xs text-muted">点</span></div></div>
      <div class="member-condition-row"><UCheckbox v-model="form.spendEnabled" label="累计实付金额" :disabled="!!mutation"/><div class="flex min-w-0 items-center gap-2"><span class="shrink-0 text-xs text-muted">达到</span><ConsoleInput v-model="form.paidAmount" aria-label="累计实付金额门槛" inputmode="decimal" placeholder="0.00" :required="form.spendEnabled" :disabled="!!mutation||!form.spendEnabled" class="min-w-0 flex-1"/><span class="w-6 shrink-0 text-xs text-muted">元</span></div></div>
      <div class="member-condition-row"><UCheckbox v-model="form.ordersEnabled" label="有效订单数" :disabled="!!mutation"/><div class="flex min-w-0 items-center gap-2"><span class="shrink-0 text-xs text-muted">达到</span><ConsoleInput v-model="form.paidOrders" aria-label="有效订单数门槛" type="number" min="1" max="2147483647" step="1" placeholder="1" :required="form.ordersEnabled" :disabled="!!mutation||!form.ordersEnabled" class="min-w-0 flex-1"/><span class="w-6 shrink-0 text-xs text-muted">笔</span></div></div>
     </div>
     <ConsoleSettingsField v-if="enabledConditions>1" label="条件关系"><URadioGroup v-model="form.upgradeMode" orientation="horizontal" :items="[{value:'any',label:'满足任一条件'},{value:'all',label:'满足全部条件'}]" :disabled="!!mutation"/></ConsoleSettingsField>
     <p class="text-xs leading-6 text-muted">实付金额扣除成功退款；净实付大于 0 的订单计入笔数。满足条件后自动升级，不自动降级。</p>
    </template>
   </section>
   <section v-if="isLevel" class="space-y-5 border-t border-default pt-5">
    <h3 class="drawer-section-title">会员权益</h3>
    <ConsoleSettingsField v-for="benefit in data.benefitDefinitions||[]" :key="benefit.key" :label="benefit.label" :input-id="'benefit-'+benefit.key">
     <div class="flex min-w-0 items-center gap-2"><ConsoleInput :id="'benefit-'+benefit.key" v-model="form.benefits[benefit.key]" inputmode="decimal" required :disabled="!!mutation" class="min-w-0 flex-1"/><span class="shrink-0 text-sm text-muted">{{benefit.unit}}</span></div>
     <p class="mt-2 text-xs leading-5 text-muted">{{benefit.help}}</p>
    </ConsoleSettingsField>
    <p class="text-xs leading-6 text-muted">权益按用户当前等级计算，新订单使用下单时的权益；已生成的订单保持下单时的金额与成长值规则。</p>
   </section>
   <ConsoleSettingsField label="备注" input-id="member-description"><UTextarea id="member-description" v-model="form.description" placeholder="选填" :maxlength="200" :rows="3" class="w-full" :disabled="!!mutation"/></ConsoleSettingsField>
  </form></template>
  <template #footer><ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="!!mutation" @click="close">取消</UButton><UButton form="member-catalog-form" type="submit" :loading="mutation==='save'" :disabled="!!mutation">保存</UButton></ConsoleFormActions></template>
 </ConsoleDrawer>
 <ConsoleDrawer :open="rulesOpen" title="成长规则" :dismissible="!mutation" @update:open="!$event&&close()">
  <template #body><form id="member-rules-form" class="space-y-6" @submit.prevent="saveRules">
   <UAlert v-if="ruleError" color="error" :title="ruleError"/>
   <section class="space-y-5"><h3 class="drawer-section-title">注册赠送</h3>
    <ConsoleSettingsField label="赠送成长值" input-id="registration-growth"><div class="flex min-w-0 items-center gap-2"><ConsoleInput id="registration-growth" v-model="registrationGrowth" type="number" min="0" max="2147483647" step="1" required :disabled="!!mutation||!data.canWrite" class="min-w-0 flex-1"/><span class="shrink-0 text-sm text-muted">点</span></div><p class="mt-2 text-xs leading-5 text-muted">新用户注册时赠送一次，已有用户不补发。0 表示不赠送。</p></ConsoleSettingsField>
   </section>
   <section class="space-y-5 border-t border-default pt-5"><h3 class="drawer-section-title">消费赠送</h3>
    <ConsoleSettingsField label="每消费 1 元" input-id="purchase-growth"><div class="flex min-w-0 items-center gap-2"><ConsoleInput id="purchase-growth" v-model="purchaseGrowthPerYuan" type="number" min="0" max="2147483647" step="1" required :disabled="!!mutation||!data.canWrite" class="min-w-0 flex-1"/><span class="shrink-0 whitespace-nowrap text-sm text-muted">点成长值</span></div><p class="mt-2 text-xs leading-5 text-muted">按订单实际支付金额计算，结果向下取整。0 表示不赠送。</p></ConsoleSettingsField>
    <p class="text-xs leading-6 text-muted">保存后对新订单生效，支付成功后发放；退款成功后按原订单比例扣回，成长值最低为 0，已有等级不自动降低。</p>
   </section>
   <p class="border-t border-default pt-5 text-xs leading-6 text-muted">成长值用于会员升级，与账户积分、套餐订阅分别计算。等级门槛在各等级的“升级设置”中配置。</p>
  </form></template>
  <template #footer><ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="!!mutation" @click="close">取消</UButton><UButton v-if="data.canWrite" form="member-rules-form" type="submit" :loading="mutation==='rules'" :disabled="!!mutation||!dirty">保存</UButton></ConsoleFormActions></template>
 </ConsoleDrawer>
 <UModal v-model:open="deleteOpen" :title="'删除'+noun+'？'" description="有关联用户时不能删除，请先调整用户关联。" :dismissible="!mutation" :close="!mutation"><template #body><p>将删除 {{deleteRows.length}} 个{{noun}}。</p><UAlert v-if="deleteError" class="mt-4" color="error" :title="deleteError"/></template><template #footer><ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="!!mutation" @click="deleteOpen=false">取消</UButton><UButton color="error" :loading="mutation==='delete'" :disabled="!!mutation" @click="remove">确认删除</UButton></ConsoleFormActions></template></UModal>
 <ConsoleDiscardChangesDialog :controller="discard"/>
</div></AdminConsole></template>
<style scoped>
.member-condition-row{display:grid;grid-template-columns:1fr;gap:.75rem;padding:1rem 0}
@media(min-width:480px){.member-condition-row{grid-template-columns:10rem minmax(0,1fr);align-items:center;gap:1rem}}
</style>
