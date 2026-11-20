import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as renderContext from '../app/utils/console-render-context.ts';

test('shared application page paths dispatch only through the authenticated tenant binding',async()=>{
 const source=await readFile(new URL('../server/middleware/00-native-applications.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const apps=['alpha-app','beta-app'].map(key=>({key,web:{admin:{routes:[{path:'/admin/orders'},{path:'/admin/workbench'}]}}})),rendered=[];
 let path='/admin/orders',installed=[apps[0]];
 let selected='a',session={id:'account',role:'tenant',tenantId:'a',tenantIds:['a']},revoked=false,ambiguous=false,renderFailure=false,systemOnly=false,mismatchedReceipt=false;
 const exports={},sourceRequire=createRequire(new URL('../server/middleware/00-native-applications.ts',import.meta.url));
 new Function('require','exports','defineEventHandler','getRequestURL','getRequestHeader','getCookie','useRuntimeConfig','$fetch','createError','sendRedirect','setHeader',code)(
  name=>name.includes('console-render-context')?renderContext:!name.includes('native-applications')?sourceRequire(name):({installedWebApplications:async()=>installed,applicationRenderer:async app=>request=>{assert.equal(request[renderContext.consoleRenderContext].applicationKey,app.applicationKey==='*'?'system':app.applicationKey||app.key);assert.equal(request[renderContext.consoleRenderContext].session,session);if(renderFailure)throw Error('renderer failed');rendered.push(app.key)}}),exports,fn=>fn,
  ()=>new URL('https://example.test'+path),()=>'',()=>JSON.stringify({accountId:'account',tenantId:selected}),()=>({apiInternalBase:'http://host/api/v1'}),
  async(url,options)=>{if(url.endsWith('/auth/me'))return{data:session};if(systemOnly)return{data:{applications:[],tenant:{id:options.query.tenantId,enabled:true,expiresAt:null,consoleRoutes:revoked?[]:[{path:'/admin/system-tools',pluginKey:'global-tools',applicationKey:'system'}]}}};const key=options.query.tenantId==='a'?'alpha-app':'beta-app';return{data:{tenant:{id:mismatchedReceipt?'other':options.query.tenantId,enabled:true,expiresAt:null},applications:(ambiguous?apps:[{key}]).map(app=>({key:app.key,state:revoked?'expired':'available',consoleRoutes:[{path:'/admin/orders'},{path:'/admin/workbench'},...app.key==='alpha-app'?[{path:'/admin/export',pluginKey:'export-plugin'}]:[]]}))}}},
  value=>Object.assign(Error(value.statusMessage||'request rejected'),value),(_event,path)=>({redirect:path}),()=>{});
 const event={method:'GET',get path(){return path},node:{req:{},res:{}}};
 await exports.default(event);
 selected='b';await exports.default(event);assert.deepEqual(rendered,['alpha-app','alpha-app'],'client selection cannot redirect this enterprise session');
 installed=[apps[1]];session={...session,tenantId:'b',tenantIds:['b']};await exports.default(event);assert.equal(rendered.at(-1),'beta-app','another verified installation resolves its own binding');
 installed=[apps[0]];session={...session,tenantId:'a',tenantIds:['a']};mismatchedReceipt=true;await assert.rejects(exports.default(event),e=>e.statusCode===403);mismatchedReceipt=false;
 assert.equal(event.node.req[renderContext.consoleRenderContext],undefined,'request handoff is removed after rendering');
 renderFailure=true;await assert.rejects(exports.default(event),/renderer failed/);assert.equal(event.node.req[renderContext.consoleRenderContext],undefined);renderFailure=false;
 revoked=true;await assert.rejects(exports.default(event),error=>error.statusCode===403);revoked=false;
 ambiguous=true;await assert.rejects(exports.default(event),error=>error.statusCode===403);ambiguous=false;
 installed=[...apps];await assert.rejects(exports.default(event),e=>e.statusCode===403,'colliding signed page renderers are rejected');installed=[apps[0]];
 path='/admin/orders?tenantId=other';await assert.rejects(exports.default(event),e=>e.statusCode===403);path='/admin/orders';
 selected='unowned';await exports.default(event);assert.equal(rendered.at(-1),'alpha-app');
 for(const invalid of [{role:'root'}, {delegated:true}, {tenantIds:['a','b']}, {tenantId:'unowned'}, {tenantIds:[]}]){
  const good=session;session={...good,...invalid};await assert.rejects(exports.default(event),e=>e.statusCode===403);session=good;
 }
 await assert.rejects(exports.default({...event,method:'POST'}),error=>error.statusCode===405);
 path='/admin/workbench';await exports.default(event);assert.equal(rendered.at(-1),'alpha-app');
 revoked=true;const count=rendered.length;assert.equal(await exports.default(event),undefined);assert.equal(rendered.length,count,'unavailable application falls back to the host workbench');
 path='/admin/orders';await assert.rejects(exports.default(event),error=>error.statusCode===403);
 revoked=false;selected='a';session={id:'account',role:'tenant',tenantId:'a',tenantIds:['a']};path='/admin/export';
 installed.push({key:'export-plugin',applicationKey:'alpha-app',web:{admin:{routes:[{path}]}}});await exports.default(event);assert.equal(rendered.at(-1),'export-plugin');
 session={...session,tenantId:'b',tenantIds:['b']};await assert.rejects(exports.default(event),error=>error.statusCode===403);
 session={...session,tenantId:'a',tenantIds:['a']};systemOnly=true;path='/admin/system-tools';installed.push({key:'global-tools',applicationKey:'*',web:{admin:{routes:[{path}]}}});await exports.default(event);assert.equal(rendered.at(-1),'global-tools');
 revoked=true;await assert.rejects(exports.default(event),error=>error.statusCode===403);
 path='/tenant/system-tools';await assert.rejects(exports.default(event),e=>e.statusCode===404);
});

test('development SSR inventory rejects changed emitted plugin identity before page dispatch',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-development-web-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const descriptor={format:'qicore-plugin-v1',key:'fixture-plugin',packageKey:'plugin_fixture',version:'1.0.0',name:'Plugin',applicationKey:'*',namespace:'reserved',pendingTasks:[],routes:{admin:[],consumer:[]}};
 const source=await readFile(new URL('../server/utils/native-applications.ts',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const schema=await import('../../api/dist/applications/native-descriptor.js'),development=await import('../../api/src/applications/development-workspace.mjs'),require=createRequire(new URL('../server/utils/native-applications.ts',import.meta.url)),exports={};
 const path=join(root,'plugin');await mkdir(path);
 new Function('require','exports',code)(name=>name.includes('native-descriptor')?schema:name.includes('development-workspace')?{...development,developmentWorkspace:()=>({applications:[{...descriptor,path}]})}:require(name),exports);
 await writeFile(join(path,'application.json'),JSON.stringify({...descriptor,namespace:'otherScope'}));
 await assert.rejects(exports.installedWebApplications(),/DEVELOPMENT_APPLICATION_IDENTITY_CHANGED/);
 await writeFile(join(path,'application.json'),JSON.stringify(descriptor));assert.equal((await exports.installedWebApplications())[0].key,descriptor.key);
});
