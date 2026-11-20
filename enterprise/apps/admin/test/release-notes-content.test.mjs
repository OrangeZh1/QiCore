import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {transform} from 'esbuild';
import * as notes from '../app/utils/update-center.ts';
const require=createRequire(import.meta.url),vue=require('vue'),compiler=require('vue/compiler-sfc'),{renderToString}=require('vue/server-renderer');
test('the real log component keeps an absent Boolean unknown, parses markers once, and renders safe classified text',async()=>{
 const {descriptor}=compiler.parse(await readFile(new URL('../app/components/console/ReleaseNotesContent.vue',import.meta.url),'utf8'));
 const script=compiler.compileScript(descriptor,{id:'release-notes',inlineTemplate:true});const {code}=await transform(script.content,{loader:'ts',format:'cjs'}),module={exports:{}};
 new Function('require','module','exports','computed',code)(name=>name==='vue'?vue:notes,module,module.exports,vue.computed);
 async function render(props){const app=vue.createSSRApp(module.exports.default,props);app.component('UAlert',{props:['title'],render(){return vue.h('aside',this.title)}});app.component('UBadge',{props:['color'],render(){return vue.h('span',{'data-color':this.color},this.$slots.default?.())}});return renderToString(app)}
 assert.doesNotMatch(await render({notes:'旧格式日志'}),/无需更新|自行上传/);
 assert.match(await render({notes:'小程序更新：需要客户自行上传'}),/需要客户自行上传/);
 assert.equal((await render({notes:'小程序更新：需要客户自行上传\n小程序更新：需要客户自行上传'})).match(/需要客户自行上传/g).length,1);
 assert.match(await render({notes:'小程序更新：无需更新'}),/本次小程序无需更新/);
 assert.doesNotMatch(await render({notes:'小程序更新：需要客户自行上传',component:'framework'}),/自行上传/);
 const html=await render({notes:'【新增：普通标题】\n新增：one\n修复：two\n优化：three\n安全：four\n调整：five\n\n<script>alert(1)</script>'});
 for(const color of ['info','success','warning','error','neutral'])assert.ok(html.includes('data-color="'+color+'"'));
 assert.equal((html.match(/data-color=/g)||[]).length,5);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
