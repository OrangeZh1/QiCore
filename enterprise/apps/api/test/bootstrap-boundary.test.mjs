import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

test('the privileged bootstrap bundles descriptor checks without importing the application SDK',async()=>{
 const result=await build({entryPoints:[fileURLToPath(new URL('../dist/lifecycle/native-controller.js',import.meta.url))],bundle:true,write:false,metafile:true,platform:'node',format:'esm',target:'node24',external:['@prisma/client']});
 const inputs=Object.keys(result.metafile.inputs).map(path=>path.replaceAll('\\','/'));
 assert.ok(inputs.some(path=>path.endsWith('/applications/native-descriptor-file.js')));
 for(const path of inputs)assert.doesNotMatch(path,/applications\/(?:server-sdk|installed-runtime|native-catalog)\.|\/(?:storage\/providers|payments\/execution)\.mjs$/);
});

test('the public gateway worker bundles independently without privileged lifecycle or database modules',async()=>{
 const result=await build({entryPoints:[fileURLToPath(new URL('../dist/lifecycle/bootstrap-gateway-worker.js',import.meta.url))],bundle:true,write:false,metafile:true,platform:'node',format:'esm',target:'node24'});
 const inputs=Object.keys(result.metafile.inputs).map(path=>path.replaceAll('\\','/'));
 assert.equal(inputs.length,2);for(const path of inputs)assert.match(path,/bootstrap-gateway(?:-worker)?\.js$/);
});
