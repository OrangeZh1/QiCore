import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {developmentDatabase} from './development/database.mjs';
import {command} from './development/processes.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),api=join(root,'apps/api'),admin=join(root,'apps/admin');
const flags=new Set(),argumentsList=[];
for(const arg of process.argv.slice(2)){
 if(arg.startsWith('--')){if(!['--reuse-build','--all-api-tests'].includes(arg)||flags.has(arg))throw Error('Unknown or repeated option: '+arg);flags.add(arg)}
 else argumentsList.push(arg)
}
if(argumentsList.length>1)throw Error('Usage: node scripts/check-database.mjs [report.json] [--reuse-build] [--all-api-tests]');
const reuse=flags.has('--reuse-build'),allApi=flags.has('--all-api-tests');
const state=await mkdtemp(join(tmpdir(),'qicore-database-check-')),reportPath=argumentsList[0]?resolve(argumentsList[0]):null;
await mkdir(join(root,'.local'),{recursive:true});
// Nuxt's Windows component scanner requires build output and dependencies on the same drive.
const buildState=reuse?null:await mkdtemp(join(root,'.local/qa-console-'));
const apiRequire=createRequire(join(api,'package.json')),adminRequire=createRequire(join(admin,'package.json'));
const env={...process.env,NODE_ENV:'production',NUXT_TELEMETRY_DISABLED:'1',PAYMENT_EXECUTION_ENABLED:'false',QICORE_FRAMEWORK_CLIENT_DIR:buildState?join(buildState,'framework-h5'):join(root,'apps/client/dist/h5')};
for(const key of ['QICORE_DEV_WORKSPACE','QICORE_PRODUCT','QICORE_COMPONENTS','UPDATER_SOCKET','NATIVE_STATE_PATH','NODE_OPTIONS','QICORE_STANDALONE_PRODUCT_FILE','QICORE_STANDALONE_BUNDLE_ROOT','QICORE_STANDALONE_RELEASE_FILE','QICORE_STANDALONE_UPDATER_SOCKET','QICORE_STANDALONE_BOOTSTRAP','STANDALONE_ADMIN_PASSWORD_FILE','STANDALONE_STATE_ROOT'])delete env[key];
if(process.env.QICORE_QA_HEAP_MIB){
 const heap=Number(process.env.QICORE_QA_HEAP_MIB);if(!Number.isInteger(heap)||heap<256||heap>4096)throw Error('QICORE_QA_HEAP_MIB must be an integer between 256 and 4096');
 env.NODE_OPTIONS='--max-old-space-size='+heap;
}
const files=['backup-compatibility.test.mjs','framework-runtime.test.mjs','mini-ads-migration.test.mjs','mini-ads.test.mjs','storage-lifecycle.test.mjs','site-storage.test.mjs','native-application-impact.test.mjs','tenant-creation.test.mjs','tenant-application-selection.test.mjs','framework-site.test.mjs','platform-overview.test.mjs','query-performance.test.mjs','database-reliability.test.mjs','financial-reliability.test.mjs','database-upgrade.test.mjs'];
let database,passed=false;
console.log('Isolated database acceptance: '+state);
try{
 const output=reuse?resolve(process.env.TEST_ADMIN_OUTPUT_DIR||join(admin,'.output')):join(buildState,'console');
 if(reuse){
   for(const file of [join(api,'dist/main.js'),join(api,'dist/package.json'),join(output,'server/index.mjs')])await access(file);
   if(typeof apiRequire('@prisma/client').PrismaClient!=='function')throw Error('A generated enterprise Prisma Client is required');
   console.log('Reusing the supplied enterprise API and production SSR build:',output)
 }else{
 await command(process.execPath,[apiRequire.resolve('typescript/bin/tsc'),'--noEmitOnError'],{cwd:api,env});
 await writeFile(join(api,'dist/package.json'),await readFile(join(api,'src/package.json')));
 await command(process.execPath,[join(root,'packages/application-sdk/build.mjs'),'--incremental'],{cwd:root,env});
 await command(process.execPath,[join(root,'apps/client/build.mjs')],{cwd:root,env});
 // Build SSR in a task-owned directory so a running development console keeps its own Nuxt output.
 const nuxt=pathToFileURL(join(dirname(adminRequire.resolve('nuxt/package.json')),'dist/index.mjs')).href;
 const buildScript=join(state,'build-console.mjs');
 const posix=value=>value.replaceAll('\\','/');
 await writeFile(buildScript,`import {loadNuxt,build} from ${JSON.stringify(nuxt)};
const nuxt=await loadNuxt({cwd:${JSON.stringify(posix(admin))},dev:false,overrides:{buildDir:${JSON.stringify(posix(join(buildState,'nuxt')))},nitro:{output:{dir:${JSON.stringify(posix(output))}}}}});
try{await build(nuxt)}finally{await nuxt.close()}`);
 console.log('Building isolated production console...');
 const buildLog=await command(process.execPath,[buildScript],{cwd:admin,env});await writeFile(join(state,'build.log'),buildLog);
 }
 database=await developmentDatabase({root,state,mysqlPort:33820,redisPort:33821,log:()=>{}});
 const url=new URL(database.databaseUrl);url.pathname='/qicore_test';
 const mysql=(await command(process.platform==='win32'?'where.exe':'which',['mysql'])).trim().split(/\r?\n/)[0];
 Object.assign(env,{TEST_DATABASE_URL:url.href,TEST_RESTORE_ROOT_CONFIG:join(state,'mysql/client.ini'),BACKUP_MYSQL_PATH:mysql,TEST_DATABASE_ACCOUNT_HOST:'localhost',REDIS_URL:database.redisUrl,TEST_ADMIN_OUTPUT_DIR:output});
 console.log('Running migration, backup, empty-host API/SSR and scoped advertising checks...');
 async function runTests(batch,name,minimum){
  let tap='',stderr='',invocationFailed=false;
  try { tap=await command(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...batch.map(file=>'test/'+file)],{cwd:api,env}) }
  catch(error){invocationFailed=true;tap=error.stdout||'';stderr=error.stderr||error.message}
  await writeFile(join(state,name+'.tap'),tap);
  if(stderr)await writeFile(join(state,name+'.stderr'),stderr);
  const count=key=>Number(tap.match(new RegExp('^# '+key+' (\\d+)$','m'))?.[1]??NaN);
  const totals={tests:count('tests'),passed:count('pass'),failed:count('fail'),skipped:count('skipped'),cancelled:count('cancelled'),todo:count('todo')};
  const ok=!invocationFailed&&totals.failed===0&&totals.skipped===0&&totals.cancelled===0&&totals.todo===0&&totals.passed===totals.tests&&totals.passed>=minimum;
  console.log(name+': '+JSON.stringify(totals));
  if(!ok)console.error(tap.split('\n').filter(line=>line.startsWith('not ok ')).join('\n')+'\n'+join(state,name+'.tap'));
  return {...totals,ok,files:batch};
 }
 const integrations=await runTests(files,'database',32);
 const rest=allApi?(await readdir(join(api,'test'))).filter(name=>name.endsWith('.test.mjs')&&!files.includes(name)).sort():[];
 const groups=[integrations];
 if(rest.length)groups.push(await runTests(rest,'remaining-api',rest.length));
 const total=key=>groups.reduce((sum,group)=>sum+group[key],0);
 const ok=groups.every(group=>group.ok);
 const report={date:new Date().toISOString(),ok,scope:'Single-enterprise MySQL and Redis acceptance',files:[...files,...rest],tests:total('tests'),passed:total('passed'),failed:total('failed'),skipped:total('skipped'),integrations,additionalApi:groups[1]??null,reusedProductionBuild:reuse,isolatedMySql:true,isolatedRedis:true,isolatedProductionConsole:true,existingDevelopmentServicesUntouched:true};
 if(reportPath){await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')}
 if(!ok)throw Error('Some selected tests failed, were skipped, or produced an incomplete report. Inspect the TAP files in '+state);

 passed=true;
}catch(error){
 await writeFile(join(state,'failure.log'),[error.message,error.stdout,error.stderr].filter(Boolean).join('\n'));
 console.error('Acceptance failed; diagnostics retained at '+join(state,'failure.log'));process.exitCode=1;
}finally{
 if(database)await database.close();
 if(passed){
  if(!resolve(state).startsWith(resolve(tmpdir())+sep+'qicore-database-check-'))throw Error('Invalid acceptance cleanup path');
  if(buildState){
    if(!resolve(buildState).startsWith(join(root,'.local')+sep+'qa-console-'))throw Error('Invalid build cleanup path');
    await rm(buildState,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
  await rm(state,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  console.log('Acceptance services and temporary state removed.');
 }
}
