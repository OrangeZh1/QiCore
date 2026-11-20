import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {resumeNativeInstallationHealth} from '../apps/api/dist/lifecycle/native-installation-recovery.js';
import {verifyBootstrapInventory} from './native-start.mjs';

// Operator-only command under the same OS flock as start.mjs. It never accepts database or administrator input.
async function main(){
 const [rootArg,configArg,id,inventoryHash]=process.argv.slice(2);
 if(process.platform!=='linux'||process.env.UPDATER_FLOCK!=='1'||!rootArg||!configArg||!/^[a-f0-9-]{36}$/.test(id||'')||!/^[a-f0-9]{64}$/.test(inventoryHash||''))throw Error('INSTALL_RECOVERY_ARGUMENTS_INVALID');
 const root=resolve(rootArg),configPath=resolve(configArg),raw=readFileSync(join(root,'bootstrap-manifest.json'));
 if(createHash('sha256').update(raw).digest('hex')!==inventoryHash)throw Error('BOOTSTRAP_INVENTORY_CHANGED');
 const expected=await verifyBootstrapInventory(root);
 const engine='node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node';
 if(!expected.has(engine))throw Error('BOOTSTRAP_PRISMA_ENGINE_REQUIRED');
 process.env.PRISMA_QUERY_ENGINE_LIBRARY=join(root,engine);
 const {startController}=await import(pathToFileURL(join(root,'controller.mjs')).href);
 const controller=await startController(configPath,join(root,'ui'));
 try{
  const installer=controller.installation,job=installer.store.read('request.json');
  if(!job||job.id!==id||job.status!=='recovery_required')throw Error('INSTALL_RECOVERY_REQUEST_MISMATCH');
  const result=await resumeNativeInstallationHealth(controller.state,installer.options.client,controller.host,id);
  installer.store.write('request.json',{...job,status:result.status,code:result.code});
  await installer.flush();
  console.log(JSON.stringify({attemptId:result.id,status:result.status,phase:result.phase,code:result.code??null,reportPending:installer.status().reportPending}));
  if(result.status!=='succeeded')process.exitCode=1;
 }finally{await controller.close()}
}
await main().catch(error=>{console.error(error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'INSTALL_RECOVERY_FAILED');process.exitCode=1});
