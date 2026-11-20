<script setup lang="ts">
import AdminConsole from '../../components/console/AdminConsole.vue'
import ConsoleDiscardChangesDialog from '../../components/console/ConsoleDiscardChangesDialog.vue'
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import {dateTime} from '../../utils/update-center'
definePageMeta({layout:'tenant',key:route=>route.path})
type Method={provider:string;enabled:boolean;label:string;implemented:boolean;configured:boolean;combined?:boolean;reason:string|null;configPath:string|null}
type Client={key:string;label:string;icon:string;methods:Method[]}
type Rules=Record<string,{provider:string;enabled:boolean}[]>
type View={applicationKey:string;canWrite:boolean;version:number;config:Rules;clients:Client[];updatedAt:string|null}
const auth=useApi('tenant'),tenantId=useTenantContext().tenantId.value,endpoint='/admin/tenants/'+encodeURIComponent(tenantId)+'/payment-methods',toast=useToast()
const initial=await useAsyncData<View>('payment-methods:'+auth.session.value?.id+':'+tenantId,(_,{signal})=>auth.api<View>(endpoint,'GET',undefined,{signal}))
const data=ref<View|null>(initial.data.value||null),form=ref<Rules>(unifyWechat(initial.data.value?.config||{})),baseline=ref(JSON.stringify(form.value)),error=ref(initial.error.value?.message||''),busy=ref(''),saving=ref(false),dirty=computed(()=>JSON.stringify(form.value)!==baseline.value),discard=useDiscardChanges(()=>saving.value),lifetime=new AbortController();let controller:AbortController|undefined,sequence=0,disposed=false
const needsSync=computed(()=>!!data.value&&JSON.stringify(unifyWechat(data.value.config))!==JSON.stringify(data.value.config))
const locked=computed(()=>saving.value||!!busy.value||!data.value?.canWrite)
function unifyWechat(value:Rules){const next=structuredClone(toRaw(value)),wechat=next.mini?.filter(row=>['wechat','wechat-virtual'].includes(row.provider))||[],enabled=wechat.some(row=>row.enabled);for(const row of wechat)row.enabled=enabled;if(wechat.length===2){let added=false;next.mini=(next.mini||[]).flatMap(row=>{if(!['wechat','wechat-virtual'].includes(row.provider))return[row];if(added)return[];added=true;return[wechat.find(item=>item.provider==='wechat')!,wechat.find(item=>item.provider==='wechat-virtual')!]})}return next}
function methods(client:string){return(form.value[client]||[]).filter(row=>client!=='mini'||row.provider!=='wechat')}
function fill(value:View){data.value=value;form.value=unifyWechat(value.config);baseline.value=JSON.stringify(form.value)}
function info(client:string,provider:string){return data.value!.clients.find(c=>c.key===client)!.methods.find(m=>m.provider===provider)!}
function move(client:string,index:number,direction:number){if(locked.value)return;const visible=methods(client);if(index+direction<0||index+direction>=visible.length)return;const[item]=visible.splice(index,1);visible.splice(index+direction,0,item!);const ordinary=form.value[client]?.find(row=>row.provider==='wechat');form.value[client]=visible.flatMap(row=>client==='mini'&&row.provider==='wechat-virtual'&&ordinary?[ordinary,row]:[row])}
function toggle(client:string,provider:string,value:boolean){if(locked.value)return;for(const row of form.value[client]||[])if(row.provider===provider||client==='mini'&&['wechat','wechat-virtual'].includes(provider)&&['wechat','wechat-virtual'].includes(row.provider))row.enabled=value}
function cancel(){if(saving.value||!data.value)return;discard.request(()=>fill(data.value!))}
async function load(source='refresh'){
 if(saving.value||disposed)return;if(dirty.value){discard.request(()=>{if(data.value)fill(data.value);void load(source)});return}
 controller?.abort();controller=new AbortController();const current=++sequence;busy.value=source
 try{const result=await auth.api<View>(endpoint,'GET',undefined,{signal:AbortSignal.any([lifetime.signal,controller.signal])});if(!disposed&&current===sequence){fill(result);error.value=''}}catch(e:any){if(!disposed&&current===sequence)error.value=e.message||'支付方式读取失败'}finally{if(!disposed&&current===sequence)busy.value=''}
}
async function save(){if(locked.value||!dirty.value&&!needsSync.value||!data.value)return;controller?.abort();sequence++;busy.value='';saving.value=true;error.value='';const input={version:data.value.version,config:structuredClone(toRaw(form.value))};try{const result=await auth.api<View>(endpoint+'/'+encodeURIComponent(data.value.applicationKey),'PUT',input,{signal:lifetime.signal});if(!disposed){fill(result);toast.add({title:'支付方式已保存',color:'success'})}}catch(e:any){if(!disposed)error.value=e.message||'保存失败，请保留当前修改后重试'}finally{if(!disposed)saving.value=false}}
onBeforeRouteLeave(to=>{if(saving.value)return false;if(dirty.value){discard.request(()=>{if(data.value)fill(data.value);void navigateTo(to.fullPath)});return false}})
onBeforeUnmount(()=>{disposed=true;sequence++;controller?.abort();lifetime.abort()})
</script>
<template><AdminConsole :refreshing="busy==='refresh'" @refresh="load()"><div class="space-y-5">
 <ConsolePageHeading title="支付方式"/>
 <UAlert v-if="error" color="error" :title="error"><template #actions><UButton :loading="busy==='retry'" :disabled="saving" @click="load('retry')">重试</UButton></template></UAlert>
 <UAlert v-if="needsSync" color="info" title="微信支付允许状态待统一" description="旧配置分别保存了普通与虚拟支付的允许状态或排序。保存后按本页统一设置生效，实际通道仍由服务端按商品类型判断。"/>
 <form v-if="data" class="space-y-5" @submit.prevent="save">
  <section v-for="client in data.clients" :key="client.key" class="overflow-hidden rounded-xl border border-default bg-default">
   <div class="flex items-center gap-3 border-b border-default px-5 py-4 sm:px-7"><UIcon :name="client.icon" class="size-5 shrink-0"/><h2 class="font-semibold">{{client.label}}</h2></div>
   <div class="hidden grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_6rem] gap-5 border-b border-default bg-elevated/40 px-7 py-3 text-sm text-muted md:grid"><span>支付方式</span><span>允许使用</span><span>收款条件</span><span class="text-right">配置</span></div>
   <article v-for="(method,index) in methods(client.key)" :key="method.provider" class="method-row grid gap-3 border-b border-default px-5 py-4 last:border-b-0 sm:px-7 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_6rem] md:items-center md:gap-5">
    <div class="flex min-w-0 items-center gap-3"><span class="min-w-0 flex-1 font-medium">{{info(client.key,method.provider).label}}</span><div v-if="data.canWrite" class="flex shrink-0"><UButton type="button" color="neutral" variant="ghost" size="xs" icon="i-lucide-chevron-up" :aria-label="'上移'+info(client.key,method.provider).label" :disabled="locked||index===0" @click="move(client.key,index,-1)"/><UButton type="button" color="neutral" variant="ghost" size="xs" icon="i-lucide-chevron-down" :aria-label="'下移'+info(client.key,method.provider).label" :disabled="locked||index===methods(client.key).length-1" @click="move(client.key,index,1)"/></div></div>
    <USwitch :model-value="method.enabled" @update:model-value="toggle(client.key,method.provider,$event)" :aria-label="client.label+'允许'+info(client.key,method.provider).label" :label="method.enabled?'允许':'不允许'" :disabled="locked||!info(client.key,method.provider).implemented"/>
    <div class="min-w-0"><UBadge :color="info(client.key,method.provider).configured&&!info(client.key,method.provider).combined?'success':'neutral'" variant="subtle">{{!info(client.key,method.provider).implemented?'暂未接通':info(client.key,method.provider).combined?'分通道配置':info(client.key,method.provider).configured?'配置就绪':'待配置'}}</UBadge><p v-if="info(client.key,method.provider).reason" class="mt-1 text-xs text-muted">{{info(client.key,method.provider).reason}}</p></div>
    <UButton v-if="info(client.key,method.provider).configPath" :to="info(client.key,method.provider).configPath!" variant="link" class="justify-start px-0 md:justify-end" :disabled="saving">配置</UButton><span v-else class="text-xs text-muted md:text-right">无需商户配置</span>
   </article>
  </section>
  <div class="border-t border-default pt-5"><div class="mb-4 flex flex-wrap justify-between gap-2 text-xs text-muted"><span>微信支付统一允许状态，实际通道由服务端按商品类型判断。余额充值不提供余额支付。</span><span>{{data.updatedAt?'更新于 '+dateTime(data.updatedAt):'当前沿用已有支持范围，保存后按本页设置生效。'}}</span></div><ConsoleFormActions><UButton color="neutral" variant="outline" :disabled="saving||!dirty" @click="cancel">取消修改</UButton><UButton type="submit" :loading="saving" :disabled="locked||!dirty&&!needsSync">保存设置</UButton></ConsoleFormActions></div>
 </form>
 <ConsoleDiscardChangesDialog :controller="discard"/>
</div></AdminConsole></template>
<style scoped>@media(max-width:767px){.method-row{grid-template-columns:minmax(0,1fr) auto}.method-row>div:first-child{grid-column:1/-1}.method-row>div:nth-child(3){grid-column:1}.method-row>a{grid-column:2;grid-row:3}}</style>
