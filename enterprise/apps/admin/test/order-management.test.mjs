import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as vue from 'vue';
import {renderToString} from 'vue/server-renderer';
import {consoleTitle} from '../app/utils/console-title.ts';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('legacy after-sales links use only the current authorized route and preserve query/hash',async()=>{
 const source=await readFile(new URL('../app/pages/tenant/after-sales.vue',import.meta.url),'utf8'),script=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
 for(const routes of [[],[{path:'/admin/orders'}],[{path:'/admin/business-orders',afterSales:true}]]){
  const moves=[],env={require:()=>({}),exports:{},definePageMeta(){},useRoute:()=>({query:{applicationKey:'legacy',tab:'other'},hash:'#sale'}),useTenantContext:()=>({current:vue.ref({site:{consoleRoutes:routes}})}),navigateTo:async(target,options)=>moves.push({target,options})};
  const orders=await new Function(...Object.keys(env),`return(async()=>{${compile(script)};return orders})()`)(...Object.values(env));
  if(routes[0]?.afterSales){assert.equal(orders.path,'/admin/business-orders');assert.deepEqual(moves,[{target:{path:'/admin/business-orders',query:{applicationKey:'legacy',tab:'after-sales'},hash:'#sale'},options:{external:true,replace:true,redirectCode:302}}])}
  else {assert.equal(orders,undefined);assert.deepEqual(moves,[],'zero-app and after-sales-only users retain the public page')}
 }
});

test('public order-management first HTML and refresh retain the final title and tenant favicon',async()=>{
 const source=await readFile(new URL('../app/app.vue',import.meta.url),'utf8'),script=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
 for(const path of ['/admin/after-sales','/admin/after-sales/'])for(let refresh=0;refresh<2;refresh++){
  let head;const env={require:()=>({consoleTitle}),exports:{},computed:vue.computed,useRoute:()=>({path,fullPath:path+'?tab=after-sales',query:{tab:'after-sales'}}),useConsoleNavigation:()=>({target:vue.ref(null)}),useSiteBranding:()=>({site:vue.ref({}),resolvedSite:vue.ref({platform:{name:'QiCore'},tenant:{name:'测试站点',favicon:'/tenant-favicon.png'}})}),useTenantContext:()=>({}),useHead:fn=>head=fn()};
  await new Function(...Object.keys(env),`return(async()=>{${compile(script)}})()`)(...Object.values(env));
  const html=await renderToString(vue.createSSRApp({render:()=>vue.h('html',[vue.h('head',[vue.h('title',head.title),vue.h('link',head.link[0])])])}));
  assert.match(html,/<title>订单管理 · 测试站点<\/title>/);assert.match(html,/href="\/tenant-favicon.png"/);
 }
});


test('document title follows accepted navigation, strips hash and restores the old title on cancellation',async()=>{
 const source=await readFile(new URL('../app/app.vue',import.meta.url),'utf8'),script=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
 const route=vue.reactive({path:'/admin/data-security',fullPath:'/admin/data-security',query:{}}),target=vue.ref(null);let head;
 const env={require:()=>({consoleTitle}),exports:{},computed:vue.computed,useRoute:()=>route,useConsoleNavigation:()=>({target}),useSiteBranding:()=>({site:vue.ref({}),resolvedSite:vue.ref({platform:{name:'QiCore'},tenant:{name:'测试站点',favicon:'/tenant.png'}})}),useTenantContext:()=>({}),useHead:fn=>head=fn};
 await new Function(...Object.keys(env),`return(async()=>{${compile(script)}})()`)(...Object.values(env));
 assert.equal(head().title,'数据安全 · 测试站点');target.value={path:'/admin/after-sales',fullPath:'/admin/after-sales?tab=after-sales#history'};assert.equal(head().title,'订单管理 · 测试站点');target.value=null;assert.equal(head().title,'数据安全 · 测试站点');route.path='/admin/after-sales';route.fullPath='/admin/after-sales#history';assert.equal(head().title,'订单管理 · 测试站点');
});
