import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { enterpriseAlias } from '../app/utils/enterprise-entry.ts'
import { applicationMenus } from '../app/utils/application-navigation.ts'
import { consoleBreadcrumbs } from '../app/utils/console-navigation.ts'

test('企业入口兼容旧书签，平台租户管理没有企业对应路由', () => {
  for (const [path, target] of Object.entries({
    '/': '/admin/workbench', '/login': '/admin/login', '/admin': '/admin/workbench',
    '/admin/login': undefined, '/admin/accounts': '/admin/administrators',
    '/admin/roles/': undefined, '/admin/applications': '/admin/workbench',
    '/admin/profile': undefined,
    '/tenant/roles': undefined,
  })) assert.equal(enterpriseAlias(path), target, path)
})

test('每个业务页最多选中一个入口，编辑页使用同一条面包屑', () => {
  const link = (label, path) => ({ label, icon: '', to: '/admin/' + path })
  const base = [
    { key: 'workbench', label: '工作台', icon: '', to: '/admin/workbench', items: [] },
    { key: 'content', label: '内容管理', icon: '', items: [link('帮助中心', 'help')] },
    { key: 'permissions', label: '权限管理', icon: '', items: [link('管理员', 'administrators'), link('角色', 'roles')] },
    { key: 'decoration', label: '装修管理', icon: '', items: [{key:'mobile',label:'手机端',icon:'',children:[link('页面装修','decoration'),link('模板库','decoration-templates')]}] },
    { key: 'settings', label: '系统设置', icon: '', items: [link('重复入口', 'help'), link('协议管理', 'policies')] },
  ]
  function selected(items) {
    return items.flatMap(item => 'children' in item ? selected(item.children) : item.active ? [item.label] : [])
  }
  for (const [path, leaf, crumbs] of [
    ['/admin/workbench','工作台',['工作台']],
    ['/admin/roles','角色',['权限管理','角色']],
    ['/admin/help-editor?id=1','帮助中心',['内容管理','帮助中心','帮助文章编辑']],
    ['/admin/policy-editor?kind=terms','协议管理',['系统设置','协议管理','协议编辑']],
    ['/admin/decoration-editor?template=1','模板库',['装修管理','手机端','模板库','装修编辑器']],
    ['/admin/decoration-editor?page=home','页面装修',['装修管理','手机端','页面装修','装修编辑器']],
  ]) {
    const groups = applicationMenus(base, [], path)
    assert.deepEqual(groups.flatMap(group => group.to ? group.active ? [group.label] : [] : selected(group.items)), [leaf], path)
    assert.deepEqual(consoleBreadcrumbs(groups,path).map(item=>item.label), crumbs, path)
  }
})

test('旧企业选择与多租户页面直接返回 404，不重定向到登录',async()=>{
 const src=await readFile(new URL('../app/middleware/01-enterprise-entry.global.ts',import.meta.url),'utf8')
 const code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const out={}
 new Function('require','exports','defineNuxtRouteMiddleware','useRuntimeConfig','navigateTo','createError',code)(
  ()=>({enterpriseAlias}),out,fn=>fn,()=>({public:{}}),()=>{throw Error('意外的旧入口重定向')},value=>Object.assign(Error(value.statusMessage),value))
 for(const path of ['/tenant','/tenant/login','/tenant/roles','/tenant/other/roles'])assert.throws(()=>out.default({path,query:{},hash:''}),e=>e.statusCode===404)
})
