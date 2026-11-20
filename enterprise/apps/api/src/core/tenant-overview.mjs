import {TenantApplications} from '../applications/service.mjs';
import {application} from '../applications/registry.mjs';
import {orderOverview} from './financial-records.mjs';
import {fail} from './errors.mjs';

export class TenantOverview {
 constructor(db){this.db=db;this.applications=new TenantApplications(db)}
 async context(db,s,tenantId){
  await this.applications.actor(db,s,'tenant',tenantId);
  const bindings=await db.tenantApplication.findMany({where:{tenantId,activeSlot:1},select:{applicationKey:true}});
  if(bindings.length!==1)fail('APPLICATION_BINDING_CONFLICT','站点应用绑定需要核查',409);
  const key=bindings[0].applicationKey;
  await this.applications.admin(s,tenantId,key,'overview.read',db);
  if(!application(key).overview)fail('OVERVIEW_UNAVAILABLE','当前应用尚未提供工作台统计',403);
  return key;
 }
 async view(s,tenantId){
  const key=await this.context(this.db,s,tenantId);
  const result=await this.db.$transaction(async db=>{
   if(await this.context(db,s,tenantId)!==key)fail('FORBIDDEN','站点应用已变更',403);
   const tenant=await db.tenant.findUnique({where:{id:tenantId},select:{id:true,name:true,enabled:true,expiresAt:true}});
   const now=new Date(),today=new Date(new Date(now.getTime()+8*3600000).toISOString().slice(0,10)+'T00:00:00+08:00'),periodStart=new Date(today.getTime()-14*86400000),range={now,today,periodStart};
   const adapter=application(key).overview,business=await adapter.read(db,tenantId,range);
   const orders=await orderOverview(db,tenantId,key,adapter.orderRows(tenantId),range);
   const registeredMembers=await db.consumerProfile.count({where:{tenantId,applicationKey:key,deletedAt:null,createdAt:{lte:now}}});
   return{tenant,applicationKey:key,updatedAt:now,integrationMode:process.env.NODE_ENV==='development'?'development-mock':'production',...business,counts:{...business.counts,registeredMembers,paidOrders:orders.paid},orders};
  },{isolationLevel:'RepeatableRead'});
  if(await this.context(this.db,s,tenantId)!==key)fail('FORBIDDEN','站点应用已变更',403);
  return result;
 }
}
