import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

async function fixture(){
 const source=await readFile(new URL('../app/plugins/console-navigation.client.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const output={},hooks={},events={},target={value:null},route={fullPath:'/admin/workbench'},router={currentRoute:{value:null},afterEach:fn=>hooks.after=fn,onError:fn=>hooks.error=fn};
 const nuxt={isHydrating:false,hook:(name,fn)=>hooks[name]=fn};
 new Function('exports','defineNuxtPlugin','useRouter','useRoute','useConsoleNavigation','window','nextTick',code)(output,fn=>fn,()=>router,()=>route,()=>({target}),{addEventListener:(name,fn)=>events[name]=fn},()=>Promise.resolve());
 const components=new Map(),to=path=>{const pathname=path.split('?')[0];if(!components.has(pathname))components.set(pathname,{});return{path:pathname,fullPath:path,meta:{},matched:[{components:{default:components.get(pathname)}}]}};
 const {provide}=output.default(nuxt);
 return{...provide,target,route,router,hooks,events,nuxt,to};
}

test('navigation keeps feedback after Suspense resolves until the matching page enters',async()=>{
 const c=await fixture(),from=c.to('/admin/workbench'),next=c.to('/admin/users');
 c.beginConsoleNavigation(next,from);assert.equal(c.target.value.path,'/admin/users');
 c.hooks['page:finish']();assert.ok(c.target.value,'old page completion cannot clear pending navigation');
 c.router.currentRoute.value=next;c.route.fullPath=next.fullPath;c.hooks['page:finish']({type:next.matched[0].components.default});assert.ok(c.target.value,'resolved data is not yet the visible page during out-in');
 await next.meta.pageTransition.onBeforeEnter({isConnected:false});assert.ok(c.target.value,'cached activation in a detached container is not visible');
 await next.meta.pageTransition.onBeforeEnter({isConnected:true});assert.equal(c.target.value,null);
 c.beginConsoleNavigation(c.to('/admin/users?page=2'),next);assert.equal(c.target.value,null,'query controls keep their own loading state');
 c.nuxt.isHydrating=true;c.beginConsoleNavigation(next,from);assert.equal(c.target.value,null,'SSR remains unchanged');
});

test('late failures do not cancel a newer navigation, while cancellation and real failures recover',async()=>{
 const c=await fixture(),from=c.to('/admin/workbench'),first=c.to('/admin/users'),second=c.to('/admin/member-levels');
 c.beginConsoleNavigation(first,from);c.beginConsoleNavigation(second,from);
 c.router.currentRoute.value=second;c.route.fullPath=second.fullPath;await first.meta.pageTransition.onBeforeEnter({isConnected:true});c.hooks['page:finish']({type:first.matched[0].components.default});assert.equal(c.target.value.path,second.path,'old page completion cannot clear feedback after the global route advances');
 assert.equal(second.meta.pageTransition.mode,'default','an interrupted pending page must not block mounting the replacement');
 c.hooks.after(first,from,{type:8});c.hooks.error(Error('late'),first);assert.equal(c.target.value.path,second.path);
 c.hooks.error(Error('network'),second);assert.ok(c.target.value.error);
 c.beginConsoleNavigation(first,from);assert.equal(c.target.value.error,'');c.hooks.after(first,from,{type:4});assert.equal(c.target.value,null);
});

test('document handoff keeps feedback through router abort and back-forward restoration clears it',async()=>{
 const c=await fixture(),from=c.to('/admin/users'),next=c.to('/admin/workbench');
 c.beginConsoleNavigation(next,from);c.consoleDocumentNavigation();c.hooks.after(next,from,{type:4});assert.equal(c.target.value.document,true);
 c.events.pageshow({persisted:true});assert.equal(c.target.value,null);
 c.beginConsoleNavigation(c.to('/admin/login'),from);assert.equal(c.target.value,null);
 c.beginConsoleNavigation(c.to('/admin/administrators'),from);assert.equal(c.target.value.path,'/admin/administrators','the administrators page belongs to the enterprise shell');
 c.beginConsoleNavigation(c.to('/'),from);assert.equal(c.target.value,null,'leaving the enterprise shell clears pending navigation');
});

test('query changes during a pending page keep ownership until that page resolves',async()=>{
 const c=await fixture(),from=c.to('/admin/users'),first=c.to('/admin/member-levels'),query=c.to('/admin/member-levels?page=2');
 c.beginConsoleNavigation(first,from);c.beginConsoleNavigation(query,first);c.hooks.after(first,from,{type:8});assert.equal(c.target.value.fullPath,query.fullPath);
 c.router.currentRoute.value=query;c.route.fullPath=query.fullPath;await first.meta.pageTransition.onBeforeEnter({isConnected:true});assert.equal(c.target.value,null);
});

test('explicitly disabled transitions finish only for the matching component',async()=>{
 const c=await fixture(),from=c.to('/admin/workbench'),next=c.to('/admin/users');next.meta.pageTransition=false;
 c.beginConsoleNavigation(next,from);c.router.currentRoute.value=next;c.route.fullPath=next.fullPath;
 c.hooks['page:finish']({type:from.matched[0].components.default});assert.ok(c.target.value);
 c.hooks['page:finish']({type:next.matched[0].components.default});assert.equal(c.target.value,null);
});

test('page enter callbacks preserve existing hooks and cannot clear a later return to the same path',async()=>{
 const c=await fixture(),from=c.to('/admin/workbench'),first=c.to('/admin/administrators'),other=c.to('/admin/users'),last=c.to('/admin/administrators'),elements=[];
 first.meta.pageTransition={onBeforeEnter:element=>elements.push(element)};c.beginConsoleNavigation(first,from);c.beginConsoleNavigation(other,first);c.beginConsoleNavigation(last,other);
 const element={isConnected:true};c.router.currentRoute.value=last;c.route.fullPath=last.fullPath;await first.meta.pageTransition.onBeforeEnter(element);assert.ok(c.target.value);assert.deepEqual(elements,[element]);
 await last.meta.pageTransition.onBeforeEnter(element);assert.equal(c.target.value,null);
});
