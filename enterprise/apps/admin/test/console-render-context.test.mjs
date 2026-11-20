import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consoleRenderContext,consoleRenderData} from '../app/utils/console-render-context.ts';

function request(id='alpha'){
 const tenant={id,enabled:true,expiresAt:null},session={id:'account-'+id,role:'tenant',tenantIds:[id],expiresAt:'2099-01-01'};
 const entry={tenant,applications:[{key:'example',state:'available',consoleRoutes:[{path:'/tenant/example'}]}]};
 return{method:'GET',url:'/tenant/example?tab=recent',[consoleRenderContext]:{applicationKey:'example',path:'/tenant/example',session,entry}};
}
test('render snapshots remain request, application, route and tenant scoped and cannot be supplied by HTTP headers',()=>{
 const a=request(),b=request('beta');
 assert.equal(consoleRenderData(a,'example','/admin/auth/me').id,'account-alpha');assert.equal(consoleRenderData(b,'example','/admin/auth/me').id,'account-beta');
 const copy=consoleRenderData(a,'example','/admin/tenant-entry?tenantId=alpha');copy.tenant.id='modified';assert.equal(a[consoleRenderContext].entry.tenant.id,'alpha');
 for(const url of ['/admin/tenant-entry','/admin/tenant-entry?tenantId=beta','/admin/tenant-entry?tenantId=alpha&applicationKey=example','/admin/tenants/alpha/branding'])assert.equal(consoleRenderData(a,'example',url),undefined);
 assert.equal(consoleRenderData(a,'other','/admin/auth/me'),undefined);assert.equal(consoleRenderData({...a,method:'POST'},'example','/admin/auth/me'),undefined);assert.equal(consoleRenderData({...a,url:'/tenant/other'},'example','/admin/auth/me'),undefined);
 assert.equal(consoleRenderData({method:'GET',url:a.url,headers:{'x-qicore-console-context':JSON.stringify(a[consoleRenderContext])}},'example','/admin/auth/me'),undefined);
});
test('expired, disabled, unbound and mismatched scopes fall back to live checks',()=>{
 for(const change of [c=>c.session.expiresAt='2000-01-01',c=>c.session.expiresAt='invalid',c=>c.session.role='root',c=>c.session.tenantIds=[],c=>c.entry.tenant.enabled=false,c=>c.entry.tenant.expiresAt='2000-01-01',c=>c.entry.applications[0].state='expired',c=>c.entry.applications[0].consoleRoutes=[],c=>{c.session.delegated=true;c.session.tenantId='other'}]){
  const value=request();change(value[consoleRenderContext]);assert.equal(consoleRenderData(value,'example','/admin/auth/me'),undefined);
 }
 const maintenance=request(),scope=maintenance[consoleRenderContext];scope.session.delegated=true;scope.session.tenantId='alpha';scope.entry.tenant.expiresAt='2000-01-01';assert.equal(consoleRenderData(maintenance,'example','/admin/auth/me').id,'account-alpha');
});
