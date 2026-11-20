import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applicationDescriptorSchema,assertApplicationReleaseLayout} from '../dist/applications/native-descriptor.js';

test('web descriptors reserve host routes and keep server/template files outside public asset roots',()=>{
 const route={path:'/tenant/example',label:'示例',permission:'records.read',group:'production',icon:'i-lucide-layers'};
 const descriptor={format:'qicore-application-v1',key:'example',packageKey:'app_example',version:'1.0.0',name:'Example',pendingTasks:[],web:{admin:{entrypoint:'web/admin/server/index.mjs',publicDir:'web/admin/public',routes:[route]},h5:{directory:'web/h5'},miniProgram:{directory:'web/mini-program',manifest:'web/mini-program/mini-program-template.json'}}};
 assert.equal(applicationDescriptorSchema.parse(descriptor).web.admin.routes[0].path,route.path);
 assert.equal(applicationDescriptorSchema.safeParse({...descriptor,web:{admin:{...descriptor.web.admin,routes:[route,route]}}}).success,false);
 for(const path of ['/admin','/tenant/users','/tenant/login','/tenant/apps','/tenant/../admin','https://example.com/tenant/example'])assert.equal(applicationDescriptorSchema.safeParse({...descriptor,web:{...descriptor.web,admin:{...descriptor.web.admin,routes:[{...route,path}]}}}).success,false,path);
 for(const publicDir of ['web/admin/server','web','../secrets','/etc'])assert.equal(applicationDescriptorSchema.safeParse({...descriptor,web:{admin:{...descriptor.web.admin,publicDir}}}).success,false);
 assert.equal(applicationDescriptorSchema.safeParse({...descriptor,web:{h5:{directory:'web/mini-program'}}}).success,false);
});

test('application installation requires every declared frontend entry in the verified file inventory',()=>{
 const descriptor=applicationDescriptorSchema.parse({format:'qicore-application-v1',key:'example',packageKey:'app_example',version:'1.0.0',name:'Example',pendingTasks:[],web:{admin:{entrypoint:'web/admin/server/index.mjs',publicDir:'web/admin/public',routes:[{path:'/tenant/example',label:'Example',permission:'records.read',group:'production',icon:'i-lucide-layers'}]},h5:{directory:'web/h5'},miniProgram:{directory:'web/mini-program',manifest:'web/mini-program/mini-program-template.json'}}});
 const paths=['application.json','entry.mjs','web/admin/server/index.mjs','web/h5/index.html','web/h5/h5-routes.json','web/mini-program/mini-program-template.json'];
 const manifest={package_type:'app_update',package_key:'app_example',version:'1.0.0',entrypoint:'entry.mjs',files:paths.map(path=>({path}))};
 assert.doesNotThrow(()=>assertApplicationReleaseLayout(descriptor,manifest));
 for(const missing of paths)assert.throws(()=>assertApplicationReleaseLayout(descriptor,{...manifest,files:manifest.files.filter(file=>file.path!==missing)}),/APPLICATION_LAYOUT_INCOMPLETE/,missing);
 assert.throws(()=>assertApplicationReleaseLayout(descriptor,{...manifest,package_key:'app_other'}),/APPLICATION_DESCRIPTOR_MISMATCH/);
 assert.throws(()=>assertApplicationReleaseLayout(descriptor,{...manifest,version:'2.0.0'}),/APPLICATION_DESCRIPTOR_MISMATCH/);
 const {web,...serverOnly}=descriptor;
 assert.doesNotThrow(()=>assertApplicationReleaseLayout(serverOnly,{...manifest,entrypoint:'server/main.mjs',files:[{path:'application.json'},{path:'server/main.mjs'}]}),'server-only and existing signed entrypoint layouts remain valid');
});
