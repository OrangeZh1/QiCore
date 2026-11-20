import type {AdminSession} from '../composables/useApi'
import type {TenantEntryView} from './tenant-entry'

// Only the host's Node request owns this value. It is never read from headers,
// cookies or client state, and is removed when the embedded renderer returns.
export const consoleRenderContext=Symbol.for('qicore.console-render-context.v1')
export type ConsoleRenderContext={applicationKey:string;path:string;session:AdminSession;entry:TenantEntryView}
type RenderRequest={method?:string;url?:string;[consoleRenderContext]?:ConsoleRenderContext}

export function consoleRenderData(request:RenderRequest|undefined,applicationKey:string|undefined,url:string){
 const context=request?.[consoleRenderContext]
 if(!context||!['GET','HEAD'].includes(request?.method||'')||!applicationKey||context.applicationKey!==applicationKey||request?.url?.split('?')[0]?.replace(/\/$/,'')!==context.path)return
 const {session,entry}=context,tenant=entry.tenant
 if(session.role!=='tenant'||!(Date.parse(session.expiresAt)>Date.now())||!tenant?.enabled||!session.tenantIds.includes(tenant.id)||session.delegated&&session.tenantId!==tenant.id||!session.delegated&&tenant.expiresAt&&!(Date.parse(tenant.expiresAt)>Date.now()))return
 if(!entry.applications.some(app=>app.key===applicationKey&&app.state==='available'&&app.consoleRoutes?.some(route=>route.path===context.path)))return
 if(url==='/admin/auth/me')return structuredClone(session)
 if(url==='/admin/tenant-entry?tenantId='+encodeURIComponent(tenant.id))return structuredClone(entry)
}
