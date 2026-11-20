import test from 'node:test'
import assert from 'node:assert/strict'
import {projectSdkRoutes,setupEnterpriseConsole} from '../console-routes.mjs'

test('应用 SDK 把原页面源码注册为 /admin，公开元数据及新源码使用相同地址',()=>{
  const pages=[{path:'/tenant/orders',name:'tenant-orders',file:'pages/tenant/orders.vue'},{path:'/admin/reports',name:'admin-reports'}]
  let hook
  const nuxt={options:{runtimeConfig:{public:{nativeApplication:{key:'sample-app',routes:['/tenant/orders','/admin/reports']}}}},
    hook(name,handler){assert.equal(name,'pages:extend');hook=handler}}
  setupEnterpriseConsole({},nuxt)
  hook(pages)
  assert.deepEqual(nuxt.options.runtimeConfig.public.nativeApplication.routes,['/admin/orders','/admin/reports'])
  assert.deepEqual(pages.map(({path,name})=>[path,name]),[['/admin/orders','tenant-orders'],['/admin/reports','admin-reports']])
  assert.equal(pages[0].file,'pages/tenant/orders.vue')
})
test('应用 SDK 遇到两个源码页声明同一对外地址及保留框架页时终止构建',()=>{
  assert.throws(()=>projectSdkRoutes([{path:'/tenant/orders'},{path:'/admin/orders'}]),/PAGE_CONFLICT/)
  assert.throws(()=>projectSdkRoutes([{path:'/tenant/roles'}]),/RESERVED_OR_INVALID/)
  assert.throws(()=>projectSdkRoutes([{path:'/tenant/orders',alias:'/admin/orders'}]),/PAGE_CONFLICT/)
})
