import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,readdir,rm,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

test('the installed SDK resolves every public source import without framework sources and sanitizes browser previews',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-sdk-contract-'));
 t.after(async()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));await rm(root,{recursive:true,force:true})});
 const installed=join(root,'node_modules/@qicore/application-sdk');await mkdir(installed,{recursive:true});
 await cp(new URL('../package.json',import.meta.url),join(installed,'package.json'));
 await cp(new URL('../development.mjs',import.meta.url),join(installed,'development.mjs'));
 await cp(new URL('../dist',import.meta.url),join(installed,'dist'),{recursive:true});
 const require=createRequire(join(root,'package.json')),pkg=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));
 const contracts=await import(pathToFileURL(require.resolve('@qicore/application-sdk/contracts')).href);
 const template=contracts.applicationDescriptorSchema.parse(JSON.parse(await readFile(require.resolve('@qicore/application-sdk/templates/application-package/application.json'),'utf8')));
 const entry=await import(pathToFileURL(require.resolve('@qicore/application-sdk/templates/application-package/entry.mjs')).href);
 const application=entry.createApplication({version:1});
 assert.equal(application.definition.key,template.key);assert.equal(application.version,template.version);
 assert.equal(application.createRuntime().health(),true);
 const packageFiles={package_type:'app_update',package_key:template.packageKey,version:template.version,entrypoint:'entry.mjs',files:[{path:'application.json'},{path:'entry.mjs'}]};
 assert.doesNotThrow(()=>contracts.assertApplicationReleaseLayout(template,packageFiles));
 assert.throws(()=>contracts.assertApplicationReleaseLayout({...template,web:{h5:{directory:'web/h5'}}},packageFiles),/APPLICATION_LAYOUT_INCOMPLETE/);
 let imports=0;
 assert.ok(require.resolve('@qicore/application-sdk/development'));
 for(const file of (await readdir(join(installed,'dist'),{recursive:true})).filter(file=>/\.(?:ts|mts|mjs|vue)$/.test(file))){
  const code=await readFile(join(installed,'dist',file),'utf8');
  assert.doesNotMatch(code,/(?:\.\.\/)+api\/src\//,file+' must not import framework internals');
  for(const [,specifier] of code.matchAll(/['"](@qicore\/application-sdk\/[^'"]+)['"]/g)){
   assert.ok(require.resolve(specifier),file+' imports '+specifier);imports++;
  }
  if(file.startsWith('client'+sep))for(const [,quote,specifier] of code.matchAll(/\b(?:from\s+|import\s*)(['"])(\.[^'"]+)\1/g)){
   const target=resolve(dirname(join(installed,'dist',file)),specifier);
   assert.ok((await Promise.all(['','.ts','.mjs','.js','.vue','/index.ts'].map(extension=>stat(target+extension).then(entry=>entry.isFile(),()=>false)))).some(Boolean),file+' has an unresolved client import '+specifier);
  }
 }
 assert.ok(imports>0);
 for(const file of (await readdir(join(installed,'dist/browser'))).filter(file=>file.endsWith('.mjs'))){
  const declaration=pkg.exports['./browser/*.mjs'].types.replace('*',file.slice(0,-4));
  assert.ok((await readFile(join(installed,declaration))).length,file+' must expose types');
 }
 // Shared pages must work in an application that supplies no copies of framework images.
 for(const file of ['auth/eye-open.png','auth/eye-slashed.png','auth/wechat.png','brand/default-avatar.png',
  'member-levels/chevron-left.png','member-levels/chevron-right.png','member-levels/circle-check.png',
  'member-levels/coins-active.png','member-levels/crown.png','member-levels/shopping-bag-active.png',
  'member-levels/wallet-cards-active.png','member-levels/x.png','payments/wechat-pay.png']){
  const bytes=await readFile(join(installed,'dist/client/static',file));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',file+' must ship with the SDK');
 }
 assert.match(await readFile(join(installed,'dist/client/static/payments/alipay.svg'),'utf8'),/<svg\b/);
 await assert.rejects(readFile(join(installed,'dist/client/static/runtime.json')),{code:'ENOENT'},'application runtime identity must not enter the shared SDK');
 const bundled=await build({stdin:{contents:"export {sanitizeDecorationHtml} from '@qicore/application-sdk/browser/decoration-rich-text.mjs'",resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',globalName:'sdk',target:'es2022',logLevel:'silent'});
 const browser={URL};runInNewContext(bundled.outputFiles[0].text,browser);
 const media='/decoration-media/00000000-0000-0000-0000-000000000001';
 const html=browser.sdk.sanitizeDecorationHtml('<p>正文</p><script>alert(1)</script><img src="'+media+'" onerror="alert(1)"><img src="https://foreign.test/a.png"><a href="javascript:alert(1)">链接</a>');
 assert.match(html,/<p>正文<\/p>/);assert.ok(html.includes(media));
 assert.doesNotMatch(html,/script|onerror|foreign\.test|javascript:/);
 // Compile only the installed SDK; its documented rendering runtimes remain external.
 const compiler=createRequire(new URL('../../../apps/admin/package.json',import.meta.url))('vue/compiler-sfc');
 const clientFiles=(await readdir(join(installed,'dist/client'),{recursive:true})).filter(file=>/\.(?:ts|vue)$/.test(file));
 for(const platform of ['h5','mp-weixin'])await build({entryPoints:clientFiles.map(file=>join(installed,'dist/client',file)),outdir:join(root,'bundle'),bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',external:['vue','@dcloudio/uni-app','mp-html/*'],define:{'import.meta.env.UNI_PLATFORM':JSON.stringify(platform),'import.meta.env.DEV':'false',__QICORE_APPLICATION_KEY__:'"independent-app"'},logLevel:'silent',plugins:[{name:'vue-client',setup(plugin){plugin.onLoad({filter:/\.vue$/},async({path})=>{
  const source=(await readFile(path,'utf8')).replace(/(?:<!--|\/\/|\/\*)\s*#if(n?)def (H5|MP-WEIXIN)(?:\s*(?:-->|\*\/))?\r?\n([\s\S]*?)(?:<!--|\/\/|\/\*)\s*#endif(?:\s*(?:-->|\*\/))?/g,(_all,negated,target,body)=>((target==='H5'?platform==='h5':platform==='mp-weixin')!==!!negated)?body:'');
  assert.doesNotMatch(source,/#ifn?def/,path+' ('+platform+'): new platform directives require an explicit compile fixture');
  const {descriptor,errors}=compiler.parse(source,{filename:path});assert.deepEqual(errors,[]);
  return{contents:descriptor.script||descriptor.scriptSetup?compiler.compileScript(descriptor,{id:path,inlineTemplate:true}).content:'export default {}',loader:'ts',resolveDir:dirname(path)};
 })}}]});
});
