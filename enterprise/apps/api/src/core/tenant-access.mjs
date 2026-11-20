// A scoped role replaces legacy account grants for that site; it never adds to them.
export const tenantManagementPermissions=['tenant:accounts.read','tenant:accounts.write','tenant:roles.read','tenant:roles.write'];
export function activeTenantScope(scope){return scope.enabled!==false&&(!scope.permissionRoleId||!!scope.permissionRole?.enabled&&scope.permissionRole.tenantId===scope.tenantId)}
export function tenantGrants(account,tenantId){
 const scope=account.scopes.find(row=>row.tenantId===tenantId);
 if(!scope||!activeTenantScope(scope))return [];
 return scope.permissionRoleId?scope.permissionRole.permissions:account.role.permissions;
}
export function tenantGrantMap(account){return Object.fromEntries(account.scopes.filter(activeTenantScope).map(scope=>[scope.tenantId,tenantGrants(account,scope.tenantId)]))}
