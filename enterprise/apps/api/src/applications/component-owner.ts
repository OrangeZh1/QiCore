import {readApplicationDescriptor} from './native-descriptor-file.js';
import type {NativeState} from '../lifecycle/native-state.js';
import type {NativeRelease} from '../license/native-updates.js';

// Validate signed package ownership before a plugin can migrate the shared DB.
export function assertComponentOwner(state:NativeState,descriptor:ReturnType<typeof readApplicationDescriptor>,release:Pick<NativeRelease,'manifest'>){
 if(descriptor.format!=='qicore-plugin-v1')return;
 for(const key of state.keys()){
  if(key===descriptor.packageKey)continue;
  const previous=state.component(key).read<{format:string;namespace?:string;applicationKey?:string}>('application.json');
  if(previous?.format==='qicore-plugin-v1'&&previous.namespace===descriptor.namespace&&(previous.applicationKey===descriptor.applicationKey||previous.applicationKey==='*'||descriptor.applicationKey==='*'))throw Error('PLUGIN_NAMESPACE_CONFLICT');
 }
 if(descriptor.applicationKey==='*'){
  if(release.manifest.parentApp!==null||release.manifest.framework?.packageKey!==state.config.frameworkKey)throw Error('PLUGIN_OWNER_MISMATCH');
  return;
 }
 const parent=release.manifest.parentApp,active=parent&&state.active(parent);
 if(!parent||!active||!release.manifest.dependencies.some(item=>item.packageKey===parent))throw Error('PLUGIN_OWNER_MISMATCH');
 const owner=readApplicationDescriptor(state.path(parent,active.current),parent,active.current.version);
 if(owner.format!=='qicore-application-v1'||owner.key!==descriptor.applicationKey)throw Error('PLUGIN_OWNER_MISMATCH');
}
