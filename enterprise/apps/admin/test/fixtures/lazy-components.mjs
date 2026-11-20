import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';

export async function checkLazyComponents({browser,origin,row,state,output,manifestPath,decorationBlock}){
 const manifest=(await import(pathToFileURL(manifestPath).href)).default;
 const chunk=name=>{const item=Object.values(manifest).find(item=>item.resourceType==='script'&&item.name===name);assert.ok(item,'Missing chunk: '+name);return item.file};
 const files={theme:chunk('DecorationThemePanel'),content:chunk('DecorationBlockContentPanel'),material:chunk('MaterialBrowser'),rich:chunk('DecorationRichTextPreview'),editor:chunk('ConsoleRichTextEditor'),wang:Object.entries(manifest).find(([name,value])=>name.includes('@wangeditor/editor/dist/index.esm.js')&&value.resourceType==='script')?.[1].file};
 assert.ok(files.wang);
 const checks=[],observedErrors=[],hydrationWarnings=[],contexts=[];
 const create=async()=>{const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);const page=await context.newPage(),requests=new Set();page.on('pageerror',e=>observedErrors.push(e.message));page.on('console',m=>{if(/hydration.*mismatch/i.test(m.text()))hydrationWarnings.push({path:new URL(page.url()).pathname,message:m.text()})});page.on('request',r=>requests.add(new URL(r.url()).pathname.split('/').pop()));return{page,requests}};
 const open=async page=>{await page.goto(origin+'/tenant/decoration-editor?application=performance-app&page=home');await page.locator('.studio-properties input[type=text]').first().waitFor();await page.waitForTimeout(250)};
 const theme=page=>page.getByRole('navigation',{name:'编辑区域'}).getByRole('button',{name:'主题',exact:true});
 try{
  const first=await create(),p=first.page,initiators=[];
  let release;const held=new Promise(r=>release=r);await p.route('**/'+files.theme,async route=>{await held;await route.continue()});
  const cdp=await p.context().newCDPSession(p);await cdp.send('Network.enable');cdp.on('Network.requestWillBeSent',e=>{if(Object.values(files).some(f=>e.request.url.endsWith(f)))initiators.push({url:e.request.url,initiator:e.initiator})});await open(p);
  await writeFile(join(state,'lazy-initial.json'),JSON.stringify({files,initiators,requests:[...first.requests],resources:await p.evaluate(()=>performance.getEntriesByType('resource').map(r=>({name:r.name,initiatorType:r.initiatorType})))},null,2));
  for(const file of Object.values(files))assert.equal(first.requests.has(file),false,'Ordinary editor must not fetch '+file);
  const ordinaryEditorScripts=[...first.requests].filter(name=>name.endsWith('.js'));
  checks.push('ordinary-editor-excludes-content-material-richtext-and-wangeditor');
  const title=p.locator('.studio-properties input[type=text]').first();await title.fill('按需加载草稿');await theme(p).click();await p.getByRole('status').filter({hasText:'正在加载主题面板'}).waitFor();
  assert.equal(await p.locator('.studio-header-actions .animate-spin').count(),0);
  await p.getByRole('navigation',{name:'编辑区域'}).getByRole('button',{name:'首页',exact:true}).click();assert.equal(await title.inputValue(),'按需加载草稿');release();
  await theme(p).click();await p.locator('.theme-panel').waitFor();checks.push('slow-panel-and-close-while-pending-preserve-draft');

  const failed=await create(),q=failed.page;let attempts=0;
  await q.route('**/'+files.content,route=>++attempts===1?route.abort('failed'):route.continue());await open(q);
  const qt=q.locator('.studio-properties input[type=text]').first();await qt.fill('失败恢复草稿');await q.locator('[data-block-id]').first().click();await q.getByRole('button',{name:'重新加载页面',exact:true}).waitFor();
  const reloadGuard=q.waitForEvent('dialog').then(async dialog=>{assert.equal(dialog.type(),'beforeunload');await dialog.dismiss()});await Promise.all([reloadGuard,q.getByRole('button',{name:'重新加载页面',exact:true}).click()]);await q.getByText('组件内容加载失败',{exact:true}).waitFor();
  await q.getByRole('button',{name:'保存',exact:true}).click();await q.waitForFunction(()=>document.querySelector('.studio-state')?.textContent?.includes('已保存并生效'));
  await q.getByRole('button',{name:'重新加载页面',exact:true}).click();await qt.waitFor();assert.equal(await qt.inputValue(),'失败恢复草稿');await q.locator('[data-block-id]').first().click();await q.locator('.block-content-panel').waitFor();
  assert.ok(attempts>=2);checks.push('failed-chunk-keeps-save-available-and-saved-draft-survives-reload');

  await q.locator('.studio-properties .image-select-target').first().click();await q.locator('.material-browser').waitFor();assert.ok(failed.requests.has(files.material));
  assert.equal(failed.requests.has(files.wang),false,'Choosing an ordinary component must not load wangEditor');await q.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await q.getByRole('button',{name:'页面设置',exact:true}).click();assert.equal(await qt.inputValue(),'失败恢复草稿');checks.push('material-browser-loads-only-when-opened');

  const block=decorationBlock('rich-text','00000000-0000-4000-8000-000000000001',[]);block.html='<p>安全正文</p><script>window.__unsafe=1</script><img src="x" onerror="window.__unsafe=1"><a href="javascript:window.__unsafe=1">非法链接</a>';row.scheme.home.blocks.push(block);
  const rich=await create(),r=rich.page;await open(r);await r.locator('.extra-rich').filter({hasText:'安全正文'}).waitFor();assert.equal(await r.locator('.extra-rich script, .extra-rich [onerror], .extra-rich a[href^="javascript:"]').count(),0);assert.equal(await r.evaluate(()=>window.__unsafe),undefined);assert.ok(rich.requests.has(files.rich));assert.equal(rich.requests.has(files.wang),false);
  // Editing receives the server-sanitized document; hostile markup above tests
  // the preview's additional sanitization boundary independently.
  block.html='<p>安全正文</p>';await open(r);
  let editorReady;const editorHeld=new Promise(resolve=>editorReady=resolve);await r.route('**/'+files.wang,async route=>{await editorHeld;await route.continue()});
  await r.locator('[data-block-id="'+block.id+'"]').click();await r.getByRole('status').filter({hasText:'正在加载富文本编辑器'}).first().waitFor();editorReady();
  const textbox=r.getByRole('textbox',{name:'富文本正文',exact:true});await textbox.waitFor();await r.getByRole('status').filter({hasText:'正在加载富文本编辑器'}).waitFor({state:'hidden'});
  await textbox.click();await r.keyboard.press('ControlOrMeta+A');await r.waitForFunction(()=>getSelection()?.toString()===document.querySelector('[contenteditable]')?.textContent);await textbox.pressSequentially('lazy editor regression',{delay:30});
  await r.locator('.extra-rich').filter({hasText:'lazy editor regression'}).waitFor();assert.equal(await r.evaluate(()=>window.__unsafe),undefined);checks.push('rich-preview-sanitizes-and-editor-loads-only-on-edit');
  await r.screenshot({path:join(state,'lazy-editor.png')});
  assert.deepEqual(hydrationWarnings,[],'lazy editor scenarios must hydrate without mismatches');
  const direct=await create();for(const [path,selector,title] of [['/tenant/materials','.material-browser','素材管理'],['/tenant/decoration-theme','.theme-panel','主题风格']]){
   const response=await direct.page.goto(origin+path);await direct.page.locator(selector).waitFor();const htmlTitle=(await response.text()).match(/<title>(.*?)<\/title>/)?.[1];assert.ok(htmlTitle?.includes(title));assert.equal(await direct.page.title(),htmlTitle);
  }checks.push('direct-material-and-theme-pages-keep-SSR-title-and-rendering');
  const bytes={};for(const [name,file] of Object.entries(files)){const data=await readFile(join(output,'public/_nuxt',file));bytes[name]={file,bytes:data.length,gzipBytes:gzipSync(data).length}}
  assert.deepEqual(observedErrors,[]);
  // The same standalone material-page warning was independently reproduced in
  // the pre-change build. Report it explicitly; do not claim it was repaired here.
  assert.ok(hydrationWarnings.length<=1&&hydrationWarnings.every(w=>w.path==='/tenant/materials'&&w.message==='Hydration completed but contains mismatches.'));
  const result={checks,bytes,ordinaryEditorScripts,recoveryRequests:attempts,pageErrors:observedErrors,knownBaselineWarnings:hydrationWarnings};await writeFile(join(state,'lazy-components.json'),JSON.stringify(result,null,2));return result;
 }finally{for(const context of contexts)await context.close()}
}
