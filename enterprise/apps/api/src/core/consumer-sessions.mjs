import {createHash} from 'node:crypto';
import {TenantApplications} from '../applications/service.mjs';
import {assertConsumerActive} from './consumer-lifecycle.mjs';
import {fail} from './errors.mjs';

// Public consumer routes authenticate against the stored scope, not a default app.
export class ConsumerSessions {
 constructor(db){this.db=db;this.apps=new TenantApplications(db)}
 async read(token,applicationKey){
  if(typeof token!=='string'||token.length!==64)fail('UNAUTHENTICATED','请登录',401);
  const s=await this.db.session.findUnique({where:{token:createHash('sha256').update(token).digest('hex')}});
  if(!s||s.role!=='user'||s.expiresAt<=new Date())fail('UNAUTHENTICATED','会话已过期',401);
  if(applicationKey!==undefined&&s.applicationKey!==applicationKey)fail('APPLICATION_MISMATCH','会话不能用于此应用',403);
  await this.apps.available(s.tenantId,s.applicationKey);
  await assertConsumerActive(this.db,s.tenantId,s.applicationKey,s.userId);
  return s;
 }
}
