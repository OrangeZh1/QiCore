import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {ref,computed} from 'vue';

test('public branding coalesces in-flight reads per Nuxt request, isolates concurrent renders and retries failures',async()=>{
 const source=(await readFile(new URL('../app/composables/useSiteBranding.ts',import.meta.url),'utf8')).replaceAll('import.meta.server','true');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const output={},requests=[];let active;
 const useState=(key,init)=>{if(!active.states.has(key))active.states.set(key,ref(init()));return active.states.get(key)};
 new Function('exports','useState','useRuntimeConfig','useRoute','useNuxtApp','computed','$fetch',code)(output,useState,()=>({apiInternalBase:'/api/v1'}),()=>({path:'/admin/users'}),()=>active,computed,(url)=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})));
 active={states:new Map()};const first=output.useSiteBranding(),same=output.useSiteBranding(),a=first.load(),again=same.load();assert.equal(a,again);assert.equal(requests.length,1);
 active={states:new Map()};const second=output.useSiteBranding(),b=second.load();assert.equal(requests.length,2);
 requests[0].resolve({data:{version:1}});requests[1].resolve({data:{version:2}});await Promise.all([a,b]);assert.equal(first.site.value.version,1);assert.equal(second.site.value.version,2);
 const refresh=first.load();assert.equal(requests.length,3,'completed loads do not cache later refreshes');const failed=assert.rejects(refresh,/offline/);requests[2].reject(Error('offline'));await failed;assert.equal(first.site.value.version,1);
 const retry=first.load();requests[3].resolve({data:{version:3}});await retry;assert.equal(first.site.value.version,3);assert.equal(second.site.value.version,2);
});
