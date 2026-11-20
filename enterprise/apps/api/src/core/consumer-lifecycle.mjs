import {fail} from './errors.mjs';
export async function assertConsumerActive(db,tenantId,applicationKey,userId){
 const profile=await db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:{tenantId,applicationKey,userId}},select:{deletedAt:true,enabled:true}});
 if(profile?.deletedAt)fail('CONSUMER_DELETED','用户已删除，无法继续访问',403);
 if(profile?.enabled===false)fail('CONSUMER_DISABLED','用户已停用，无法继续访问',403);
}
