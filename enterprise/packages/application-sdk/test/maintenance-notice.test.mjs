import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import * as maintenance from '../../../apps/api/src/core/maintenance-client.mjs';
const require=createRequire(new URL('../../../apps/admin/package.json',import.meta.url)),vue=require('vue'),compiler=require('vue/compiler-sfc'),{renderToString}=require('vue/server-renderer');
test('actual client notices render accurate recovery, timeout and manual-confirmation copy',async()=>{
 const dialogSource=compiler.parse(await readFile(new URL('../client/components/ClientDialog.vue',import.meta.url),'utf8')).descriptor;const dialogScript=compiler.compileScript(dialogSource,{id:'maintenance-dialog',inlineTemplate:true,templateOptions:{compilerOptions:{isCustomElement:tag=>['view','text','scroll-view'].includes(tag)}}});const dialogCode=(await transform(dialogScript.content,{loader:'ts',format:'cjs'})).code,dialogModule={exports:{}};new Function('require','module','exports',dialogCode)(name=>name==='vue'?vue:{isH5:false},dialogModule,dialogModule.exports);
 for(const file of ['../client/components/ClientMaintenanceNotice.vue']){
  const {descriptor}=compiler.parse(await readFile(new URL(file,import.meta.url),'utf8'));
  const script=compiler.compileScript(descriptor,{id:'maintenance-notice',inlineTemplate:true,templateOptions:{compilerOptions:{isCustomElement:tag=>['view','text'].includes(tag)}}});
  const {code}=await transform(script.content,{loader:'ts',format:'cjs'});
  for(const state of [{active:true,state:'updating'},{active:true,state:'recovery_required'},{active:true,state:'recovery_required',paused:true},{active:true,state:'updating',unreachable:true},{active:false,state:'ready'}]){
   const ref=value=>vue.ref(value?.active===false?state:value),module={exports:{}};
   new Function('require','module','exports','ref','useRuntimeConfig','onMounted','onBeforeUnmount',code)(name=>name==='vue'?{...vue,ref}:name.includes('maintenance-client')?maintenance:name==='@dcloudio/uni-app'?{onShow(){},onHide(){}}:name==='./ClientDialog.vue'?{__esModule:true,default:dialogModule.exports.default}:name==='../lib/api'?{isH5:false}:{maintenance:{}},module,module.exports,ref,()=>({public:{apiBase:'/api/v1'}}),()=>{},()=>{});
   const app=vue.createSSRApp(module.exports.default);app.component('UButton',{render(){return vue.h('button',this.$slots.default?.())}});const html=await renderToString(app);
   if(!state.active){assert.doesNotMatch(html,/检查状态/);continue}
   const presentation=maintenance.maintenancePresentation(state);assert.ok(html.includes(presentation.title));assert.ok(html.includes(presentation.hint));assert.ok(html.includes(presentation.description));
   if(state.paused){assert.match(html,/手动确认恢复/);assert.doesNotMatch(html,/恢复后自动重载/)}
   if(state.state==='recovery_required')assert.doesNotMatch(html,/>系统正在更新</);
  }
 }
});
