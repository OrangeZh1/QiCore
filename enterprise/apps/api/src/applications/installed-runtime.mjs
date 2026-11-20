import {bindStandaloneRelease} from './standalone-release-state.mjs';
import {developmentWorkspace} from './development-workspace.mjs';
const development=developmentWorkspace();
async function installed() {
 const env=process.env;
 const root=env.QICORE_STANDALONE_BUNDLE_ROOT,release=env.QICORE_STANDALONE_RELEASE_FILE,product=env.QICORE_STANDALONE_PRODUCT_FILE;
 if(env.QICORE_COMPONENTS)throw Error('STANDALONE_INDEPENDENT_COMPONENT_SLOTS_FORBIDDEN');
 if(development){
   if(root||release||product)throw Error('STANDALONE_DELIVERY_MIXED_WITH_DEVELOPMENT');
   return (await import('./native-catalog.js')).loadDevelopmentApplications(development);
 }
 if(!root&&!release&&!product)return {components:null,applications:[],plugins:[]};
 if(!root||!release||!product)throw Error('STANDALONE_VERIFIED_PRODUCT_BUNDLE_REQUIRED');
 const verified=await (await import('./standalone-bundle.js')).verifiedBundle(root,release,product);
 const catalog=await (await import('./native-catalog.js')).loadBundledApplications(verified.components);
 bindStandaloneRelease(verified.activeRelease);
 return catalog;
}
const native=await installed();
export const nativeComponents=native.components;
export const applicationDefinitions=native.applications.map(app=>app.definition);
setApplicationDefinitions(applicationDefinitions);
export const applicationDatabaseModels=native.applications.flatMap(app=>app.database?[app.database]:[]);
applicationDatabaseModels.push(...(native.plugins||[]).flatMap(app=>app.database?[app.database]:[]));
export const applicationPermissions=applicationDefinitions.flatMap(app=>app.key==='system'?app.pluginPermissions.flatMap(item=>app.permissions.filter(permission=>permission.startsWith(item.prefix)).map(permission=>'tenant:'+permission)):app.permissions.map(permission=>app.key+':'+permission));
export const applicationGrants=[];
export async function createApplicationRuntimes(resources){
 if(!native.applications.length)return [];
 return (await import('./native-catalog.js')).createNativeRuntimes(native.applications,resources);
}
import {setApplicationDefinitions} from './catalog-state.mjs';
