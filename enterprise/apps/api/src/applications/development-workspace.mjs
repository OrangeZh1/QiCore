import {assertStandaloneComposition} from './standalone-composition.mjs';
import {readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve,dirname,join} from 'node:path';

function identity(app){
 const format=app.format??'qicore-application-v1',plugin=format==='qicore-plugin-v1';
 if(!/^[a-z][a-z0-9-]{1,63}$/.test(app.key)||!/^(?:app|plugin|plg)_[a-z0-9_]+$/.test(app.packageKey)
  ||!['qicore-application-v1','qicore-plugin-v1'].includes(format)||plugin&&(!/^[a-z][a-zA-Z0-9]{1,31}$/.test(app.namespace)||app.applicationKey!=='*'&&!/^[a-z][a-z0-9-]{1,63}$/.test(app.applicationKey))
  ||!plugin&&(app.namespace!==undefined||app.applicationKey!==undefined))throw Error('DEVELOPMENT_APPLICATION_INVALID');
 return {key:app.key,packageKey:app.packageKey,format,...plugin?{namespace:app.namespace,applicationKey:app.applicationKey}:{}};
}
const sameIdentity=(left,right)=>Object.keys({...left,...right}).every(key=>left[key]===right[key]);
export function assertDevelopmentApplicationIdentity(expected,actual){
 if(!sameIdentity(identity(expected),identity(actual))||expected.version!==actual.version)throw Error('DEVELOPMENT_APPLICATION_IDENTITY_CHANGED');
}
function checkHistory(saved){if(saved&&(saved.format!=='qicore-development-identities-v1'||!Array.isArray(saved.applications)))throw Error('DEVELOPMENT_IDENTITY_HISTORY_INVALID')}

function collectIdentities(applications){
 const identities=[];
 for(const app of applications){
  const declared=identity(app),plugin=declared.format==='qicore-plugin-v1';
  if(identities.some(item=>(item.key===app.key||item.packageKey===app.packageKey)&&(item.key!==app.key||item.packageKey!==app.packageKey)))throw Error('DEVELOPMENT_APPLICATION_IDENTITY_CHANGED');
  const current=identities.find(item=>item.key===app.key);
  if(current&&!sameIdentity(current,declared))throw Error('DEVELOPMENT_APPLICATION_IDENTITY_CHANGED');
  if(plugin&&identities.some(item=>item.key!==app.key&&item.namespace===app.namespace&&(item.applicationKey===app.applicationKey||item.applicationKey==='*'||app.applicationKey==='*')))throw Error('DEVELOPMENT_PLUGIN_NAMESPACE_CONFLICT');
  if(!current)identities.push(declared);
 }
 return identities;
}
// Stopping or omitting an application never releases ownership of retained data.
// Import the last workspace once for development states created before this record.
export function reserveDevelopmentApplications(store,applications){
 const saved=store.read('application-identities.json');checkHistory(saved);
 const previous=saved?.applications??store.read('workspace.json')?.applications??[];
 const identities=collectIdentities([...previous,...applications]);
 store.write('application-identities.json',{format:'qicore-development-identities-v1',applications:identities});
}

// The developer selects this local file at process startup. HTTP requests never
// supply module paths or proxy targets. Production cannot activate this branch.
export function developmentWorkspace(env=process.env){
 const file=env.QICORE_DEV_WORKSPACE;if(!file)return null;
 if(env.NODE_ENV!=='development'||env.QICORE_COMPONENTS||!isAbsolute(file))throw Error('DEVELOPMENT_WORKSPACE_FORBIDDEN');
 const value=JSON.parse(readFileSync(file,'utf8'));
 if(value.format!=='qicore-development-workspace-v1'||!Array.isArray(value.applications)||value.applications.length>20)throw Error('DEVELOPMENT_WORKSPACE_INVALID');
 let history;try{history=JSON.parse(readFileSync(join(dirname(file),'application-identities.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}checkHistory(history);
 const reserved=history?collectIdentities(history.applications):undefined;
 const keys=new Set(),packages=new Set();
 const applications=value.applications.map(app=>{
  if(!/^[a-z][a-z0-9-]{1,63}$/.test(app.key)||!/^(?:app|plugin|plg)_[a-z0-9_]+$/.test(app.packageKey)||!/^\d+\.\d+\.\d+$/.test(app.version)||!isAbsolute(app.path)||keys.has(app.key)||packages.has(app.packageKey))throw Error('DEVELOPMENT_APPLICATION_INVALID');
  const declared=identity(app);if(reserved&&!reserved.some(item=>sameIdentity(item,declared)))throw Error('DEVELOPMENT_APPLICATION_IDENTITY_CHANGED');
  for(const name of ['adminOrigin','h5Origin']){if(app[name]===undefined)continue;const url=new URL(app[name]);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('DEVELOPMENT_ORIGIN_INVALID')}
  keys.add(app.key);packages.add(app.packageKey);return {...app,...declared,path:realpathSync(resolve(app.path))};
 });
 assertStandaloneComposition(applications);
 return {...value,applications};
}

export function developmentLicenseTransport(workspace,product){
 if(!workspace||product.product!=='qicore-local-development')throw Error('DEVELOPMENT_PRODUCT_REQUIRED');
 return async url=>{
  if(String(url)!==product.licenseApi+'license/renew')return Response.json({message:'Development workspace has no release service'},{status:409});
  return Response.json({receipt:JSON.parse(readFileSync(workspace.licenseReceipt,'utf8'))});
 };
}
