import {fail} from './errors.mjs';

export class PlatformOverview {
  constructor(db) { this.db=db; }
  async view(s,cache) {
    if(!s._admin||s.role!=='root'||!s.permissions.includes('overview.read'))fail('FORBIDDEN','没有平台工作台权限',403);
    const now=new Date(),today=new Date(new Date(now.getTime()+8*3600000).toISOString().slice(0,10)+'T00:00:00+08:00');
    const periodStart=new Date(today.getTime()-14*86400000);
    const dbStart=performance.now();await this.db.$queryRaw`SELECT 1`;const databaseMs=Math.round((performance.now()-dbStart)*10)/10;
    // 按审计所属范围统计；平台代登录在租户后台的操作仍属于租户活动。
    const [tenants,accounts,roles,newTenants,logins,daily,total]=await this.db.$transaction([
      this.db.tenant.count(),
      this.db.adminAccount.count({where:{enabled:true,role:{portal:'admin',enabled:true}}}),
      this.db.adminRole.count({where:{portal:'admin',enabled:true}}),
      this.db.audit.count({where:{action:'tenant.create',createdAt:{gte:today,lte:now}}}),
      this.db.audit.count({where:{scope:'platform',action:'admin.login',createdAt:{gte:today,lte:now}}}),
      this.db.$queryRaw`SELECT DATE_FORMAT(DATE_ADD(e.createdAt, INTERVAL 8 HOUR), '%Y-%m-%d') AS day,COUNT(*) AS total,COUNT(DISTINCT e.tenantId) AS activeTenants FROM (
        SELECT a.tenantId,a.createdAt FROM Audit a WHERE a.scope = 'tenant'
      ) e JOIN Tenant t ON t.id=e.tenantId WHERE e.createdAt >= ${periodStart} AND e.createdAt <= ${now} GROUP BY day ORDER BY day`,
      this.db.$queryRaw`SELECT COUNT(*) AS total FROM (
        SELECT a.tenantId,a.createdAt FROM Audit a WHERE a.scope = 'tenant'
      ) e JOIN Tenant t ON t.id=e.tenantId WHERE e.createdAt <= ${now}`
    ]);
    const activity=Array.from({length:15},(_,i)=>{const day=new Date(periodStart.getTime()+i*86400000+8*3600000).toISOString().slice(0,10);const row=daily.find(item=>item.day===day);return {day,total:Number(row?.total||0),activeTenants:Number(row?.activeTenants||0)}});
    return {updatedAt:now,activity,counts:{tenants,accounts,roles,newTenants,logins,activeTenants:activity[14].activeTenants,todayOperations:activity[14].total,tenantTotalOperations:Number(total[0].total)},monitor:{databaseMs,redisMs:cache.latencyMs,memoryMb:Math.round(process.memoryUsage().rss/1048576),uptimeSeconds:Math.floor(process.uptime())},services:[{id:'api',name:'平台接口',status:'ready',description:'本次请求响应正常'},{id:'database',name:'MySQL 数据库',status:'ready',description:'连接检查通过'},{id:'cache',name:'Redis 缓存',status:cache.ready?'ready':'error',description:cache.ready?'连接检查通过':'连接失败，请检查本地服务'}]};
  }
}
