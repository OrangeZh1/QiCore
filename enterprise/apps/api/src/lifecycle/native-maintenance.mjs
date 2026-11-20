import {readFileSync} from 'node:fs';
export function nativeMaintenance(file=process.env.QICORE_MAINTENANCE_FILE){
 if(!file)return false;
 try{readFileSync(file);return true}catch(error){return error.code!=='ENOENT'}
}
export function maintenanceReadAllowed(path,method){
 return path==='/health'||method==='GET'&&['/api/v1/public/site','/api/v1/admin/auth/me','/api/v1/admin/updates'].includes(path)
  ||method==='POST'&&path==='/api/v1/admin/updates/resume-closeout';
}
