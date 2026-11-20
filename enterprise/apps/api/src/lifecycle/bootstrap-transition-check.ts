import {readFileSync} from 'node:fs';
import {canonicalJson} from '../license/contracts.js';
import {bootstrapConfigSchema} from './bootstrap-config.js';
import {NativeState,nativeConfigSchema} from './native-state.js';
import {noLinks} from './native-files.js';

// Bundled with the new controller: validates old receipts without rewriting them.
export async function verifyTransitionInstallation(configPath:string){
 noLinks(configPath);
 const config=bootstrapConfigSchema.parse(JSON.parse(readFileSync(configPath,'utf8')));
 noLinks(config.nativeConfigFile);
 const native=nativeConfigSchema.parse(JSON.parse(readFileSync(config.nativeConfigFile,'utf8')));
 if(canonicalJson({...native,migrationUrl:''})!==canonicalJson({...config.native,migrationUrl:''}))throw Error('INSTALL_CONFIG_CHANGED');
 if(native.product.product!=='qicore'||native.frameworkKey!=='frm_cdm43f43e7yhk5jd')throw Error('BOOTSTRAP_PRODUCT_INVALID');
 const state=new NativeState(native),installed=state.installed();
 if(!installed.some(row=>row.packageKey===native.frameworkKey)||state.component(native.frameworkKey).read<{status:string}>('installation.json')?.status!=='succeeded')throw Error('BOOTSTRAP_INSTALLED_REQUIRED');
 // UpdateEngine marks preparation failures blocked only after cleanup succeeds; failed cleanup requires recovery.
 if(state.tasks().some(task=>!['succeeded','rolled_back','blocked'].includes(task.status)))throw Error('BOOTSTRAP_RECOVERY_REQUIRED');
 for(const {packageKey} of installed)await state.verifyCurrent(packageKey);
 return installed.map(row=>({...row,image:state.active(row.packageKey)!.current.image}));
}
