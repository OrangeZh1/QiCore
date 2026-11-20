import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';

// Follow the actual installed dependency graph, including pnpm patch hashes.
function dependency(chain){
 let require=createRequire(new URL('../package.json',import.meta.url));
 for(const name of chain){const file=require.resolve.paths(name).map(path=>join(path,name,'package.json')).find(existsSync);assert.ok(file,'installed dependency: '+name);require=createRequire(realpathSync(file))}
 return require('./');
}

test('patched forge rejects extra nested DigestAlgorithm elements while accepting valid RSA signatures',()=>{
 const forge=dependency(['nuxt','@nuxt/cli','listhen','node-forge']);
 const pair=generateKeyPairSync('rsa',{modulusLength:1024,publicExponent:3,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}});
 const privateKey=forge.pki.privateKeyFromPem(pair.privateKey),publicKey=forge.pki.publicKeyFromPem(pair.publicKey),md=forge.md.sha256.create().update('QiCore regression');
 assert.equal(publicKey.verify(md.digest().bytes(),privateKey.sign(md)),true);
 const {asn1}=forge,sequence=children=>asn1.create(asn1.Class.UNIVERSAL,asn1.Type.SEQUENCE,true,children),oid=asn1.create(asn1.Class.UNIVERSAL,asn1.Type.OID,false,asn1.oidToDer(forge.pki.oids.sha256).getBytes());
 for(const parameters of [[],[asn1.create(asn1.Class.UNIVERSAL,asn1.Type.NULL,false,'')]]){
  const digest=()=>asn1.create(asn1.Class.UNIVERSAL,asn1.Type.OCTETSTRING,false,md.digest().bytes());
  const valid=asn1.toDer(sequence([sequence([oid,...parameters]),digest()])).getBytes();
  assert.equal(publicKey.verify(md.digest().bytes(),privateKey.sign(valid,'NONE')),true);
  const malformed=asn1.toDer(sequence([sequence([oid,...parameters,asn1.create(asn1.Class.UNIVERSAL,asn1.Type.OCTETSTRING,false,'unconsumed')]),digest()])).getBytes();
  assert.throws(()=>publicKey.verify(md.digest().bytes(),privateKey.sign(malformed,'NONE')),/valid RSASSA/);
 }
});

test('patched braces bounds string and AST nesting before recursive traversal without changing ordinary patterns',()=>{
 const braces=dependency(['nuxt','@nuxt/kit','globby','fast-glob','micromatch','braces']);
 assert.deepEqual(braces.expand('a/{b,c}/{1..3}'),['a/b/1','a/b/2','a/b/3','a/c/1','a/c/2','a/c/3']);
 assert.equal(braces.compile('a/{b,c}/d'),'a/(b|c)/d');
 assert.equal(braces.stringify(braces.parse('a/{b,c}/d')),'a/{b,c}/d');
 for(const method of ['parse','compile','expand','stringify']){
  for(const [open,close] of [['{','}'],['(',')']])assert.throws(()=>braces[method](open.repeat(2000)+'a,b'+close.repeat(2000)),error=>error instanceof SyntaxError&&/maximum depth/.test(error.message));
 }
 for(const method of ['compile','expand','stringify']){
  const ast={type:'root',nodes:[]};let node=ast;for(let i=0;i<2000;i++){const child={type:'brace',nodes:[],parent:node};node.nodes.push(child);node=child}
  assert.throws(()=>braces[method](ast),error=>error instanceof SyntaxError&&/maximum depth/.test(error.message));
 }
});
