import {mkdir,mkdtemp,cp,writeFile,rm,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=dirname(fileURLToPath(import.meta.url)),repo=resolve(root,'../..'),require=createRequire(import.meta.url);
const output=resolve(process.env.QICORE_FRAMEWORK_CLIENT_DIR||join(root,'dist/h5'));
if(output!==join(root,'dist/h5')&&!output.startsWith(join(repo,'.local')+sep+'qa-console-'))throw Error('FRAMEWORK_CLIENT_OUTPUT_INVALID');
const sdk=join(repo,'packages/application-sdk/dist/client');await mkdir(join(root,'.local'),{recursive:true});
const input=await mkdtemp(join(root,'.local/framework-client-'));
try{
 await cp(sdk,input,{recursive:true});await cp(join(root,'src'),input,{recursive:true});
 const pages=JSON.parse(await readFile(join(root,'src/pages.json'),'utf8'));
 const child=spawnSync(process.execPath,[require.resolve('@dcloudio/vite-plugin-uni/bin/uni.js'),'build','-p','h5'],{cwd:root,env:{...process.env,NODE_ENV:'production',UNI_INPUT_DIR:input,UNI_OUTPUT_DIR:output},stdio:'inherit',windowsHide:true});
 if(child.status!==0)throw Error('FRAMEWORK_CLIENT_BUILD_FAILED');
 const {h5PagePath}=await import('../../packages/application-sdk/dist/browser/h5-routes.mjs');
 await writeFile(join(output,'h5-routes.json'),JSON.stringify(Object.fromEntries(pages.pages.map(page=>[h5PagePath('/'+page.path),page.style.navigationBarTitleText]))));
}finally{if(!resolve(input).startsWith(join(root,'.local')+sep+'framework-client-'))throw Error('CLIENT_SOURCE_CLEANUP_INVALID');await rm(input,{recursive:true,force:true,maxRetries:5,retryDelay:200})}
