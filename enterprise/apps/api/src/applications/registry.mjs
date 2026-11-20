import {applications,frameworkApplication} from './catalog-state.mjs';
import {Fault} from '../core/errors.mjs';
import {frameworkKey,frameworkDefinition,frameworkGrant} from './framework.mjs';
import {pluginAllowed} from './plugin-access.mjs';

export function application(key){const app=key===frameworkKey?(frameworkApplication||frameworkDefinition):applications.get(key);if(!app)throw new Fault('APPLICATION_UNKNOWN','应用未注册',404);return app}
export function applicationCatalog(){return [...applications.values()].map(app=>({key:app.key,name:app.name,permissions:app.permissions.map(p=>app.key+':'+p)}))}
// Loaded code inventory, not independent installation receipts or License purchase evidence.
export function loadedApplications(){return [...applications.values()].map(app=>({key:app.key,name:app.name,packageKey:app.licensePackageKey,version:app.version??null,source:app.source??'bundled'}))}
export function loadedComponents(){return [...new Map([...loadedApplications(),...[...applications.values(),frameworkApplication].flatMap(app=>app?.plugins||[])].map(item=>[item.packageKey,item])).values()]}
export function hasApplicationPermission(grants,key,permission){
 const app=application(key);
 const extension=app.pluginPermissions?.find(item=>permission.startsWith(item.prefix));
 if(extension&&!pluginAllowed(extension.packageKey))return false;
 return app.permissions.includes(permission)&&(grants.includes(key===frameworkKey?frameworkGrant(permission):key+':'+permission)||app.legacyGrants===true&&grants.includes(permission));
}
