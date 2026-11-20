import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StorageProviders,publicObjectUrl} from '../src/storage/providers.mjs';

test('public cloud writes use public objects and resource domains; legacy private revisions keep their ACL checks',async()=>{
 const providers=new StorageProviders('unused'),calls=[],config={access:'public',privateDomain:'https://files.example.com',bucket:'fixture',region:'oss-cn-hangzhou'};
 providers.oss=()=>({put:async(...args)=>calls.push(args),getBucketACL:async()=>{throw Error('must not inspect public bucket ACL')},signatureUrl:()=>{throw Error('must not sign public urls')}});
 await providers.put('oss',config,{},'sites/site-a/shared/image.webp',Buffer.from('image'),'image/webp');
 assert.equal(calls[0][2].headers['x-oss-object-acl'],'public-read');
 assert.equal(await providers.url('oss',config,{},'sites/site-a/shared/image.webp'),'https://files.example.com/sites/site-a/shared/image.webp');
 providers.cos=()=>({putObject:async args=>calls.push(args)});await providers.put('cos',config,{},'sites/site-a/shared/video.mp4',Buffer.from('video'));
 assert.equal(calls[1].ACL,'public-read');
 assert.equal(publicObjectUrl('local',config,'platform/image.webp'),null);assert.equal(publicObjectUrl('oss',{...config,access:undefined},'legacy/image.webp'),null);
 assert.throws(()=>publicObjectUrl('oss',config,'../other/image.webp'),/INVALID_OBJECT_KEY/);
 providers.qiniu=()=>({manager:{getBucketInfo:async()=>({ok:()=>false})}});await assert.rejects(providers.checkPrivate('qiniu',{},{}),/BUCKET_LOOKUP_FAILED/);
 providers.qiniu=()=>({manager:{getBucketInfo:async()=>({ok:()=>true,data:{private:0}})}});await assert.rejects(providers.checkPrivate('qiniu',{},{}),/BUCKET_NOT_PRIVATE/);
 providers.qiniu=()=>({manager:{getBucketInfo:async()=>({ok:()=>true,data:{private:1}})}});await providers.checkPrivate('qiniu',{},{});
});
