import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync} from 'node:fs';
import {noLinks} from './native-files.js';
import type {NativeConfig} from './native-state.js';

export function assertRuntimeCodeAccess(config:Pick<NativeConfig,'root'|'runtimeUid'|'runtimeGid'>){
 if(process.platform!=='linux')return;
 noLinks(config.root);
 if(!existsSync(config.root))throw Error('INSTALL_CODE_DIRECTORY_MISSING');
 if(!lstatSync(config.root).isDirectory())throw Error('INSTALL_CODE_PATH_INVALID');
 const probe=spawnSync(process.execPath,['--input-type=module','-e',"import {accessSync,constants} from 'node:fs';try{accessSync(process.argv[1],constants.R_OK|constants.X_OK)}catch{process.exit(1)}",config.root],
  {uid:config.runtimeUid,gid:config.runtimeGid,env:{},stdio:'ignore',timeout:5000});
 if(probe.status!==0)throw Error('INSTALL_RUNTIME_DIRECTORY_UNAVAILABLE');
}
