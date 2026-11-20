import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

export class StorageSecrets {
  constructor(root){this.root=resolve(root);this.securedFile=null;this.keyFileSeen=false}
  async assertExistingKey(db){
    if (await db.coreStorageRevision.count({where:{secretsCipher:{not:null}}})) this.key(false)

  }
  key(create=true){
    if(process.env.STORAGE_ENCRYPTION_KEY){const key=Buffer.from(process.env.STORAGE_ENCRYPTION_KEY,'base64');if(key.length!==32)throw Error('STORAGE_KEY_INVALID');return key}
    mkdirSync(this.root,{recursive:true,mode:0o700});if(lstatSync(this.root).isSymbolicLink())throw Error('STORAGE_KEY_PATH_INVALID');
    const file=resolve(this.root,'storage.key');
    if(!existsSync(file)){if(!create||this.keyFileSeen)throw Error('STORAGE_KEY_MISSING');try{writeFileSync(file,randomBytes(32),{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}}
    const stamp=()=>{const stat=lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())throw Error('STORAGE_KEY_PATH_INVALID');return [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs,stat.mode].join(':')};
    const identityBefore=stamp();
    // Secure a new/replaced/changed file once. Keep checking metadata and reading
    // the key so removal, corruption and rotation are never hidden by a key cache.
    if(process.platform==='win32'&&this.securedFile!==identityBefore){
      const identity=spawnSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
      const sid=identity.stdout?.match(/S-1-5-[0-9-]+/)?.[0];if(identity.status!==0||!sid)throw Error('STORAGE_KEY_ACL_FAILED');
      const acl=spawnSync('icacls',[file,'/inheritance:r','/grant:r',`*${sid}:(F)`,'*S-1-5-18:(F)','*S-1-5-32-544:(F)'],{windowsHide:true,stdio:'ignore'});
      if(acl.status!==0)throw Error('STORAGE_KEY_ACL_FAILED');
      this.securedFile=stamp();
    }
    const key=readFileSync(file);if(key.length!==32)throw Error('STORAGE_KEY_INVALID');this.keyFileSeen=true;return key;
  }
  encrypt(id,value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key(),iv);cipher.setAAD(Buffer.from(id));const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return [iv,cipher.getAuthTag(),bytes].map(b=>b.toString('base64')).join('.')}
  decrypt(id,value){try{const [iv,tag,bytes]=value.split('.').map(v=>Buffer.from(v,'base64')),cipher=createDecipheriv('aes-256-gcm',this.key(false),iv);cipher.setAAD(Buffer.from(id));cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(bytes),cipher.final()]).toString('utf8'))}catch{throw Error('STORAGE_CREDENTIALS_UNAVAILABLE')}}
}
