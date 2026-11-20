import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {hash} from './native-release.mjs';
import {nativeArchiveManifestSchema} from '../../dist/license/native-release.js';

export const photoInputs={
 original:{env:'QICORE_PHOTO_ORIGINAL_ZIP',sha256:'3da918bfad33049ffb3d5b4a9b443e553f57a69d0c3c9fd30a0d223719f6c0d2',version:'0.1.0',from:'0.0.0',range:'=0.1.0'},
 compatible:{env:'QICORE_PHOTO_COMPATIBLE_ZIP',sha256:'b0f95392598bafff82a32df8fc570ffdb83f8932a85f37e09f610e0572dc39c9',version:'0.1.1',from:'0.1.0',range:'>=0.1.0 <=0.1.2',manifestSha256:'7da23de164e9fd246c049759865119ee5b947ed6ab43cb0397b702e2d9cae6ea'},
 framework:{env:'QICORE_FRAMEWORK_011_ZIP',sha256:'ef24d4a1ba08925482c4c2b3a4af2823b3318ad55479e5faf13ed57c06424cff',version:'0.1.1',from:'0.1.0',manifestSha256:'94068056104b6b6f275003cdca3a52808a92e6b3e973d31df7b475679681e7c3'},
};
export async function readPhotoInputs(env=process.env){
 const inputs={};
 for(const [name,expected] of Object.entries(photoInputs)){
  assert.ok(env[expected.env],expected.env+' must explicitly identify its approved archive');const path=resolve(env[expected.env]),bytes=await readFile(path);assert.equal(hash(bytes),expected.sha256,name+' archive digest');
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-c',"import sys,zipfile,base64; z=zipfile.ZipFile(sys.argv[1]); print(base64.b64encode(z.read('release-manifest.json')).decode())",path],{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});assert.equal(result.status,0,name+' manifest read');
  const raw=Buffer.from(result.stdout.trim(),'base64'),manifest=nativeArchiveManifestSchema.parse(JSON.parse(raw));if(expected.manifestSha256)assert.equal(hash(raw),expected.manifestSha256,name+' manifest digest');
  assert.equal(manifest.version,expected.version);assert.equal(manifest.from_version,expected.from);assert.equal(manifest.package_key,name==='framework'?'frm_cdm43f43e7yhk5jd':'app_kmqjjt72urnxp526');if(expected.range)assert.equal(manifest.framework.range,expected.range);
  inputs[name]={path,bytes,manifest,sha256:expected.sha256,manifestSha256:hash(raw)};
 }
 assert.deepEqual(inputs.original.manifest.migrations,inputs.compatible.manifest.migrations,'compatibility release must not alter migrations');
 const mini=manifest=>manifest.files.filter(file=>file.path.startsWith('web/mini-program/'));assert.deepEqual(mini(inputs.original.manifest),mini(inputs.compatible.manifest),'mini-program must remain byte-identical');
 return inputs;
}
