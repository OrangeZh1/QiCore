// Page URLs are account-scoped. Tenant IDs are accepted only by the legacy redirect.
const pages=new Set(['updates','system-logs','environment','scheduled-tasks','system-cache','data-security','profile','workbench','recharge','recharge-orders','administrators','roles','channels','h5','member-levels','member-tags','help','help-editor','decoration-login','decoration-theme','decoration-navigation','page-routes','decoration-templates','policy-editor','decoration-editor','decoration','user-settings','user-registration','customer-service','points-ledger','after-sales','subscriptions','notifications','message-records','sms','site','storage','mini-program','official-account','policies','payments','entitlements','entitlement-ledger','transactions','packages','users','materials','applications','login'])
export function isTenantPage(path:string){
 return path==='/admin'||pages.has(path.replace(/^\/admin\//,''))&&/^\/admin\/[^/]+$/.test(path)||/^\/admin\/(?:apps\/[a-z0-9][a-z0-9-]{0,63}|payments\/(?:wechat|alipay|wechat-virtual)|scheduled-tasks\/[^/]+)$/.test(path)
}
export function legacyTenantRoute(path:string){
 if(isTenantPage(path))return null
 const match=/^\/admin\/([^/]+)(?:\/(.+))?$/.exec(path)
 if(!match)return null
 let tenantId:string
 try{tenantId=decodeURIComponent(match[1]!)}catch{return null}
 const target='/admin/'+(match[2]||'applications')
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId)||!isTenantPage(target)||target==='/admin/login')return null
 return{tenantId,path:target}
}
