<script setup lang="ts">
import {applicationMenus} from '../../utils/application-navigation'
import ConsoleFrame from '../console/ConsoleFrame.vue'
import ConsoleSidebarLink from '@orangezh1/qisvc-console-ui/components/ConsoleSidebarLink'
import AreaSidebarGroup from '../console/AreaSidebarGroup.vue'
import {consoleBreadcrumbs,markConsoleItems,type ConsoleMenuItem,type ConsoleMenuGroup} from '../../utils/console-navigation'
defineProps<{refreshing?:boolean}>()
const emit=defineEmits<{refresh:[]}>(),route=useRoute(),auth=useApi('tenant')
const {path:displayPath,target:navigationTarget}=useConsoleNavigation()
const selectionPath=computed(()=>['/admin/decoration-editor','/admin/payments/wechat'].includes(displayPath.value)?(navigationTarget.value?.fullPath||route.fullPath):displayPath.value)
const hasSite=computed(()=>!!tenantId.value&&(auth.session.value?.permissions||[]).includes('tenant:settings.read'))
const hasEntitlements=computed(()=>!!tenantId.value&&(auth.session.value?.permissions||[]).some(p=>p==='entitlements.read'||p.endsWith(':entitlements.read')))
const hasUsers=computed(()=>!!tenantId.value&&(auth.session.value?.permissions||[]).some(p=>p==='consumers.read'||p.endsWith(':consumers.read')))
const hasPayments=computed(()=>!!tenantId.value&&(auth.session.value?.permissions||[]).some(p=>p==='tenant:clientSettings.read'||p==='settings.read'||!p.startsWith('tenant:')&&p.endsWith(':settings.read')))
const hasTransactions=computed(()=>!!tenantId.value&&(auth.session.value?.permissions||[]).some(p=>p==='tenant:orders.read'||p==='orders.read'||!p.startsWith('tenant:')&&p.endsWith(':orders.read')))
const hasPackages=computed(()=>!!tenantId.value&&(auth.session.value?.permissions||[]).some(p=>p==='entitlements.read'||p.endsWith(':entitlements.read')))
const decorationSettingsPage=computed(()=>['/admin/decoration-login','/admin/decoration-theme','/admin/decoration-navigation'].includes(displayPath.value))
const decorationOverviewPage=computed(()=>displayPath.value==='/admin/decoration')
const materialPage=computed(()=>/^\/admin\/materials\/?$/.test(displayPath.value))
const hasMaterials=computed(()=>!!tenantId.value&&(auth.session.value?.permissions||[]).some(p=>p==='tenant:materials.read'||p==='materials.read'||p.endsWith(':materials.read')))
const tenantContext=useTenantContext(),{tenantId}=tenantContext
let entryRefresh:AbortController|undefined
async function refreshEntry(){
 if(entryRefresh||document.visibilityState!=='visible'||!tenantId.value)return
 const path=route.path,previous=tenantContext.current.value?.site,previousRoute=previous?.consoleRoutes?.find(item=>item.path===path)
 const controller=new AbortController();entryRefresh=controller
 try{
  const entry=await tenantContext.refresh(controller.signal);if(!entry||controller.signal.aborted||route.path!==path)return
  if(!entry.tenant)return navigateTo('/admin',{external:true,replace:true})
  if(['tenant-disabled','tenant-expired','system-unavailable'].includes(entry.access))return showError({statusCode:403,statusMessage:'后台当前不可用，请联系管理员'})
  const nextRoute=entry.tenant.consoleRoutes?.find(item=>item.path===route.path)
  const workbench=entry.tenant.consoleRoutes?.find(item=>item.group==='workbench')?.path
  if(previousRoute&&(!nextRoute||previousRoute.applicationKey!==nextRoute.applicationKey)||path==='/admin/workbench'&&!previousRoute&&workbench)return navigateTo(workbench||'/admin/workbench',{external:true,replace:true})
 }catch{/* The next request still enforces authorization; background refresh does not clear a valid view on a network failure. */}
 finally{if(entryRefresh===controller)entryRefresh=undefined}
}
onMounted(()=>{window.addEventListener('focus',refreshEntry);document.addEventListener('visibilitychange',refreshEntry)})
onBeforeUnmount(()=>{entryRefresh?.abort();window.removeEventListener('focus',refreshEntry);document.removeEventListener('visibilitychange',refreshEntry)})
// Page access and menu availability use the same server-resolved application capabilities.
const capabilityFor:Record<string,string>={
 'users':'consumers','member-levels':'consumers','member-tags':'consumers','points-ledger':'pointsLedger',
 'packages':'packages','entitlements':'entitlements','entitlement-ledger':'entitlementLedger',
 'transactions':'transactions','recharge':'recharge','recharge-orders':'recharge','after-sales':'transactions',
 'payments':'payments','payments/wechat?tab=ordinary':'payments','payments/alipay':'payments','payments/wechat?tab=virtual':'virtualGoods',
 'sms':'sms','subscriptions':'subscriptions','mini-program':'wechatMini','official-account':'wechatOfficial','h5':'h5',
 'help':'helpCenter','decoration':'decoration','decoration-login':'decoration','decoration-theme':'decoration',
 'decoration-navigation':'decoration','page-routes':'decoration','decoration-templates':'decoration',
}
function filterFeatures(groups:ConsoleMenuGroup[],flags:Record<string,boolean>|undefined){
 if(!flags)return groups
 const available=(to:string)=>{const key=capabilityFor[to.replace(/^\/admin\//,'')];return !key||flags[key]===true}
 function filter(items:readonly ConsoleMenuItem[]):ConsoleMenuItem[]{
  return items.flatMap<ConsoleMenuItem>(item=>{
   if('to' in item)return available(item.to)?[item]:[]
   const children=filter(item.children);return children.length?[{...item,children}]:[]
  })
 }
 return groups.flatMap<ConsoleMenuGroup>(group=>{if(group.to)return available(group.to)?[group]:[];const items=filter(group.items);return items.length?[{...group,items}]:[]})
}
const menuGroups=computed<ConsoleMenuGroup[]>(()=>{
 const base='/admin'
 const users=[...(hasUsers.value?[{label:'用户列表',icon:'i-lucide-users',to:base+'/users'},{label:'会员等级',icon:'i-lucide-badge-check',to:base+'/member-levels'},{label:'会员标签',icon:'i-lucide-tags',to:base+'/member-tags'}]:[]),...(hasEntitlements.value?[{label:'积分流水',icon:'i-lucide-list-ordered',to:base+'/points-ledger'},{label:'权益管理',icon:'i-lucide-badge-check',to:base+'/entitlements'},{label:'权益流水',icon:'i-lucide-list-ordered',to:base+'/entitlement-ledger'}]:[])]
 const transactions=[...(hasTransactions.value?[{label:'充值订单',icon:'i-lucide-banknote',to:base+'/recharge-orders'},...(!tenantContext.current.value?.site.consoleRoutes?.some(item=>item.afterSales)?[{label:'订单管理',icon:'i-lucide-receipt-text',to:base+'/after-sales'}]:[])]:[]),...(hasPackages.value?[{label:'充值配置',icon:'i-lucide-wallet',to:base+'/recharge'},{label:'套餐管理',icon:'i-lucide-package',to:base+'/packages'}]:[]),...(hasTransactions.value?[{label:'交易流水',icon:'i-lucide-arrow-right-left',to:base+'/transactions'}]:[])]
 const messageItems=[{label:'短信配置',icon:'i-lucide-smartphone',to:base+'/sms'},{label:'订阅消息',icon:'i-lucide-message-circle',to:base+'/subscriptions'},{label:'通知设置',icon:'i-lucide-settings',to:base+'/notifications'},{label:'发送记录',icon:'i-lucide-history',to:base+'/message-records'}]
 const permissionItems=[...(auth.session.value?.permissions.includes('tenant:accounts.read')?[{label:'管理员',icon:'i-lucide-users',to:base+'/administrators'}]:[]),...(auth.session.value?.permissions.includes('tenant:roles.read')?[{label:'角色',icon:'i-lucide-shield-check',to:base+'/roles'}]:[])]
 const helpItems=hasPayments.value?[{label:'帮助中心',icon:'i-lucide-circle-help',to:base+'/help'},{label:'客服设置',icon:'i-lucide-headphones',to:base+'/customer-service'}]:[]
 const settingsItems=[...(hasSite.value?[{label:'站点设置',icon:'i-lucide-settings',to:base+'/site'},{label:'存储设置',icon:'i-lucide-database',to:base+'/storage'}]:[]),...(hasPayments.value?[{key:'login-registration',label:'登录注册',icon:'i-lucide-log-in',children:[{label:'用户设置',icon:'i-lucide-user-round',to:base+'/user-settings'},{label:'用户注册',icon:'i-lucide-user-plus',to:base+'/user-registration'},{label:'协议管理',icon:'i-lucide-file-text',to:base+'/policies'}]},{key:'payment-settings',label:'支付配置',icon:'i-lucide-credit-card',children:[{label:'支付方式',icon:'i-lucide-list-ordered',to:base+'/payments'},{label:'微信支付',icon:'i-lucide-credit-card',to:base+'/payments/wechat?tab=ordinary'},{label:'微信虚拟支付',icon:'i-lucide-credit-card',to:base+'/payments/wechat?tab=virtual'},{label:'支付宝',icon:'i-lucide-wallet',to:base+'/payments/alipay'}]},{key:'message-settings',label:'消息配置',icon:'i-lucide-message-circle',children:messageItems}]:[])]
 const maintenance=[
  ['tenant:audit.read','系统日志','system-logs','i-lucide-history'],
  ['tenant:environment.read','系统环境','environment','i-lucide-server'],
  ['tenant:tasks.read','定时任务','scheduled-tasks','i-lucide-clock-3'],
  ['tenant:cache.read','系统缓存','system-cache','i-lucide-database'],
  ['tenant:backups.read','数据安全','data-security','i-lucide-shield-check'],
 ].filter(([permission])=>auth.session.value?.permissions.includes(permission!)).map(([,label,slug,icon])=>({label:label!,icon:icon!,to:base+'/'+slug}))
 if(tenantContext.current.value?.site.canManageProductUpdates)maintenance.push({label:'整包更新',icon:'i-lucide-refresh-cw',to:base+'/updates'})
 if(maintenance.length)settingsItems.push({key:'enterprise-maintenance',label:'系统维护',icon:'i-lucide-settings',children:maintenance})
 const baseGroups:ConsoleMenuGroup[]=[...(tenantId.value?[{key:'workbench',label:'工作台',icon:'i-lucide-layout-dashboard',to:tenantContext.current.value?.site.consoleRoutes?.find(item=>item.group==='workbench')?.path||base+'/workbench',items:[]}]:[]),...(permissionItems.length?[{key:'permissions',label:'权限管理',icon:'i-lucide-shield-check',items:markConsoleItems(permissionItems,displayPath.value)}]:[]),...(hasMaterials.value?[{key:'materials',label:'素材管理',icon:'i-lucide-images',to:base+'/materials',items:[]}]:[]),...(hasPayments.value?[{key:'decoration',label:'装修管理',icon:'i-lucide-panels-top-left',items:markConsoleItems([{key:'decoration-mobile',label:'手机端',icon:'i-lucide-smartphone',children:[{label:'页面装修',icon:'i-lucide-layout-grid',to:base+'/decoration'},{label:'登录页设置',icon:'i-lucide-log-in',to:base+'/decoration-login'},{label:'主题风格',icon:'i-lucide-palette',to:base+'/decoration-theme'},{label:'底部导航',icon:'i-lucide-panel-bottom',to:base+'/decoration-navigation'},{label:'页面路径',icon:'i-lucide-link',to:base+'/page-routes'},{label:'模板库',icon:'i-lucide-bookmark',to:base+'/decoration-templates'}]}],displayPath.value)}]:[]),...(users.length?[{key:'users',label:'用户管理',icon:'i-lucide-users',items:markConsoleItems(users,displayPath.value)}]:[]),...(transactions.length?[{key:'transactions',label:'交易管理',icon:'i-lucide-credit-card',items:markConsoleItems(transactions,displayPath.value)}]:[]),...(hasPayments.value?[{key:'channels',label:'渠道管理',icon:'i-lucide-waypoints',items:markConsoleItems([{label:'微信小程序',icon:'i-lucide-smartphone',to:base+'/mini-program'},{label:'微信公众号',icon:'i-lucide-message-circle',to:base+'/official-account'},{label:'H5端',icon:'i-lucide-globe',to:base+'/h5'}],displayPath.value)}]:[]),...(helpItems.length?[{key:'content',label:'内容管理',icon:'i-lucide-file-text',items:markConsoleItems(helpItems,displayPath.value)}]:[]),...(settingsItems.length?[{key:'settings',label:'系统设置',icon:'i-lucide-settings',items:markConsoleItems(settingsItems,displayPath.value)}]:[])].sort((a,b)=>['users','transactions','materials','content','decoration','channels','permissions','settings'].indexOf(a.key)-['users','transactions','materials','content','decoration','channels','permissions','settings'].indexOf(b.key))
 return applicationMenus(filterFeatures(baseGroups,tenantContext.current.value?.site.features),tenantContext.current.value?.site.consoleRoutes||[],selectionPath.value)
})
const breadcrumbs=computed(()=>displayPath.value==='/admin/profile'?[{label:'个人资料'}]:consoleBreadcrumbs(menuGroups.value,selectionPath.value))
const {openGroups,toggleGroup}=useConsoleMenuExpansion('tenant',menuGroups,()=>tenantId.value)
function refreshPage(){emit('refresh')}
</script>
<template><ConsoleFrame :class="{'decoration-overview-shell':decorationOverviewPage,'h5-channel-shell':displayPath==='/admin/h5'}" :fill="materialPage||decorationSettingsPage||decorationOverviewPage||displayPath==='/admin/h5'" :workspace="decorationSettingsPage||decorationOverviewPage||displayPath==='/admin/h5'" :stretch="displayPath==='/admin/official-account'" portal="tenant" brand-to="/admin/workbench" profile-to="/admin/profile" :breadcrumbs="breadcrumbs" :refreshing="refreshing" @refresh="refreshPage"><template #navigation="{collapsed}"><template v-for="group in menuGroups" :key="group.key"><ConsoleSidebarLink v-if="group.to" :label="group.label" :icon="group.icon" :to="group.to" :active="group.active" :collapsed="collapsed"/><AreaSidebarGroup v-else :group-key="group.key" :label="group.label" :icon="group.icon" :items="group.items" :open-groups="openGroups" :collapsed="collapsed" @toggle="toggleGroup"/></template></template><slot/></ConsoleFrame></template>

<style scoped>@media(max-width:900px){.h5-channel-shell :deep(.qisvc-console-panel){height:auto;min-height:100dvh;overflow:visible}.h5-channel-shell :deep(.qisvc-console-panel-body){overflow:visible!important}.h5-channel-shell :deep(.console-frame-stage){height:auto}.h5-channel-shell :deep(.console-page-content){flex:none}}</style>
