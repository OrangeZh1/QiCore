import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {componentDescriptorSchema,assertApplicationReleaseLayout} from './native-descriptor.js';
import type {NativeArchiveManifest} from '../license/native-release.js';
import {noLinks} from '../lifecycle/native-files.js';

// The privileged lifecycle controller reads declarations only. This module must
// never import application factories, SDK services or installed runtime code.
export function readApplicationDescriptor(path:string,packageKey:string,version:string,manifest?:NativeArchiveManifest){
 const file=join(path,'application.json');noLinks(file);const descriptor=componentDescriptorSchema.parse(JSON.parse(readFileSync(file,'utf8')));
 if(descriptor.packageKey!==packageKey||descriptor.version!==version)throw Error('APPLICATION_DESCRIPTOR_MISMATCH');
 if(manifest)assertApplicationReleaseLayout(descriptor,manifest);
 return descriptor;
}
