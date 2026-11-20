import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePhotoIntegrityQa} from '../../../scripts/prepare-photo-integrity-qa.mjs';

test('combined preparation rejects overlap and existing output without modifying inputs',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-photo-preparation-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const env={QICORE_PHOTO_INPUT_DIR:join(root,'inputs'),NATIVE_PACKAGE_DIR:join(root,'runtime'),QICORE_CUSTOMER_OUTPUT_DIR:join(root,'customer'),QICORE_DELIVERY_REPORT_DIR:join(root,'reports')};
 await mkdir(env.QICORE_PHOTO_INPUT_DIR);await writeFile(join(env.QICORE_PHOTO_INPUT_DIR,'owner.txt'),'preserved');
 await assert.rejects(preparePhotoIntegrityQa({...env,QICORE_CUSTOMER_OUTPUT_DIR:join(env.QICORE_PHOTO_INPUT_DIR,'output')}),/PHOTO_QA_PATHS_OVERLAP/);
 await mkdir(env.QICORE_DELIVERY_REPORT_DIR);await writeFile(join(env.QICORE_DELIVERY_REPORT_DIR,'owner.txt'),'preserved');
 await assert.rejects(preparePhotoIntegrityQa(env),/PHOTO_QA_OUTPUT_EXISTS/);
 assert.equal(await readFile(join(env.QICORE_PHOTO_INPUT_DIR,'owner.txt'),'utf8'),'preserved');
 assert.equal(await readFile(join(env.QICORE_DELIVERY_REPORT_DIR,'owner.txt'),'utf8'),'preserved');
});

test('combined preparation requires original historical photo evidence before creating outputs',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qicore-photo-preparation-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const env={QICORE_PHOTO_INPUT_DIR:join(root,'inputs'),NATIVE_PACKAGE_DIR:join(root,'runtime'),QICORE_CUSTOMER_OUTPUT_DIR:join(root,'customer'),QICORE_DELIVERY_REPORT_DIR:join(root,'reports')};
 await mkdir(env.QICORE_PHOTO_INPUT_DIR);await mkdir(env.NATIVE_PACKAGE_DIR);
 for(const name of ['id-photo-0.1.6-from-0.1.5.zip','id-photo-0.1.7-from-0.1.6.zip','id-photo-0.1.6-local-release.json'])await writeFile(join(env.QICORE_PHOTO_INPUT_DIR,name),'not a trusted historical input');
 await assert.rejects(preparePhotoIntegrityQa(env),/HISTORICAL_PHOTO_RELEASE_CHANGED/);
 assert.deepEqual((await readdir(root)).sort(),['inputs','runtime']);
 await assert.rejects(preparePhotoIntegrityQa({...env,NATIVE_PACKAGE_DIR:'relative/runtime'}),/NATIVE_PACKAGE_DIR required/);
});
