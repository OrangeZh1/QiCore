import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Render the real SFC and CSS. Only the separate preview dialog and icon are stubbed.
test('image tiles use one Tab stop with arrow access to edit, preview and clear',{timeout:30000},async t=>{
 const require=createRequire(new URL('../package.json',import.meta.url)),{parse,compileScript}=require('vue/compiler-sfc');
 const file=fileURLToPath(new URL('../app/components/console/ImageSelectTile.vue',import.meta.url)),{descriptor}=parse(await readFile(file,'utf8'));
 const compiled=compileScript(descriptor,{id:'image-tile-fixture',inlineTemplate:true}).content;
 const result=await build({stdin:{contents:`import {createApp,h,reactive} from 'vue';import Tile from 'fixture-tile';
 const state=reactive({src:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',removeDisabled:false,disabled:false,selected:0,removed:0});window.fixture=state;
 createApp({setup:()=>()=>h('main',[h('button',{id:'before'},'前一个'),h(Tile,{label:'封面',src:state.src,removable:!!state.src,removeDisabled:state.removeDisabled,disabled:state.disabled,onSelect:()=>state.selected++,onRemove:()=>{state.removed++;state.src=null}}),h(Tile,{label:'空白'}),h(Tile,{label:'禁用',src:state.src,disabled:true,removable:true}),h('button',{id:'after'},'后一个')])}).component('UIcon',{render:()=>h('span')}).mount('#app');`,resolveDir:dirname(file)},write:false,bundle:true,format:'iife',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'actual-tile',setup(build){build.onResolve({filter:/^fixture-tile$/},()=>({path:file,namespace:'tile'}));build.onLoad({filter:/.*/,namespace:'tile'},()=>({contents:compiled,loader:'ts',resolveDir:dirname(file)}));build.onResolve({filter:/ImageViewer\.vue$/},()=>({path:'viewer',namespace:'viewer'}));build.onLoad({filter:/.*/,namespace:'viewer'},()=>({contents:"import {h} from 'vue';export default {props:['open'],render(){return this.open?h('p',{'data-preview':'open'},'预览已打开'):null}}",resolveDir:dirname(file)}))}}]});
 const html='<!doctype html><html><head><style>:root{--ui-primary:#1677ff;--ui-border:#ccc;--ui-bg-elevated:#fff}main{display:flex;gap:30px;padding:30px}'+descriptor.styles.map(s=>s.content).join('\n')+'</style></head><body><div id="app"></div><script>'+result.outputFiles[0].text+'</script></body></html>';
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch({
  headless:process.env.TEST_BROWSER_HEADED!=='1',
  channel:process.env.TEST_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':'chromium'),
  executablePath:process.env.QA_CHROMIUM
 });t.after(()=>browser.close());
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 const focused=()=>page.evaluate(()=>document.activeElement?.getAttribute('aria-label')||document.activeElement?.id);
 await page.locator('#before').focus();await page.keyboard.press('Tab');assert.equal(await focused(),'修改封面');
 assert.equal(await page.locator('[role="toolbar"]').first().locator('button[tabindex="0"]').count(),1);
 assert.equal(await page.getByRole('button',{name:'修改封面',exact:true}).evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
 await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.fixture.selected),1);
 await page.keyboard.press('ArrowRight');assert.equal(await focused(),'查看封面');await page.keyboard.press('Enter');assert.equal(await page.locator('[data-preview="open"]').count(),1);
 await page.keyboard.press('ArrowRight');assert.equal(await focused(),'清除封面');await page.keyboard.press('Tab');assert.equal(await focused(),'选择空白');
 await page.keyboard.press('Tab');assert.equal(await focused(),'after');await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'选择空白');await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'清除封面');
 await page.keyboard.press('ArrowRight');assert.equal(await focused(),'修改封面');await page.keyboard.press('ArrowLeft');assert.equal(await focused(),'清除封面');
 await page.evaluate(()=>window.fixture.removeDisabled=true);await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='修改封面');
 await page.keyboard.press('End');assert.equal(await focused(),'查看封面');await page.keyboard.press('ArrowRight');assert.equal(await focused(),'修改封面');
 await page.evaluate(()=>window.fixture.removeDisabled=false);await page.keyboard.press('End');assert.equal(await focused(),'清除封面');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='选择封面');assert.equal(await page.evaluate(()=>window.fixture.removed),1);await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.fixture.selected),2);
 await page.keyboard.press('Shift+Tab');assert.equal(await focused(),'before');
 await page.evaluate(()=>{window.fixture.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';window.fixture.disabled=true});await page.keyboard.press('Tab');assert.equal(await focused(),'选择空白');
 assert.equal(await page.locator('[aria-label="封面图片操作"] button:not(:disabled)').count(),0);
 await page.evaluate(()=>window.fixture.disabled=false);await page.getByRole('button',{name:'选择封面',exact:true}).click();assert.equal(await page.evaluate(()=>window.fixture.selected),3);
});
