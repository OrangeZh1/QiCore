import test from 'node:test'
import assert from 'node:assert/strict'
import {canonicalApplicationPage,canonicalConsoleRoutes} from '../src/applications/console-pages.mjs'
import {componentDescriptorSchema} from '../dist/applications/native-descriptor.js'

const route=path=>({path,label:'业务单据',permission:'orders.read',group:'transactions',icon:'i-lucide-receipt-text'})
const descriptor=routes=>({format:'qicore-application-v1',name:'应用夹具',key:'sample-app',version:'1.0.0',packageKey:'app_sample',pendingTasks:[],
  web:{admin:{entrypoint:'web/admin/server/index.mjs',publicDir:'web/admin/public',routes}}})

test('旧签名记录只读，对外仅序列化授权应用的 canonical 后台路由',()=>{
  const original=descriptor([route('/tenant/orders')]),bytes=JSON.stringify(original)
  const parsed=componentDescriptorSchema.parse(original)
  assert.equal(parsed.web.admin.routes[0].path,'/tenant/orders')
  assert.deepEqual(canonicalConsoleRoutes(parsed.web.admin.routes),[route('/admin/orders')])
  assert.equal(JSON.stringify(original),bytes)
  assert.equal(canonicalApplicationPage('/tenant/workbench'),'/admin/workbench')
  assert.equal(canonicalApplicationPage('/admin/workbench'),'/admin/workbench')
  assert.ok(componentDescriptorSchema.safeParse(descriptor([route('/admin/orders')])).success)
})
test('旧新地址冲突与宿主、平台及非法路径均不能声明为应用路由',()=>{
  const list=[route('/tenant/orders'),route('/admin/orders')]
  assert.throws(()=>canonicalConsoleRoutes(list),/CONFLICT/)
  assert.equal(componentDescriptorSchema.safeParse(descriptor(list)).success,false)
  for(const slug of ['roles','administrators','login','tenants','saas-users','updates','scheduled-tasks','environment','profile','data-security']){
    for(const area of ['admin','tenant'])assert.equal(componentDescriptorSchema.safeParse(descriptor([route('/'+area+'/'+slug)])).success,false)
  }
  for(const path of ['//external/orders','/adMIN/orders','/admin/orders?tenantId=x','/admin/%6Frders','/admin/orders/child']){
    assert.equal(canonicalApplicationPage(path),null)
  }
})
