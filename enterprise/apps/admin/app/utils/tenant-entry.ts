import type {ApplicationConsoleRoute} from './application-navigation'
export type TenantChoice={canManageProductUpdates?:boolean;features?:Record<string,boolean>;application?:ApplicationChoice|null;consoleRoutes?:ApplicationConsoleRoute[];canViewOverview?:boolean;canEnter?:boolean;id:string;name:string;enabled:boolean;expiresAt:string|null}
export type ApplicationChoice={consoleRoutes?:ApplicationConsoleRoute[];key:string;name:string;state:string;expiresAt:string|null}
export type TenantEntryView={permissions?:string[];tenants:TenantChoice[];tenant:TenantChoice|null;applications:ApplicationChoice[];application:ApplicationChoice|null;access:string;canViewOverview:boolean}
export const tenantAccessCopy:Record<string,{title:string;description:string;color:'success'|'warning'|'error'|'neutral'}>={
  'choose-tenant':{title:'请选择租户',description:'选择本次要管理的租户，查看它的应用。',color:'neutral'},
  'no-tenants':{title:'尚未关联租户',description:'请联系平台管理员关联租户后再进入。',color:'warning'},
  'no-applications':{title:'暂无可用应用',description:'查看下方应用状态，或联系管理员开通应用、分配权限。',color:'warning'},
  'not-open':{title:'应用尚未开通',description:'请联系平台管理员为当前租户开通此应用。',color:'warning'},
  'license-unavailable':{title:'应用授权不可用',description:'当前应用未获得有效使用授权，请联系平台管理员核实。',color:'warning'},
  disabled:{title:'应用已停用',description:'请联系平台管理员确认应用状态。',color:'warning'},
  expired:{title:'应用已到期',description:'请联系平台管理员处理应用续期。',color:'warning'},
  forbidden:{title:'暂无访问权限',description:'当前账号不能访问此租户或应用，请联系管理员核对授权。',color:'error'},
  'tenant-disabled':{title:'租户已停用',description:'请联系平台管理员确认租户状态。',color:'warning'},
  'tenant-expired':{title:'租户已到期',description:'请联系平台管理员处理租户续期。',color:'warning'},
  'unknown-application':{title:'应用不存在',description:'请返回站点，使用当前租户可访问的入口。',color:'warning'},
  'system-unavailable':{title:'应用暂时不可用',description:'平台服务当前不可用，请稍后重试或联系平台管理员。',color:'warning'},
}
export const applicationStateLabel:Record<string,string>={available:'可访问','not-open':'未开通','not-installed':'未安装','license-unavailable':'授权不可用',disabled:'已停用',expired:'已到期',forbidden:'无权限'}
export function tenantEntryUrl(tenantId:string,_applicationKey?:string){return tenantId?'/admin/applications':'/admin'}
export function tenantWorkbenchUrl(_tenantId?:string){return '/admin/workbench'}
export function tenantCanEnter(site:TenantChoice){return site.enabled&&(site.canEnter??(!site.expiresAt||Date.parse(site.expiresAt)>Date.now()))}
export function rememberedTenant(tenants:TenantChoice[],previousId:string,explicitSwitch=false){
 if(explicitSwitch)return undefined
 const available=tenants.filter(tenantCanEnter)
 return previousId?available.find(site=>site.id===previousId):available.length===1?available[0]:undefined
}
// Routes here have already been filtered by the server for this tenant/account.
export function tenantLandingUrl(entry:TenantEntryView,applicationKey?:string){
 if(!entry.tenant||!tenantCanEnter(entry.tenant)||['forbidden','tenant-disabled','tenant-expired','system-unavailable'].includes(entry.access))return null
 const apps=entry.applications.filter(app=>app.state==='available'&&(!applicationKey||app.key===applicationKey))
 if(apps.length!==1)return applicationKey?null:'/admin/workbench'
 const routes=(apps[0]!.consoleRoutes||[]).filter(route=>/^\/admin\/[a-z0-9-]+$/.test(route.path)&&!['/admin/applications','/admin/login'].includes(route.path))
 return routes.find(route=>route.group==='workbench')?.path||'/admin/workbench'
}
export function canViewTenantOverview(permissions:string[],available=true){return available&&permissions.some(p=>p==='overview.read'||!p.startsWith('tenant:')&&p.endsWith(':overview.read'))}
