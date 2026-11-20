import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,lstat,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createHash,randomUUID,randomBytes} from 'node:crypto';

const originFramework=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
let framework=originFramework;
const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1]};
const source=option('--application')&&resolve(option('--application')),kit=option('--kit')&&resolve(option('--kit')),report=option('--report')&&resolve(option('--report')),port=Number(option('--port')||4300);
if(!source||!kit||!report||!process.env.npm_execpath)throw Error('Use pnpm check:separation --application <existing-source> --kit <sdk-kit> --report <evidence.json> [--port 4300]');
const scratch=await mkdtemp(join(tmpdir(),'qicore-separation-')),app=join(scratch,'independent-photo'),state=join(scratch,'runtime'),logs=join(scratch,'acceptance.log');
let runtime,runtimeExit,complete=false;
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
async function run(file,args,cwd=framework,env=process.env,limit=50000){return new Promise((ok,fail)=>{
 const child=spawn(file,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
 for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{output=(output+bytes).slice(-limit)});
 child.once('error',fail);child.once('exit',async code=>{await writeFile(logs,output,{flag:'a'});code===0?ok(output):fail(Error('Command failed: '+file+' '+args.join(' ')+'\n'+output.slice(-12000)))});
})}
const pnpm=(args,cwd)=>run(process.execPath,[process.env.npm_execpath,...args],cwd);
async function files(root,paths=[]){
 const selected=await lstat(join(root,'.git')).then(()=>true,()=>false)?(await run('git',['ls-files','--cached','--others','--exclude-standard','-z','--',...paths],root,process.env,Infinity)).split('\0').filter(Boolean):
  (await Promise.all(paths.map(async path=>{const info=await lstat(join(root,path)).catch(error=>{if(error.code==='ENOENT')return null;throw error});return !info?[]:info.isDirectory()?snapshotFiles(join(root,path),path+'/'):[path]}))).flat();
 return selected.filter(path=>!path.split('/').some(part=>['node_modules','dist','.nuxt','.output','.local','.qicore-admin','coverage','unpackage'].includes(part)||part.startsWith('.env')||part==='project.private.config.json'));
}
async function snapshotFiles(directory,prefix=''){
 const output=[];for(const entry of await readdir(directory,{withFileTypes:true})){
  if(['node_modules','dist','.nuxt','.output','.local','.qicore-admin','coverage','unpackage'].includes(entry.name)||entry.name.startsWith('.env'))continue;
  const path=prefix+entry.name;if(entry.isDirectory())output.push(...await snapshotFiles(join(directory,entry.name),path+'/'));else if(entry.isFile())output.push(path);else throw Error('Unexpected host source link');
 }return output;
}
async function snapshot(){
 const hash=createHash('sha256');let count=0;
 const selected=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'];for(const path of ['apps','packages','scripts'])selected.push(...await snapshotFiles(join(framework,path),path+'/'));
 for(const file of selected.sort()){
  const info=await lstat(join(framework,file)).catch(error=>{if(error.code==='ENOENT')return null;throw error});if(!info?.isFile())continue;
  hash.update(file+'\0');hash.update(await readFile(join(framework,file)));count++;
 }
 return {files:count,sha256:hash.digest('hex')};
}
async function stop(){
 if(!runtime||runtime.exitCode!==null)return;
 runtime.send('qicore-development-stop');
 let timer;try{await Promise.race([runtimeExit,new Promise((_ok,fail)=>{timer=setTimeout(()=>fail(Error('Acceptance runtime did not drain; preserve '+scratch)),90000)})])}finally{clearTimeout(timer)}
}
try{
 // A disposable official source snapshot isolates acceptance from concurrent
 // workspace edits. Dependencies and generated outputs are created afresh.
 const hostFiles=await files(originFramework,['apps','packages','scripts','patches','config/license-product.json','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.gitignore']);
 framework=join(scratch,'official-host');await mkdir(framework);
 for(const path of hostFiles){const info=await lstat(join(originFramework,path)).catch(error=>{if(error.code==='ENOENT')return null;throw error});if(!info)continue;assert.ok(info.isFile());await mkdir(dirname(join(framework,path)),{recursive:true});await copyFile(join(originFramework,path),join(framework,path))}
 console.log('Preparing an unmodified official-host snapshot with fresh dependencies.');
 await pnpm(['install','--frozen-lockfile','--offline'],framework);
 await run(process.execPath,[process.env.npm_execpath,'--filter','@qicore/api','db:generate'],framework,{...process.env,DATABASE_URL:'mysql://unused:unused@127.0.0.1/qicore_build_only'});
 await pnpm(['--filter','@qicore/api','build'],framework);
 const before=await snapshot();await mkdir(app);
 const selected=await files(source,['apps','scripts','config','patches','application.json','web.json','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.gitignore']);
 for(const path of selected){
  const target=resolve(app,path);assert.ok(!isAbsolute(relative(app,target))&&!relative(app,target).startsWith('..'));
  const info=await lstat(join(source,path)).catch(error=>{if(error.code==='ENOENT')return null;throw error});if(!info)continue;assert.ok(info.isFile(),'Source links are not accepted: '+path);
  await mkdir(dirname(target),{recursive:true});await copyFile(join(source,path),target);
 }
 const sourceHash=createHash('sha256');let copied=0;
 for(const path of [...selected].sort()){const file=join(app,path);if(!await lstat(file).catch(()=>null))continue;sourceHash.update(path+'\0');sourceHash.update(await readFile(file));copied++}
 const applicationSource={files:copied,sha256:sourceHash.digest('hex')};
 const {installSdk}=await import(pathToFileURL(join(kit,'install.mjs')));await installSdk(kit,app);
 console.log('Installing the existing photo application in an independent temporary directory.');
 await pnpm(['install','--frozen-lockfile','--offline'],app);
 const require=createRequire(join(app,'package.json')),sdk=require.resolve('@qicore/application-sdk/package.json');
 assert.ok(!resolve(sdk).startsWith(framework),'SDK must resolve from its archive, not framework sources');
 const sdkVersion=JSON.parse(await readFile(sdk,'utf8')).version;
 await pnpm(['typecheck'],app);
 const unit=await run(process.execPath,['scripts/test-application-unit.mjs'],app,{...process.env,QICORE_TEST_ROOT:framework});
 assert.ok(!unit.includes('fail 1'),'Application unit tests must pass');
 const clientTests=await pnpm(['--filter','@zjz/miniapp','test'],app);
 const tests=Object.fromEntries(['pass','fail','skipped'].map(key=>[key,[...(''+unit+'\n'+clientTests).matchAll(new RegExp('^(?:#|ℹ) '+key+' (\\d+)$','gm'))].reduce((sum,match)=>sum+Number(match[1]),0)]));
 console.log('Building the actual photo API, six admin pages, H5 and mini-program template.');
 const built=await run(process.execPath,['scripts/build-photo-application.mjs',join(scratch,'photo-package')],app);
 assert.ok(built.includes('"models":12'));
 const plugin=join(scratch,'extension');await mkdir(plugin);
 const template=dirname(require.resolve('@qicore/application-sdk/templates/plugin-package/entry.mjs'));
 const descriptor={...JSON.parse(await readFile(join(template,'application.json'),'utf8')),key:'development-extension',packageKey:'plugin_development_extension',name:'独立扩展验证',applicationKey:'id-photo',namespace:'developmentExtension'};
 await writeFile(join(plugin,'application.json'),JSON.stringify(descriptor));await copyFile(join(template,'entry.mjs'),join(plugin,'entry.mjs'));
 await writeFile(join(plugin,'package.json'),JSON.stringify({name:'independent-extension-check',version:'1.0.0',type:'module',qicore:{development:{entry:'development.mjs',serverWatch:['entry.mjs','application.json']}}}));
 await writeFile(join(plugin,'development.mjs'),"import {mkdir,copyFile} from 'node:fs/promises';import {join} from 'node:path';await mkdir(process.env.QICORE_DEV_APP_OUTPUT,{recursive:true});for(const name of ['application.json','entry.mjs'])await copyFile(name,join(process.env.QICORE_DEV_APP_OUTPUT,name));");
 const {developmentCommand}=await import(pathToFileURL(require.resolve('@qicore/application-sdk/development')));
 const command=await developmentCommand(['dev','--host',framework,'--plugin',plugin,'--state',state,'--port',String(port)],{cwd:app});
 runtime=spawn(command.file,command.args,{cwd:app,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 runtimeExit=new Promise((ok,fail)=>{runtime.once('error',fail);runtime.once('exit',code=>code===0?ok():fail(Error('Acceptance runtime exited '+code)))});runtimeExit.catch(()=>{});
 for(const stream of [runtime.stdout,runtime.stderr])stream.on('data',bytes=>{void writeFile(logs,bytes,{flag:'a'})});
 console.log('Starting the selected official host with installed SDKs and the photo extension.');
 let ready=false;for(let i=0;i<1200;i++){if(runtime.exitCode!==null)throw Error('Runtime startup failed; inspect '+logs);try{const run=JSON.parse(await readFile(join(state,'run.json'),'utf8'));if(!run.stopped){ready=true;break}}catch{}await wait(250)}assert.ok(ready,'Runtime must start within five minutes');
 const origin='http://127.0.0.1:'+port;
 async function api(path,body,session,portal='admin'){
  const response=await fetch(origin+'/api/v1'+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json','x-console-portal':portal,...session?{cookie:session.cookie,'x-csrf-token':session.csrfToken}:{}},...body?{body:JSON.stringify(body)}:{}}),value=await response.json();
  if(!response.ok)throw Error(path+' '+response.status+' '+JSON.stringify(value.error));
  return {...value.data,cookie:response.headers.getSetCookie().find(value=>value.startsWith('qicore_'+portal+'_session='))?.split(';')[0]||session?.cookie};
 }
 const credentials=JSON.parse(await readFile(join(state,'admin/admin-bootstrap.json'),'utf8')),platform=await api('/admin/auth/login',{...credentials,portal:'admin'});
 const password=randomBytes(24).toString('hex'),tenant=await api('/admin/tenants',{requestId:randomUUID(),name:'独立应用验证',applicationKey:'id-photo',administrator:{username:'independent-photo-admin',nickname:'验证管理员',password}},platform);
 const session=await api('/admin/auth/login',{username:'independent-photo-admin',password,portal:'tenant'},null,'tenant');
 const status=await api('/admin/tenants/'+tenant.id+'/apps/id-photo/plugins/development-extension/status',null,session,'tenant');assert.equal(status.applicationKey,'id-photo');assert.equal(status.ready,true);
 const updates=await api('/admin/updates',null,platform);assert.ok(updates.applications.installed.some(item=>item.componentType==='plugin'&&item.key==='development-extension'));
 const entry=await api('/admin/tenant-entry?tenantId='+tenant.id,null,session,'tenant');assert.deepEqual(entry.applications.map(item=>item.key),['id-photo'],'Plugin must not become a tenant application slot');
 const {chromium}=createRequire(join(framework,'package.json'))('playwright'),browser=await chromium.launch({headless:true,...process.platform==='win32'?{channel:'msedge'}:{}});
 const titles=[],browserEvidence=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'qicore_tenant_session',value:session.cookie.split('=').slice(1).join('='),url:origin}]);
  const page=await context.newPage();await page.goto(origin+'/admin/templates');await page.waitForLoadState('networkidle');assert.match(await page.title(),/^证件照模板 · /);titles.push(await page.title());
  const direct=await fetch(origin+'/admin/templates',{headers:{cookie:session.cookie}});assert.match(await direct.text(),/<title>证件照模板 · /);
  await page.reload();await page.waitForLoadState('networkidle');assert.equal(await page.title(),titles[0]);
  await mkdir(dirname(report),{recursive:true});const templateNavigation=report.replace(/\.json$/,'')+'-templates-navigation.png';await page.screenshot({path:templateNavigation});browserEvidence.push(templateNavigation);
  // Sidebar implementations can retain hidden navigation copies. Exercise the accessible link, and require the active group to remain visible after refresh.
  await page.getByRole('link',{name:'证件照模板',exact:true}).waitFor({state:'visible'});
  const production=page.getByRole('link',{name:'制作配置',exact:true});assert.equal(await production.getAttribute('href'),'/admin/production');await production.click();await page.waitForURL('**/admin/production');await page.getByRole('heading',{name:'制作配置',exact:true}).waitFor();await page.waitForFunction(()=>document.title==='制作配置 · QiCore');titles.push(await page.title());
  const productionNavigation=report.replace(/\.json$/,'')+'-production-navigation.png';await page.screenshot({path:productionNavigation});browserEvidence.push(productionNavigation);
  const productionHtml=await(await fetch(origin+'/admin/production',{headers:{cookie:session.cookie}})).text();assert.match(productionHtml,/<title>制作配置 · QiCore<\/title>/);
  await page.goto(origin+'/h5/'+tenant.id+'/');await page.waitForLoadState('networkidle');assert.ok((await page.locator('body').innerText()).length>0);titles.push(await page.title());
 }finally{await browser.close()}
 await stop();runtime=undefined;
 const after=await snapshot();assert.deepEqual(after,before,'Application development must leave host sources unchanged');
 await mkdir(dirname(report),{recursive:true});await writeFile(report,JSON.stringify({format:'qicore-application-separation-check-v1',checkedAt:new Date().toISOString(),platform:process.platform,node:process.version,application:'id-photo',applicationSource,sdkVersion,tests,sdkKit:JSON.parse(await readFile(join(kit,'sdk-kit.json'),'utf8')),frameworkSource:before,frameworkSourceUnchanged:true,checks:['fresh offline dependency installation','typecheck','existing application unit and client tests','real API/admin/H5/mini-program build','independent official-host development','plugin API and tenant slot isolation','SSR direct entry, refresh, accessible sidebar and navigation'],titles,browserEvidence},null,2)+'\n');
 complete=true;console.log('Independent application and plugin acceptance passed; evidence: '+report);
}finally{
 await stop();
 if(complete){assert.equal(dirname(resolve(scratch)),resolve(tmpdir()));await rm(scratch,{recursive:true,force:true,maxRetries:8,retryDelay:250})}
 else console.error('Acceptance evidence retained for active debugging: '+scratch);
}
