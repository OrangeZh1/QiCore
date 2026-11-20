import {canonicalConsoleRoutes} from './console-pages.mjs';
import {TenantApplications} from './service.mjs';
import {fail} from '../core/errors.mjs';
import {frameworkDefinition} from './framework.mjs';

// Every extension owns a namespace. It may add declared routes and lifecycle
// work, but cannot replace an application's handlers, payment adapter or identity.
export function attachPlugins(applications,plugins){
 if(plugins.some(plugin=>plugin.descriptor.applicationKey==='*'))applications=[...applications,{definition:frameworkDefinition,createRuntime:()=>({key:'system',consumerPaths:[],connect(){},initialize(){},tick(){},admin(){fail('NOT_FOUND','接口不存在',404)},consumer(){fail('NOT_FOUND','接口不存在',404)},health(){return true},close(){}})}];
 const result=applications.map(app=>({...app,definition:{...app.definition,permissions:[...app.definition.permissions],permissionLabels:{...app.definition.permissionLabels},consoleRoutes:canonicalConsoleRoutes(app.definition.consoleRoutes||[]),pendingTasks:[...app.definition.pendingTasks||[]],pluginPermissions:[],plugins:[]},plugins:[]}));
 for(const plugin of plugins){
  const {descriptor}=plugin,owners=result.filter(app=>descriptor.applicationKey==='*'||app.definition.key===descriptor.applicationKey);
  if(!owners.length||descriptor.applicationKey==='*'&&plugin.component?.parentApp||descriptor.applicationKey!=='*'&&plugin.component&&plugin.component.parentApp!==owners[0].definition.licensePackageKey)throw Error('PLUGIN_OWNER_MISMATCH');
  for(const owner of owners){
  if(owner.plugins.some(item=>item.descriptor.namespace===descriptor.namespace))throw Error('PLUGIN_NAMESPACE_CONFLICT');
  const prefix='plugins.'+descriptor.namespace+'.';
  for(const route of descriptor.routes.admin)if(!plugin.definition.permissions.includes(route.permission))throw Error('PLUGIN_PERMISSION_INVALID');
  const routes=canonicalConsoleRoutes(plugin.definition.consoleRoutes||[]).map(route=>({...route,permission:prefix+route.permission,pluginKey:descriptor.key}));
  if(routes.some(route=>owner.definition.consoleRoutes.some(existing=>existing.path===route.path)))throw Error('PLUGIN_ROUTE_CONFLICT');
  for(const list of [descriptor.routes.admin,descriptor.routes.consumer])if(list.some((route,index)=>list.slice(0,index).some(item=>{
   const left=item.path.split('/'),right=route.path.split('/');return item.method===route.method&&left.length===right.length&&left.every((part,i)=>part===right[i]||part.startsWith(':')||right[i].startsWith(':'));
  })))throw Error('PLUGIN_ROUTE_CONFLICT');
  if(owner.definition.permissions.some(permission=>permission.startsWith(prefix)))throw Error('PLUGIN_PERMISSION_CONFLICT');
  owner.definition.permissions.push(...plugin.definition.permissions.map(permission=>prefix+permission));
  for(const permission of plugin.definition.permissions)owner.definition.permissionLabels[prefix+permission]=plugin.definition.permissionLabels?.[permission]||descriptor.name+'：'+permission;
  owner.definition.consoleRoutes.push(...routes);owner.definition.pendingTasks.push(...descriptor.pendingTasks);
  owner.definition.pluginPermissions.push({prefix,packageKey:plugin.definition.licensePackageKey,name:descriptor.name});
  owner.definition.plugins.push({key:descriptor.key,name:descriptor.name,packageKey:descriptor.packageKey,version:descriptor.version,source:plugin.definition.source,componentType:'plugin'});
  owner.plugins.push(plugin);
  }
 }
 return result;
}

function match(routes,path,method){
 const parts=path.split('/');
 for(const route of routes){
  const pattern=route.path.split('/');if(route.method!==method||pattern.length!==parts.length)continue;
  const params={};if(pattern.every((part,index)=>part.startsWith(':')?(params[part.slice(1)]=parts[index],!!parts[index]):part===parts[index]))return{route,params};
 }
 fail('NOT_FOUND','插件接口不存在',404);
}

export function composePluginRuntime(base,plugins,resources){
 if(!plugins.length)return base;
 if(base.consumerPaths.includes('plugins'))throw Error('PLUGIN_ROUTE_CONFLICT');
 const services=new TenantApplications(resources.db);
 const runtimes=plugins.map(plugin=>({...plugin,runtime:plugin.createRuntime({...resources,applicationKey:base.key,pluginKey:plugin.descriptor.key})}));
 for(const {runtime,descriptor} of runtimes)if(!runtime||runtime.key!==descriptor.key||['connect','initialize','tick','admin','consumer','health','close'].some(method=>typeof runtime[method]!=='function'))throw Error('PLUGIN_RUNTIME_INVALID');
 const allowed=plugin=>resources.pluginAllowed?.(plugin.definition.licensePackageKey)===true;
 async function dispatch(kind,session,path,method,req){
  const key=path[0],plugin=runtimes.find(item=>item.descriptor.key===key);if(!plugin)fail('NOT_FOUND','插件未加载',404);
  if(kind==='consumer'&&session.applicationKey!==base.key)fail('FORBIDDEN','消费者应用范围不匹配',403);
  if(!allowed(plugin))fail('PLUGIN_UNAVAILABLE','插件授权不可用',403);
  const {route,params}=match(plugin.descriptor.routes[kind],path.slice(1).join('/'),method),tenantId=kind==='admin'?req.tenantId:session.tenantId;
  const authorize=()=>kind==='admin'?services.admin(session,tenantId,base.key,'plugins.'+plugin.descriptor.namespace+'.'+route.permission):services.available(tenantId,base.key);
  await authorize();
  const value=await plugin.runtime[kind]({session,tenantId,applicationKey:base.key,pluginKey:key,params},req.request??req);
  await authorize();
  if(!allowed(plugin))fail('PLUGIN_UNAVAILABLE','插件授权已变更',403);
  return value;
 }
 return {...base,consumerPaths:[...base.consumerPaths,'plugins'],
  async admin(session,path,method,req){return path[5]==='plugins'?dispatch('admin',session,path.slice(6),method,{tenantId:path[2],request:req}):base.admin(session,path,method,req)},
  async consumer(session,path,method,req,res){return path[0]==='plugins'?dispatch('consumer',session,path.slice(1),method,req):base.consumer(session,path,method,req,res)},
  async connect(value){await base.connect(value);for(const {runtime} of runtimes)await runtime.connect(value)},
  async initialize(){await base.initialize();for(const {runtime} of runtimes)await runtime.initialize()},
  async tick(enabled){await base.tick(enabled);for(const plugin of runtimes)await plugin.runtime.tick(enabled&&allowed(plugin))},
  async health(){return await base.health()===true&&(await Promise.all(runtimes.map(item=>item.runtime.health()))).every(value=>value===true)},
  async close(){for(const {runtime} of [...runtimes].reverse())await runtime.close();await base.close()}
 };
}
