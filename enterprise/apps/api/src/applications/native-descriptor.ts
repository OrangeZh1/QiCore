import {z} from 'zod';
import {canonicalApplicationPage} from './console-pages.mjs';
import type {NativeArchiveManifest} from '../license/native-release.js';

export const applicationKeySchema=z.string().regex(/^[a-z][a-z0-9-]{1,63}$/).refine(v=>!['tenant','admin','platform','public','system'].includes(v));
const key=z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),sqlIdentifier=z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
export const applicationConsoleRouteSchema=z.object({path:z.string().refine(path=>canonicalApplicationPage(path)!==null,'Invalid or reserved application route'),label:z.string().min(1).max(40),permission:z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/),group:z.enum(['workbench','users','production','transactions','materials','content','decoration','channels','permissions','settings']),icon:z.enum(['i-lucide-layout-dashboard','i-lucide-layout-template','i-lucide-layout-grid','i-lucide-settings','i-lucide-history','i-lucide-images','i-lucide-receipt-text','i-lucide-layers'])}).strict();
export const applicationWebSchema=z.object({
 admin:z.object({entrypoint:z.literal('web/admin/server/index.mjs'),publicDir:z.literal('web/admin/public'),routes:z.array(applicationConsoleRouteSchema).min(1).max(40).refine(routes=>new Set(routes.map(route=>canonicalApplicationPage(route.path))).size===routes.length,'Duplicate application route')}).strict().optional(),
 h5:z.object({directory:z.literal('web/h5')}).strict().optional(),
 miniProgram:z.object({directory:z.literal('web/mini-program'),manifest:z.literal('web/mini-program/mini-program-template.json')}).strict().optional(),
}).strict();
export const applicationDescriptorSchema=z.object({format:z.literal('qicore-application-v1'),key:applicationKeySchema,packageKey:key,version:z.string().regex(/^\d+\.\d+\.\d+$/),name:z.string().min(1).max(100),
 pendingTasks:z.array(z.object({table:sqlIdentifier,statusColumn:sqlIdentifier,pendingStates:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/)).min(1).max(20),applicationKeyColumn:sqlIdentifier.optional(),tenantIdColumn:sqlIdentifier.optional()}).strict()).max(30),web:applicationWebSchema.optional()}).strict();
const pluginRoute=z.object({path:z.string().regex(/^[a-z][a-z0-9-]*(?:\/(?:[a-z][a-z0-9-]*|:[a-z][a-zA-Z0-9]*))*$/),method:z.enum(['GET','POST','PUT','PATCH','DELETE']),permission:z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/)}).strict();
export const pluginDescriptorSchema=applicationDescriptorSchema.extend({format:z.literal('qicore-plugin-v1'),applicationKey:z.union([applicationKeySchema,z.literal('*')]),namespace:z.string().regex(/^[a-z][a-zA-Z0-9]{1,31}$/),routes:z.object({admin:z.array(pluginRoute).max(100),consumer:z.array(pluginRoute.omit({permission:true})).max(100)}).strict(),web:applicationWebSchema.pick({admin:true}).optional()}).strict();
export const componentDescriptorSchema=z.discriminatedUnion('format',[applicationDescriptorSchema,pluginDescriptorSchema]);

// A signed archive can still omit a declared frontend. Check its required entry
// files before maintenance/migration, and reuse the same contract when starting it.
export function assertApplicationReleaseLayout(descriptor:z.infer<typeof componentDescriptorSchema>,manifest:NativeArchiveManifest){
 if(manifest.package_type!==(descriptor.format==='qicore-plugin-v1'?'plugin_update':'app_update')||manifest.package_key!==descriptor.packageKey||manifest.version!==descriptor.version)throw Error('APPLICATION_DESCRIPTOR_MISMATCH');
 const required=['application.json',manifest.entrypoint],web:z.infer<typeof applicationWebSchema>|undefined=descriptor.web;
 if(web?.admin)required.push(web.admin.entrypoint);
 if(web?.h5)required.push(web.h5.directory+'/index.html',web.h5.directory+'/h5-routes.json');
 if(web?.miniProgram)required.push(web.miniProgram.manifest);
 const files=new Set(manifest.files.map(file=>file.path));
 if(required.some(file=>!files.has(file)))throw Error('APPLICATION_LAYOUT_INCOMPLETE');
}
