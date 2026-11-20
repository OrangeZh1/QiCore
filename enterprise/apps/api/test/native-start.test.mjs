import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveBootstrapConfigPath,verifyBootstrapInventory} from '../../../scripts/native-start.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,linkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

const root=resolve('/opt/qicore/bootstrap');

test('selecting the launcher without arguments uses the private BaoTa configuration',()=>{
 assert.equal(resolveBootstrapConfigPath(root),resolve('/www/server/nodejs-env/qicore/bootstrap.json'));
 assert.equal(resolveBootstrapConfigPath(resolve('/opt/another/bootstrap')),resolve('/www/server/nodejs-env/qicore/bootstrap.json'));
});

test('an explicit configuration path overrides the default',()=>{
 const custom=resolve('/etc/qicore/bootstrap.json');
 assert.equal(resolveBootstrapConfigPath(root,custom),custom);
});

test('relative explicit configuration paths retain their existing working-directory behavior',()=>{
 assert.equal(resolveBootstrapConfigPath(root,'private/bootstrap.json'),resolve('private/bootstrap.json'));
});

test('default selection does not relax the private configuration boundary',()=>{
 for(const unsafe of [root,join(root,'bootstrap.json'),join(root,'nested','..','bootstrap.json')]){
  assert.throws(()=>resolveBootstrapConfigPath(root,unsafe),/PRIVATE_CONFIG_OUTSIDE_BOOTSTRAP_REQUIRED/);
 }
 assert.throws(()=>resolveBootstrapConfigPath(resolve('/www/server/nodejs-env/qicore')),/PRIVATE_CONFIG_OUTSIDE_BOOTSTRAP_REQUIRED/);
});

test('a similarly named sibling directory is outside the bootstrap code',()=>{
 const sibling=resolve('/opt/qicore/bootstrap-config/bootstrap.json');
 assert.equal(resolveBootstrapConfigPath(root,sibling),sibling);
});

test('PM2 importing its configured entry still invokes the launcher',()=>{
 const entry=new URL('../../../scripts/native-start.mjs',import.meta.url);
 // The source tree has no bootstrap manifest, so entry detection can be checked
 // without starting a controller or accessing a real deployment configuration.
 const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(entry.href)})`],{env:{...process.env,pm_exec_path:fileURLToPath(entry)},encoding:'utf8',windowsHide:true});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/LINUX_NODE24_REQUIRED|bootstrap-manifest\.json/);
});

function inventory(t,declaredPlaceholder=false){
 const dir=mkdtempSync(join(tmpdir(),'qicore-inventory-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const files={'start.mjs':'verified code','ui/index.mjs':'verified ui',...(declaredPlaceholder?{'.htaccess':'# declared'}:{})};
 const manifest={files:Object.entries(files).map(([path,content])=>{mkdirSync(resolve(dir,path,'..'),{recursive:true});writeFileSync(join(dir,path),content);return {path,size:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')}})};
 writeFileSync(join(dir,'bootstrap-manifest.json'),JSON.stringify(manifest));return dir;
}
test('only the undeclared root BaoTa empty placeholder is compatible',async t=>{
 const dir=inventory(t);
 for(const text of ['', ' \r\n\t', '# 请将伪静态规则或自定义Apache配置填写到此处', '\uFEFF# 请将伪静态规则或自定义Apache配置填写到此处\r\n']){
  writeFileSync(join(dir,'.htaccess'),text);assert.equal((await verifyBootstrapInventory(dir)).size,2);
 }
 for(const text of ['RewriteEngine On','# custom rules','# 请将伪静态规则或自定义Apache配置填写到此处\nDeny from all',' '.repeat(1025)]){
  writeFileSync(join(dir,'.htaccess'),text);await assert.rejects(verifyBootstrapInventory(dir),/BOOTSTRAP_INVENTORY_MISMATCH/);
 }
 writeFileSync(join(dir,'.htaccess'),Buffer.from([255]));await assert.rejects(verifyBootstrapInventory(dir));
 rmSync(join(dir,'.htaccess'));writeFileSync(join(dir,'ui/.htaccess'),'');await assert.rejects(verifyBootstrapInventory(dir),/ui\/\.htaccess/);
});
test('placeholder compatibility preserves missing, unknown, size and hash failures',async t=>{
 const dir=inventory(t);writeFileSync(join(dir,'.htaccess'),'');
 writeFileSync(join(dir,'start.mjs'),'modified code');await assert.rejects(verifyBootstrapInventory(dir),/BOOTSTRAP_FILE_CHANGED/);
 writeFileSync(join(dir,'start.mjs'),'short');await assert.rejects(verifyBootstrapInventory(dir),/BOOTSTRAP_INVENTORY_MISMATCH/);
 rmSync(join(dir,'start.mjs'));await assert.rejects(verifyBootstrapInventory(dir),/missing.*start.mjs/);
 writeFileSync(join(dir,'start.mjs'),'verified code');writeFileSync(join(dir,'extra.txt'),'');await assert.rejects(verifyBootstrapInventory(dir),/extra.txt/);
 const declared=inventory(t,true);writeFileSync(join(declared,'.htaccess'),'');await assert.rejects(verifyBootstrapInventory(declared),/BOOTSTRAP_INVENTORY_MISMATCH/);
});
test('placeholder must remain a regular single-link file',async t=>{
 const dir=inventory(t),external=mkdtempSync(join(tmpdir(),'qicore-placeholder-'));t.after(()=>rmSync(external,{recursive:true,force:true}));
 writeFileSync(join(external,'empty'),'');linkSync(join(external,'empty'),join(dir,'.htaccess'));
 await assert.rejects(verifyBootstrapInventory(dir),/BOOTSTRAP_FILE_REJECTED/);rmSync(join(dir,'.htaccess'));
 symlinkSync(external,join(dir,'.htaccess'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(verifyBootstrapInventory(dir),/BOOTSTRAP_LINK_REJECTED/);rmSync(join(dir,'.htaccess'));
 mkdirSync(join(dir,'.htaccess'));await assert.rejects(verifyBootstrapInventory(dir),/BOOTSTRAP_FILE_REJECTED/);
});
