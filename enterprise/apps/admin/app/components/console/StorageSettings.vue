<script setup lang="ts">
import ConsoleDiscardChangesDialog from '~/components/console/ConsoleDiscardChangesDialog.vue'
const discard=useDiscardChanges(()=>!!busy.value)
import ConsoleDrawer from '../../components/console/ConsoleDrawer.vue'
const props=defineProps<{siteId?:string}>()
import ConsolePageHeading from '@orangezh1/qisvc-console-ui/components/ConsolePageHeading'
import ConsoleDataTable from '@orangezh1/qisvc-console-ui/components/ConsoleDataTable'
import ConsoleInput from '@orangezh1/qisvc-console-ui/components/ConsoleInput'
import ConsoleFormActions from '@orangezh1/qisvc-console-ui/components/ConsoleFormActions'
import AdminConsole from '../../components/console/AdminConsole.vue'
import {dateTime} from '../../utils/update-center'

type Provider='local'|'qiniu'|'oss'|'cos'
type Config={access?:string;provider:Provider;label:string;enabled:boolean;bucket:string;region:string;privateDomain:string;maxFileMb:number;maskedAccessKeyId?:string;hasCredentials:boolean;isDefault:boolean;revisionId:string|null;status:string;checkedAt:string|null;message:string;cleanupPending:boolean}
type Settings={siteId:string|null;inherited:boolean;canWrite:boolean;version:number;active:{provider:Provider;label:string;revisionId:string}|null;localRoot?:string;providers:Config[]}
const auth=useApi(props.siteId?'tenant':'admin'),toast=useToast(),session=auth.session.value??await auth.restore()
const endpoint=props.siteId?'/admin/tenants/'+encodeURIComponent(props.siteId)+'/storage':'/admin/storage'
if(!session)await navigateTo(props.siteId?'/admin/login':'/admin/login',{replace:true})
else if(session.role!==(props.siteId?'tenant':'root')||!session.permissions.includes(props.siteId?'tenant:settings.read':'settings.read'))throw createError({statusCode:403,statusMessage:'没有存储设置访问权限'})
const initial=await useAsyncData('storage:'+session?.id+':'+(props.siteId||'platform'),(_nuxt,{signal})=>auth.api<Settings>(endpoint,'GET',undefined,{signal}))
const lifetime=new AbortController();let disposed=false
onBeforeUnmount(()=>{disposed=true;lifetime.abort()})
const data=ref<Settings|null>(initial.data.value??null),provider=ref<Provider>('local'),busy=ref<'save'|'test'|'default'|'refresh'|null>(null),error=ref(initial.error.value?'存储设置读取失败，请刷新重试':''),baseline=ref(''),settingsOpen=ref(false)
const canWrite=computed(()=>!!data.value?.canWrite)
const columns=[{accessorKey:'label',header:'存储方式'},{id:'location',header:'存储位置'},{id:'status',header:'状态'},{id:'actions',header:'操作'}]
const locations:Record<Provider,string>={local:'存储在本地服务器',qiniu:'存储在七牛云，使用云资源域名访问',oss:'存储在阿里云，使用云资源域名访问',cos:'存储在腾讯云，使用云资源域名访问'}
const current=computed(()=>data.value?.providers.find(c=>c.provider===provider.value))
const form=reactive({bucket:'',region:'',privateDomain:'',maxFileMb:20,accessKeyId:'',secret:''})
function fill(){const c=current.value;if(c)Object.assign(form,{bucket:c.bucket,region:c.region,privateDomain:c.privateDomain,maxFileMb:c.maxFileMb,accessKeyId:'',secret:''});baseline.value=JSON.stringify(form)}
fill()
const dirty=computed(()=>JSON.stringify(form)!==baseline.value)
const stateLabel=computed(()=>({unconfigured:'未配置',not_tested:'尚未检测',testing:'检测中',passed:'连接正常',failed:'连接失败'} as Record<string,string>)[current.value?.status||'unconfigured'])
const stateColor=computed(()=>current.value?.status==='passed'?'success':current.value?.status==='failed'?'error':current.value?.status==='testing'?'primary':'neutral')
function openSettings(value:Provider){if(busy.value)return;provider.value=value;fill();error.value='';settingsOpen.value=true}
function closeSettings(){if(busy.value)return;if(dirty.value){discard.request(discardSettings);return}settingsOpen.value=false}
function discardSettings(){fill();settingsOpen.value=false;discard.keep()}
async function refresh(){if(busy.value)return;if(dirty.value){discard.request(()=>{discardSettings();void refresh()});return}busy.value='refresh';error.value='';try{const value=await auth.api<Settings>(endpoint,'GET',undefined,{signal:lifetime.signal});if(!disposed){data.value=value;fill()}}catch(e){if(!disposed)error.value=e instanceof Error?e.message:'读取失败'}finally{busy.value=null}}
async function action(kind:'save'|'test'|'default'){
  if(busy.value||!data.value||!canWrite.value)return;busy.value=kind;error.value=''
  try{
    const result=await auth.api<Settings>(endpoint+'/'+provider.value+(kind==='save'?'':kind==='test'?'/test':'/default'),kind==='save'?'PUT':'POST',kind==='save'?{...form,maxFileMb:Number(form.maxFileMb),version:data.value.version}:kind==='default'?{version:data.value.version,revisionId:current.value?.revisionId}:{},{signal:lifetime.signal})
    if(disposed)return;data.value=result;fill()
    if(kind!=='test')toast.add({title:kind==='save'?'配置已保存，请测试后启用':'存储已启用，新上传文件将使用此存储',color:'success'})
  }catch(e){if(!disposed)error.value=e instanceof Error?e.message:'操作未完成，请刷新状态后重试'}finally{busy.value=null}
}
onBeforeRouteLeave(to=>{if(!auth.session.value)return;if(busy.value){toast.add({title:'正在处理，请稍候再离开',color:'neutral'});return false}if(dirty.value){discard.request(()=>{discardSettings();void navigateTo(to.fullPath)});return false}})
</script>
<template>
  <AdminConsole :refreshing="busy==='refresh'" @refresh="refresh"><div class="space-y-5">
    <ConsolePageHeading title="存储设置"/>
    <UAlert v-if="error&&!settingsOpen" :title="error" color="error" variant="subtle"/>
    <UAlert v-if="data&&!data.inherited" color="warning" variant="subtle" icon="i-lucide-circle-alert" title="存储说明" :ui="{root:'rounded-lg ring-0 shadow-none',title:'font-semibold text-amber-900 dark:text-amber-200',description:'text-slate-700 dark:text-slate-200 opacity-100',icon:'text-amber-700 dark:text-amber-300'}"><template #description><ul class="mt-1 space-y-1 text-sm leading-6"><li>每个站点只使用一个存储。启用云存储后，新文件仅保存到云端。</li><li>切换存储不会自动迁移历史文件。手动搬迁时请保留原目录和文件名，并核对历史文件的访问地址。</li><li>确认历史文件可正常访问后再清理原文件。</li></ul></template></UAlert>
    <UAlert v-if="data?.inherited" color="primary" variant="subtle" title="使用默认存储" :description="'当前使用：'+(data.active?.label||'未配置')+'。'"/>
    <ConsoleDataTable v-if="data&&!data.inherited" :data="data.providers" :columns="columns" row-key="provider" :show-sequence="false" :pagination="false" :client-pagination="false" min-table-width="660px">
      <template #label-cell="{row}"><span>{{row.original.label}}</span><UBadge v-if="data.active?.provider===row.original.provider" size="sm" variant="subtle" class="ml-2">当前使用</UBadge></template>
      <template #location-cell="{row}"><span class="text-muted">{{locations[row.original.provider as Provider]}}</span></template>
      <template #status-cell="{row}"><UBadge :color="row.original.enabled?'success':'neutral'" variant="subtle">{{row.original.enabled?'已启用':'未启用'}}</UBadge><span v-if="row.original.status==='failed'" class="ml-2 text-xs text-error">连接失败</span><span v-else-if="row.original.status==='unconfigured'" class="ml-2 text-xs text-muted">未配置</span></template>
      <template #actions-cell="{row}"><UButton class="px-0" variant="link" size="sm" @click="openSettings(row.original.provider)">设置</UButton></template>
    </ConsoleDataTable>
    <ConsoleDrawer :open="settingsOpen" :title="(current?.label||'存储')+'设置'" description="保存并测试通过后启用，同一时间只使用一个存储。" :dismissible="!busy" :close="!busy" wide @update:open="!$event&&closeSettings()"><template #body>
      <form v-if="current&&data" id="storage-settings-form" class="space-y-6" @submit.prevent="action('save')">
        <UAlert v-if="error" :title="error" color="error" variant="subtle"/>
        <div class="flex flex-wrap items-center justify-between gap-4"><div class="flex items-center gap-2"><UBadge v-if="current.isDefault" variant="subtle">当前使用</UBadge><UBadge :color="stateColor" variant="subtle">{{stateLabel}}</UBadge></div></div>
        <template v-if="provider==='local'"><UFormField label="文件目录" help="由服务器统一管理。"><ConsoleInput :model-value="props.siteId?'sites/'+props.siteId+'/':data.localRoot" readonly/></UFormField><UFormField label="最大文件大小（MB）" help="可设置 1–100 MB；当前使用存储的配置应用于素材库和选择弹窗。"><ConsoleInput v-model="form.maxFileMb" type="number" min="1" max="100" step="1" required class="sm:!w-64" :disabled="!!busy||!canWrite"/></UFormField></template>
        <template v-else>
          <p v-if="current.revisionId&&current.access!=='public'" class="text-sm text-muted">此配置沿用旧版访问方式，请保存后测试并启用新的资源域名访问。</p>
          <p class="rounded-lg bg-primary/5 px-4 py-3 text-sm text-muted">请配置可公开读取的 Bucket 和 HTTPS 资源域名。连接测试仅上传临时文件，检查读取后删除。</p>
          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField :label="provider==='cos'?'SecretId':provider==='oss'?'AccessKeyId':'AccessKey'" :hint="current.hasCredentials?'已配置 '+current.maskedAccessKeyId+'，留空保留':''"><ConsoleInput v-model="form.accessKeyId" autocomplete="off" :disabled="!!busy||!canWrite"/></UFormField>
            <UFormField :label="provider==='oss'?'AccessKeySecret':'SecretKey'" help="密钥加密保存，不回显。请在此输入，不要发到聊天中。"><ConsoleInput v-model="form.secret" type="password" autocomplete="new-password" :disabled="!!busy||!canWrite"/></UFormField>
            <UFormField label="Bucket" required><ConsoleInput v-model="form.bucket" required :disabled="!!busy||!canWrite" placeholder="请输入存储桶名称"/></UFormField>
            <UFormField :label="provider==='qiniu'?'存储区域（选填）':'存储区域'" :required="provider!=='qiniu'" :help="provider==='qiniu'?'七牛按 Bucket 自动识别区域':provider==='oss'?'例如 oss-cn-hangzhou':'例如 ap-guangzhou'"><ConsoleInput v-model="form.region" :required="provider!=='qiniu'" :disabled="!!busy||!canWrite"/></UFormField>
            <UFormField label="资源域名" required help="填写已绑定此 Bucket 的 HTTPS 域名；小程序需配置对应的 downloadFile 合法域名。"><ConsoleInput v-model="form.privateDomain" placeholder="https://files.example.com" required :disabled="!!busy||!canWrite"/></UFormField>
            <UFormField label="最大文件大小（MB）"><ConsoleInput v-model="form.maxFileMb" type="number" min="1" max="100" step="1" required :disabled="!!busy||!canWrite"/></UFormField>
          </div>
          <p class="text-xs leading-6 text-muted">启用后，新上传素材通过资源域名访问，服务器不保留文件副本。</p>
        </template>
        <div v-if="current.message" class="border-t border-default pt-5"><p class="text-sm" :class="current.status==='passed'?'text-success':current.status==='failed'?'text-error':'text-muted'">{{current.message}}</p><p class="mt-1 text-xs text-muted">最近检测：{{dateTime(current.checkedAt)}}</p></div>
        <p v-if="current.cleanupPending" class="text-xs text-warning">存在未完成的测试或测试文件清理，重新测试会先清理上次的测试文件。</p>
      </form>
    </template><template #footer><ConsoleFormActions v-if="current" class="w-full"><UButton v-if="dirty" color="neutral" variant="ghost" :disabled="!!busy" @click="discard.request(()=>{fill();error=''})">取消修改</UButton><UButton v-if="canWrite" type="submit" form="storage-settings-form" :loading="busy==='save'" :disabled="!!busy&&busy!=='save'||!dirty&&!!current.revisionId&&current.access==='public'">保存配置</UButton><UButton v-if="canWrite" color="neutral" variant="outline" :loading="busy==='test'" :disabled="!!busy&&busy!=='test'||dirty||!current.revisionId" @click="action('test')">测试已保存配置</UButton><UButton v-if="canWrite&&!current.isDefault" variant="soft" :loading="busy==='default'" :disabled="!!busy&&busy!=='default'||dirty||current.status!=='passed'" @click="action('default')">启用此存储</UButton></ConsoleFormActions></template></ConsoleDrawer>
    <ConsoleDiscardChangesDialog :controller="discard"/>
  </div></AdminConsole>
</template>
