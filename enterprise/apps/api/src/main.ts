import {readFileSync} from 'node:fs';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module, Controller, All, Req, Res, Catch, ArgumentsHost, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import {pipeline,type Readable} from 'node:stream';
import Redis from 'ioredis';
import {createApplicationRuntimes,nativeComponents,applicationDatabaseModels} from '#qicore/application-runtime';
import {createApplicationDatabase} from './applications/database.mjs';
import {ConsumerSessions} from './core/consumer-sessions.mjs';
import {maintenanceRoute,needMaintenance} from './core/standalone-maintenance.mjs';
import { Fault, fail } from './core/errors.mjs';
import { enterpriseId, bindStandaloneEnterprise, developmentBootstrapAllowed, scopedInput, assertEnterpriseRequest, assertEnterpriseSession, wholeProductRoute, requireProductOwner } from './core/standalone-edition.mjs';
import {requestContext,logFailure} from './core/diagnostics.mjs';
import {application,loadedComponents} from './applications/registry.mjs';
import {TenantApplications,bindApplicationLicensing} from './applications/service.mjs';
import {ConsumerSmsAuth} from './core/consumer-sms-auth.mjs';
import {ConsumerAuth} from './core/consumer-auth.mjs';
import {OfficialConsumerAuth} from './core/official-consumer-auth.mjs';
import {StandaloneBenefits} from './core/standalone-benefits.mjs';
import {TenantPackages} from './core/tenant-packages.mjs';
import {TenantRecords} from './core/tenant-records.mjs';
import {PaymentExecution} from './payments/execution.mjs';
import {PaymentClientPolicy} from './payments/client-policy.mjs';
import {AfterSales} from './core/after-sales.mjs';
import {TenantVirtualGoods} from './core/tenant-virtual-goods.mjs';
import {TenantSms} from './core/tenant-sms.mjs';
import {TenantSubscriptions} from './core/tenant-subscriptions.mjs';
import {TenantPayments} from './core/tenant-payments.mjs';
import {TenantMiniPrograms} from './core/tenant-mini-programs.mjs';
import {TenantMiniAds} from './core/tenant-mini-ads.mjs';
import {TenantPolicies} from './core/tenant-policies.mjs';
import {HelpCenter} from './core/help-center.mjs';
import {TenantOfficialAccounts} from './core/tenant-official-accounts.mjs';
import {TenantMiniUpload} from './core/tenant-mini-upload.mjs';
import {WechatConsumerAuth} from './core/wechat-consumer-auth.mjs';
import {MemberManagement} from './core/member-management.mjs';
import {TenantH5} from './core/tenant-h5.mjs';
import {TenantConsumers} from './core/tenant-consumers.mjs';
import {ConsumerAssets} from './core/consumer-assets.mjs';
import {Recharge,rechargePayments} from './core/recharge.mjs';
import {frameworkKey} from './applications/framework.mjs';
import {ConsumerMemberLevels} from './core/consumer-member-levels.mjs';
import {ConsumerGrowthRecords} from './core/consumer-growth-records.mjs';
import {ConsumerProfiles} from './applications/consumer-profiles.mjs';
import { PlatformResources } from './core/platform-resources.mjs';
import { PlatformOverview } from './core/platform-overview.mjs';
import { TenantOverview } from './core/tenant-overview.mjs';
import { AdminAuth } from './core/admin-auth.mjs';
import { LicenseRuntime } from './license/runtime.js';
import {installationPreviewAuthorization} from './core/install-preview.mjs';
import { UpdateService } from './lifecycle/update-service.js';
import {nativeMaintenance,maintenanceReadAllowed} from './lifecycle/native-maintenance.mjs';
import {TenantSiteSettings} from './core/tenant-site-settings.mjs';
import {TenantDecoration} from './core/tenant-decoration.mjs';
import {TenantPageSharing} from './core/tenant-page-sharing.mjs';
import {DecorationPreviews} from './core/decoration-previews.mjs';
import {TenantConsumerSettings} from './core/tenant-consumer-settings.mjs';
import { SiteSettings } from './core/site-settings.mjs';
import { TenantPermissions } from './core/tenant-permissions.mjs';
import { RoleManagement } from './core/role-management.mjs';
import { PlatformAdmins } from './core/platform-admins.mjs';
import { SystemLogs } from './core/system-logs.mjs';
import { SystemEnvironment } from './core/system-environment.mjs';
import { SystemCache } from './core/system-cache.mjs';
import { ScheduledTasks } from './core/scheduled-tasks.mjs';
import { Materials } from './core/materials.mjs';
import { TenantMaterials } from './core/tenant-materials.mjs';
import { Restoration } from './backups/restoration.mjs';
import { BackupService } from './backups/service.mjs';
import { TenantManagement } from './core/tenant-management.js';

@Catch()
class Errors implements ExceptionFilter {
  catch(e:unknown,host:ArgumentsHost) {
    const response=host.switchToHttp().getResponse<Response>();
    const requestId=response.locals.requestId||randomUUID();
    const status=e instanceof Fault?e.status:e instanceof HttpException?e.getStatus():500;
    const code=e instanceof Fault?e.code:status===500?'INTERNAL_ERROR':'REQUEST_INVALID';
    const message=e instanceof Fault?e.message:status===500?'服务暂不可用，请重试':'请求未通过校验';
    if(e instanceof Fault&&e.code==='RANGE_NOT_SATISFIABLE')response.setHeader('Content-Range','bytes */'+String((e as any).size));
    if(status>=500)logFailure(e,{requestId,operation:'http',method:host.switchToHttp().getRequest<Request>().method,status});
    // 不打印请求体、照片、密钥、数据库连接或令牌。
    response.status(status).json({error:{code,message,requestId},mock:process.env.NODE_ENV==='development'});
  }
}
@Controller()
class Api {
  @All('*path')
  async route(@Req() req:Request,@Res() res:Response) {
    const company=enterpriseId(db);
    assertEnterpriseRequest(company,req);
    const p=req.path.replace(/^\/api\/v1/,'').split('/').filter(Boolean),method=req.method;
    if(nativeMaintenance()&&!maintenanceReadAllowed(req.path,method))return res.status(503).json({error:{code:'APPLICATION_MAINTENANCE',message:'系统正在安装或更新，请稍后重试'}});
    if(req.path==='/api/v1/admin/backups/restore/status'&&method==='POST'){adminAuth.originAllowed(req.headers.origin);res.setHeader('Cache-Control','no-store');return res.json({data:restoration.status(req.body,company)})}
    if(restoration.active){
      if(req.path==='/api/v1/public/site'&&method==='GET'&&restoration.state()?.brand){res.setHeader('Cache-Control','no-store');return res.json({data:restoration.state().brand})}
      return res.status(503).json({error:{code:'DATABASE_MAINTENANCE',message:'数据库正在还原或等待恢复，请稍后重试'}});
    }
    inFlight++;try{
    let result:unknown;
    if(req.path==='/health') {
      await db.$queryRaw`SELECT 1`;
      const redis=new Redis.default(process.env.REDIS_URL!,{connectTimeout:2000,maxRetriesPerRequest:0,lazyConnect:true});
      try{await redis.connect();await redis.ping();}finally{redis.disconnect();}
      for(const runtime of appRuntimes)if(await runtime.health()!==true)throw Error('APPLICATION_NOT_READY');
      const components=nativeComponents?Object.fromEntries(Object.entries(nativeComponents).map(([key,component])=>[key,{version:component.version,manifestSha256:component.manifestSha256}])):undefined;
      return res.json({ready:true,version:licenseRuntime.frameworkVersion,mock:!components,components,runtimeId:process.env.QICORE_RUNTIME_ID,integrations:'blocked'});
    }
    if(!req.path.startsWith('/api/v1/'))fail('NOT_FOUND','接口不存在',404);
    if(p[0]==='install'&&p[1]==='authorization'&&p.length===2&&method==='GET'){res.setHeader('Cache-Control','no-store, private');return res.json({data:installationPreviewAuthorization(licenseRuntime,{remoteAddress:req.socket.remoteAddress,origin:req.headers.origin})})}
    if(p[0]==='public'&&p[1]==='site'&&p.length===2&&method==='GET'){res.setHeader('Cache-Control','no-store');return res.json({data:await siteSettings.publicView()})}
    if(p[0]==='public'&&p[1]==='client'&&method==='GET'){
      licenseRuntime.assertAllowed();res.setHeader('Cache-Control','no-store');
      if(p.length===3&&p[2]==='decoration')return res.json({data:await tenantDecoration.publicView(scopedInput(company,req.query))});
      if(p.length===3&&p[2]==='customer-service')return res.json({data:await tenantConsumerSettings.publicCustomerService(scopedInput(company,req.query))});
      if(p.length===3&&p[2]==='member-levels')return res.json({data:await consumerMemberLevels.publicView(scopedInput(company,req.query))});
      if(p.length===3&&p[2]==='recharge-catalog')return res.json({data:await recharge.publicCatalog(scopedInput(company,req.query))});
      if(p.length===4&&p[2]==='images'){return sendMaterialFile(req,res,await tenantDecoration.publicImage(scopedInput(company,req.query),p[3]));}
    }
    if(p[0]==='public'&&p[1]==='h5'&&method==='GET'){
      licenseRuntime.assertAllowed();res.set({'Cache-Control':'no-store','Referrer-Policy':'same-origin'});
      if(p.length===3&&p[2]==='runtime')return res.json({data:await tenantH5.runtime(req.query)});
      if(p.length===3&&p[2]==='decoration')return res.json({data:await tenantH5.publicDecoration(req.query)});
      if(p.length===4&&p[2]==='images'){return sendMaterialFile(req,res,await tenantH5.image(req.query,p[3]));}
      fail('NOT_FOUND','接口不存在',404);
    }
    if(p[0]==='public'&&p[1]==='policies'&&p.length===5&&method==='GET'){licenseRuntime.assertAllowed();res.setHeader('Cache-Control','no-store');return res.json({data:await tenantPolicies.published(p[2],p[3],p[4],req.query.version)})}
    if(p[0]==='public'&&p[1]==='help'&&[4,5].includes(p.length)&&method==='GET'){licenseRuntime.assertAllowed();res.setHeader('Cache-Control','no-store');return res.json({data:await helpCenter.published(p[2],p[3],req.query,p[4])})}
    if(p[0]==='public'&&p[1]==='wechat-official'&&p.length===4&&['GET','POST'].includes(method)){licenseRuntime.assertAllowed();const value=await tenantOfficialAccounts.callback(p[2],p[3],req.query,method==='POST'&&Buffer.isBuffer(req.body)?req.body.toString('utf8'):method==='POST'?'':undefined);res.set({'Content-Type':value.startsWith('<xml>')?'application/xml; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store'});return res.send(value)}
    if(p[0]==='public'&&p[1]==='site-assets'&&p.length===3&&method==='GET'){const asset=await siteSettings.image(p[2]);if(asset.revisionId)return sendMaterialFile(req,res,await storage.delivery(asset));res.set({'Content-Type':asset.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=31536000, immutable'});return res.send(Buffer.from(asset.data))}
    if(p[0]==='public'&&p[1]==='decoration-previews'&&method==='GET'){
      res.set({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'});
      if(p.length===3)return res.json({data:await decorationPreviews.view(p[2])});
      if(p.length===5&&p[3]==='images'){return sendMaterialFile(req,res,await decorationPreviews.image(p[2],p[4]));}
      fail('NOT_FOUND','接口不存在',404);
    }
    if(p[0]==='public'&&p[1]==='mini-ads'&&p.length===2&&method==='GET'){licenseRuntime.assertAllowed();res.setHeader('Cache-Control','no-store');return res.json({data:await tenantMiniAds.published(scopedInput(company,req.query))})}
    if(p[0]==='public'&&p[1]==='page-sharing'&&method==='GET'){
      res.setHeader('Cache-Control','no-store');
      if(p.length===6)return res.json({data:await tenantPageSharing.publicView(p[2],p[3],p[4],p[5])});
      if(p.length===7&&p[6]==='image'){return sendMaterialFile(req,res,await tenantPageSharing.image(p[2],p[3],p[4],p[5]));}
      fail('NOT_FOUND','接口不存在',404);
    }
    if(p[0]==='public'&&p[1]==='virtual-goods'&&p.length===4&&p[3]==='image.png'&&method==='GET'){const bytes=await virtualGoods.image(p[2],req.query);res.set({'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});return res.send(bytes)}
    if(p[0]==='admin') {
      res.setHeader('Cache-Control','no-store, private');
      if(p[1]==='auth'&&p[2]==='login'&&method==='POST') {const signed=await adminAuth.login({...req.body,portal:'tenant'},req.ip||'local',req.headers.origin);assertEnterpriseSession(company,signed.info);res.setHeader('Set-Cookie',[signed.cookie,adminAuth.delegationCookie('',0),adminAuth.sessionCookie('',0,'/api/v1',signed.info.role==='tenant'?'tenant':'admin')]);return res.json({data:signed.info,dataMode:'mysql',integrationMode:process.env.NODE_ENV==='development'?'development-mock':'production'});}
      const tenantMaterialRoute=p[1]==='tenants'&&p[3]==='materials'&&p.length>=5;
      const s=await adminAuth.session(req.headers.cookie,'tenant');
      assertEnterpriseSession(company,s);
      const maintenancePermission=maintenanceRoute(p.slice(1),method);if(maintenancePermission)needMaintenance(s,maintenancePermission);
      if(method!=='GET')adminAuth.assertWrite(s,req.headers['x-csrf-token'],req.headers.origin);
      if(!['auth','license','overview','updates','tenant-entry'].includes(p[1]))licenseRuntime.assertAllowed();
      if(wholeProductRoute(p,method)){
        const site=await db.tenant.findUnique({where:{standaloneSlot:1},select:{id:true,enabled:true,expiresAt:true,ownerAdminId:true}});
        requireProductOwner(s,site,licenseRuntime.standalone?.main);
        if(method==='GET')result=await updates.view();
        else if(p[2]==='execute')result=await updates.execute(req.body);
        else{
          const input=req.body??{};
          if(p[1]==='license'?(Object.keys(input).length!==1||input.kind!=='updates'):Object.keys(input).length!==0)fail('UPDATE_INPUT_INVALID','请选择整包更新');
          result=await updates.checkWholeProduct();
        }
      }
      else if(p[1]==='auth'&&p[2]==='me'&&method==='GET'){res.setHeader('Set-Cookie',adminAuth.sessionCookies(req.headers.cookie,s.expiresAt,s.role==='tenant'?'tenant':'admin'));result=adminAuth.publicSession(s);}
      else if(p[1]==='tenant-entry'&&p.length===2&&method==='GET'){
        const entry=await tenantApplications.entry(s,scopedInput(company,req.query),licenseRuntime.view().allowed);
        if(entry.tenant)Object.assign(entry.tenant,{canManageProductUpdates:!!licenseRuntime.standalone?.main&&entry.tenant.ownerAdminId===s.id});
        result=entry;
      }
      else if(p[1]==='auth'&&p[2]==='profile'&&p.length===3&&method==='PUT')result=await adminAuth.updateProfile(s,req.body);
      else if(p[1]==='license'&&p[2]==='status'&&p.length===3&&method==='GET'){adminAuth.authorize(s,'services.read');result=licenseRuntime.view();}
      else if(p[1]==='overview'&&p.length===2&&method==='GET'){adminAuth.authorize(s,'overview.read');const system=licenseRuntime.view();if(!system.allowed)return res.json({data:{system,updatedAt:new Date().toISOString()},dataMode:'mysql',authorizationMode:'qilicense-live'});const started=performance.now();let ready=false,latencyMs:number|null=null;try{ready=await redisClient.ping()==='PONG';latencyMs=Math.round((performance.now()-started)*10)/10;}catch{}const overview=await platformOverview.view(s,{ready,latencyMs});result={...overview,system,monitor:{...overview.monitor,apiMs:Math.round((performance.now()-started)*10)/10}};}
      else if(p[1]==='auth'&&p[2]==='logout'&&method==='POST'){res.setHeader('Set-Cookie',[await adminAuth.logout(s),adminAuth.delegationCookie('',0),adminAuth.sessionCookie('',0,'/api/v1','tenant')]);result={loggedOut:true};}
      else if(p[1]==='auth'&&p[2]==='password'&&method==='PUT'){result=await adminAuth.changePassword(s,req.body);res.setHeader('Set-Cookie',[adminAuth.sessionCookie('',0,'/',s.role==='tenant'?'tenant':'admin'),adminAuth.sessionCookie('',0,'/api/v1',s.role==='tenant'?'tenant':'admin')]);}
      else if(p[1]==='backups'&&p.length===2&&method==='GET')result=await backups.list(s,req.query);
      else if(p[1]==='backups'&&p.length===2&&method==='POST')result=await backups.create(s,req.body);
      else if(p[1]==='backups'&&p.length===3&&p[2]==='delete'&&method==='POST')result=await backups.remove(s,req.body);
      else if(p[1]==='backups'&&p.length===3&&p[2]==='restore'&&method==='POST')result=await restoration.start(s,req.body);
      else if(p[1]==='backups'&&p.length===4&&p[3]==='restore-preview'&&method==='POST')result=await restoration.preview(s,p[2],req.body);
      else if(p[1]==='backups'&&p.length===4&&p[3]==='verify'&&method==='POST')result=await backups.verify(s,p[2]);
      else if(p[1]==='backups'&&p.length===4&&p[3]==='prepare-download'&&method==='POST')result=await backups.prepareDownload(s,p[2]);
      else if(p[1]==='backups'&&p.length===4&&p[3]==='download'&&method==='GET'){const file=await backups.download(s,p[2]);if(!file)throw Error('BACKUP_DOWNLOAD_FAILED');res.set({'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${file.filename}"`,'Content-Length':String(file.bytes),'X-Content-Type-Options':'nosniff'});file.stream.once('error',()=>res.destroy());res.once('close',()=>file.stream.destroy());return file.stream.pipe(res);}
      else if(p[1]==='environment'&&p.length===2&&method==='GET')result=await environment.view(s);
      else if(tenantMaterialRoute){
        const tenantId=p[2],scopeKey=p[4],part=p.slice(5);
        if(part.length===0&&method==='GET')result=await tenantMaterials.list(s,tenantId,scopeKey,req.query);
        else if(part.length===1&&part[0]==='upload'&&method==='POST')result=await tenantMaterials.upload(s,tenantId,scopeKey,{...req.query,groupId:req.query.groupId||null},req.body);
        else if(part.length===1&&part[0]==='move'&&method==='POST')result=await tenantMaterials.move(s,tenantId,scopeKey,req.body);
        else if(part.length===1&&part[0]==='delete'&&method==='POST')result=await tenantMaterials.remove(s,tenantId,scopeKey,req.body);
        else if(part.length===1&&part[0]==='groups'&&method==='POST')result=await tenantMaterials.group(s,tenantId,scopeKey,null,req.body);
        else if(part.length===2&&part[0]==='groups'&&['PUT','DELETE'].includes(method))result=await tenantMaterials.group(s,tenantId,scopeKey,part[1],req.body,method==='DELETE');
        else if(part.length===2&&part[1]==='select'&&method==='POST')result=await tenantMaterials.select(s,tenantId,scopeKey,part[0],req.body);
        else if(part.length===1&&method==='PUT')result=await tenantMaterials.rename(s,tenantId,scopeKey,part[0],req.body);
        else if(part.length===2&&part[1]==='content'&&method==='GET')return sendMaterialFile(req,res,await tenantMaterials.streamContent(s,tenantId,scopeKey,part[0],req.query,req.headers.range));
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='materials'&&p.length===2&&method==='GET')result=await materials.list(s,req.query);
      else if(p[1]==='materials'&&p.length===3&&p[2]==='upload'&&method==='POST')result=await materials.upload(s,{...req.query,groupId:req.query.groupId||null},req.body);
      else if(p[1]==='materials'&&p.length===3&&p[2]==='move'&&method==='POST')result=await materials.move(s,req.body);
      else if(p[1]==='materials'&&p.length===3&&p[2]==='delete'&&method==='POST')result=await materials.remove(s,req.body);
      else if(p[1]==='materials'&&p.length===3&&p[2]==='groups'&&method==='POST')result=await materials.group(s,null,req.body);
      else if(p[1]==='materials'&&p.length===4&&p[2]==='groups'&&['PUT','DELETE'].includes(method))result=await materials.group(s,p[3],req.body,method==='DELETE');
      else if(p[1]==='materials'&&p.length===4&&p[3]==='select'&&method==='POST')result=await materials.select(s,p[2],req.body);
      else if(p[1]==='materials'&&p.length===3&&method==='PUT')result=await materials.rename(s,p[2],req.body);
      else if(p[1]==='materials'&&p.length===4&&p[3]==='content'&&method==='GET'){
        return sendMaterialFile(req,res,await materials.streamContent(s,p[2],req.query,req.headers.range));
      }
      else if(p[1]==='system-cache'&&p.length===2&&method==='GET')result=await systemCache.view(s);
      else if(p[1]==='system-cache'&&p.length===3&&p[2]==='clear'&&method==='POST'){if(!req.body||Object.keys(req.body).length)fail('CACHE_INPUT_INVALID','清理请求无效');result=await systemCache.clear(s);}
      else if(p[1]==='scheduled-tasks'&&p.length===2&&method==='GET')result=await scheduledTasks.list(s,req.query);
      else if(p[1]==='scheduled-tasks'&&p.length===3&&p[2]==='preview'&&method==='POST')result=scheduledTasks.preview(s,req.body);
      else if(p[1]==='scheduled-tasks'&&p.length===2&&method==='POST')result=await scheduledTasks.save(s,null,req.body);
      else if(p[1]==='scheduled-tasks'&&p.length===3&&method==='GET')result=await scheduledTasks.detail(s,p[2]);
      else if(p[1]==='scheduled-tasks'&&p.length===3&&method==='PUT')result=await scheduledTasks.save(s,p[2],req.body);
      else if(p[1]==='scheduled-tasks'&&p.length===4&&p[3]==='run'&&method==='POST')result=await scheduledTasks.runNow(s,p[2],req.body);
      else if(p[1]==='scheduled-tasks'&&p.length===3&&method==='DELETE')result=await scheduledTasks.remove(s,p[2],req.body);
      else if(p[1]==='environment'&&p.length===3&&p[2]==='check'&&method==='POST')result=await environment.check(s,req.body);
      else if(p[1]==='system-logs'&&p.length===2&&method==='GET')result=await systemLogs.list(s,req.query);
      else if(p[1]==='system-logs'&&p.length===3&&p[2]==='export'&&method==='GET')result=await systemLogs.export(s,req.query);
      else if(p[1]==='system-logs'&&p.length===3&&method==='GET')result=await systemLogs.detail(s,p[2]);
      else if(p[1]==='platform-admins'&&p.length===2&&method==='GET')result=await platformAdmins.list(s,req.query);
      else if(p[1]==='platform-admins'&&p.length===3&&p[2]==='roles'&&method==='GET')result=await platformAdmins.directory(s,req.query);
      else if(p[1]==='platform-admins'&&p.length===2&&method==='POST')result=await platformAdmins.create(s,req.body);
      else if(p[1]==='platform-admins'&&p.length===3&&method==='PUT')result=await platformAdmins.edit(s,p[2],req.body);
      else if(p[1]==='platform-admins'&&p.length===4&&method==='PUT'&&['password','status'].includes(p[3]))result=await platformAdmins.edit(s,p[2],req.body,p[3]);
      else if(p[1]==='roles'&&p.length===2&&method==='GET')result=await roles.list(s,req.query);
      else if(p[1]==='roles'&&p.length===2&&method==='POST')result=await roles.create(s,req.body);
      else if(p[1]==='roles'&&p.length===3&&method==='PUT')result=await roles.edit(s,p[2],req.body);
      else if(p[1]==='site'&&p.length===2&&method==='GET'){adminAuth.authorize(s,'settings.read');result=await siteSettings.view(s);}
      else if(p[1]==='site'&&p.length===2&&method==='PUT'){adminAuth.authorize(s,'settings.write');result=await siteSettings.save(s,req.body);}
      else if(p[1]==='site'&&p[2]==='assets'&&p.length===3&&method==='POST'){adminAuth.authorize(s,'settings.write');if(!['icon','logo','login','avatar'].includes(String(req.query.kind)))fail('SITE_IMAGE_INVALID','图片用途无效');const policy=await storage.publicPolicy();const asset=await materials.upload(s,{purpose:'site',kind:'image',name:'站点图片',requestId:randomUUID(),storageRevision:policy.revisionId},req.body);if(!asset)throw Error('MATERIAL_UPLOAD_FAILED');const selected=await materials.select(s,asset.id,{purpose:'site',siteKind:String(req.query.kind||'')});if(!('value' in selected))throw Error('MATERIAL_SELECTION_FAILED');result={url:selected.value,kind:req.query.kind};}
      else if(p[1]==='tenants'&&p[3]==='storage'){
        const settings=storage.forSite(p[2]);
        if(p.length===4&&method==='GET')result=await settings.view(s);
        else if(p.length===5&&method==='PUT')result=await settings.save(s,p[4],req.body);
        else if(p.length===6&&p[5]==='test'&&method==='POST')result=await settings.test(s,p[4]);
        else if(p.length===6&&p[5]==='default'&&method==='POST')result=await settings.activate(s,p[4],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='storage'&&p.length===2&&method==='GET'){adminAuth.authorize(s,'settings.read');result=await storage.view(s);}
      else if(p[1]==='storage'&&p.length===3&&method==='PUT'){adminAuth.authorize(s,'settings.write');result=await storage.save(s,p[2],req.body);}
      else if(p[1]==='storage'&&p.length===4&&p[3]==='test'&&method==='POST'){adminAuth.authorize(s,'settings.write');result=await storage.test(s,p[2]);}
      else if(p[1]==='storage'&&p.length===4&&p[3]==='default'&&method==='POST'){adminAuth.authorize(s,'settings.write');result=await storage.activate(s,p[2],req.body);}
      else if(p[1]==='tenants'&&p[2]==='application-options'&&p.length===3&&method==='GET'){adminAuth.authorize(s,'tenants.write');result=await tenants.applicationChoices(s);}
      else if(p[1]==='tenants'&&p.length===2&&method==='GET'){adminAuth.authorize(s,'tenants.read');result=await tenants.tenants(s,req.query);}
      else if(p[1]==='tenants'&&p.length===2&&method==='POST'){adminAuth.authorize(s,'tenants.write');result=await tenants.createTenant(s,req.body);}
      else if(p[1]==='tenants'&&p.length===4&&p[3]==='login'&&method==='POST'){adminAuth.authorize(s,'accounts.write');adminAuth.authorize(s,'tenants.read');const signed=await adminAuth.startDelegation(s,p[2]);res.setHeader('Set-Cookie',signed.cookie);result=signed.info;}
      else if(p[1]==='tenants'&&p.length===3&&method==='PUT'){adminAuth.authorize(s,'tenants.write');result=await tenants.editTenant(s,p[2],req.body);}
      else if(p[1]==='tenants'&&['roles','administrators'].includes(p[3])){
        const tenantId=p[2],id=p[4];
        if(p[3]==='roles'){
          if(p.length===4&&method==='GET')result=await tenantPermissions.roles(s,tenantId,req.query);
          else if(p.length===4&&method==='POST')result=await tenantPermissions.saveRole(s,tenantId,null,req.body);
          else if(p.length===5&&method==='PUT')result=await tenantPermissions.saveRole(s,tenantId,id,req.body);
          else if(p.length===5&&method==='DELETE')result=await tenantPermissions.removeRole(s,tenantId,id,req.body);
          else fail('NOT_FOUND','接口不存在',404);
        }else{
          if(p.length===5&&id==='roles'&&method==='GET')result=await tenantPermissions.roles(s,tenantId,req.query,true);
          else if(p.length===4&&method==='GET')result=await tenantPermissions.members(s,tenantId,req.query);
          else if(p.length===4&&method==='POST')result=await tenantPermissions.createMember(s,tenantId,req.body);
          else if(p.length===5&&['PUT','DELETE'].includes(method))result=await tenantPermissions.changeMember(s,tenantId,id,req.body,method==='DELETE'?'remove':'edit');
          else if(p.length===6&&p[5]==='password'&&method==='PUT')result=await tenantPermissions.changeMember(s,tenantId,id,req.body,'password');
          else fail('NOT_FOUND','接口不存在',404);
        }
      }
      else if(p[1]==='tenant-admins'&&p.length===2&&method==='GET'){adminAuth.authorize(s,'accounts.read');result=await tenants.accounts(s,req.query);}
      else if(p[1]==='tenant-admins'&&p.length===2&&method==='POST'){adminAuth.authorize(s,'accounts.write');result=await tenants.createAccount(s,req.body);}
      else if(p[1]==='tenant-admins'&&p.length===3&&method==='PUT'){adminAuth.authorize(s,'accounts.write');result=await tenants.editAccount(s,p[2],req.body);}
      else if(p[1]==='tenant-admins'&&p.length===3&&method==='DELETE'){adminAuth.authorize(s,'accounts.write');result=await tenants.deleteAccount(s,p[2],req.body);}
      else if(p[1]==='tenant-admins'&&p.length===4&&p[3]==='password'&&method==='PUT'){adminAuth.authorize(s,'accounts.write');result=await tenants.editAccount(s,p[2],req.body,true);}
      else if(p[1]==='tenants'&&p[3]==='overview'&&p.length===4&&method==='GET')result=await tenantOverview.view(s,p[2]);
      else if(p[1]==='tenants'&&p[3]==='after-sales'){
        if(p.length===4&&method==='GET')result=await afterSales.list(s,p[2],req.query);
        else if(p.length===6&&method==='GET')result=await afterSales.detail(s,p[2],p[4],p[5]);
        else if(p.length===7&&p[6]==='review'&&method==='POST')result=await afterSales.review(s,p[2],p[4],p[5],req.body);
        else if(p.length===7&&p[6]==='retry'&&method==='POST')result=await afterSales.retry(s,p[2],p[4],p[5],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='applications'&&p.length===4&&method==='GET')result=await tenantApplications.list(s,p[2]);
      else if(p[1]==='tenants'&&p[3]==='applications'&&p.length===5&&method==='PUT')result=await tenantApplications.configure(s,p[2],p[4],req.body);
      else if(p[1]==='tenants'&&p[3]==='policies'){
        if(p.length===4&&method==='GET')result=req.query.kind?await tenantPolicies.view(s,p[2],req.query):await tenantPolicies.list(s,p[2],req.query);
        else if(p.length===6&&method==='PUT')result=await tenantPolicies.save(s,p[2],p[4],p[5],req.body);
        else if(p.length===7&&p[6]==='preview'&&method==='POST')result=await tenantPolicies.preview(s,p[2],p[4],p[5],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='help'){
        if(p.length===4&&method==='GET')result=await helpCenter.list(s,p[2],req.query);
        else if(p.length===7&&p[5]==='articles'&&method==='GET')result=await helpCenter.detail(s,p[2],p[4],p[6]);
        else if(p.length===7&&method==='PUT')result=await helpCenter.save(s,p[2],p[4],p[5],p[6],req.body);
        else if(p.length===7&&method==='DELETE')result=await helpCenter.remove(s,p[2],p[4],p[5],p[6],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='official-account'){
        if(p.length===4&&method==='GET')result=await tenantOfficialAccounts.view(s,p[2],req.query);
        else if(p.length===5&&method==='PUT')result=await tenantOfficialAccounts.save(s,p[2],p[4],req.body);
        else if(p.length===6&&p[5]==='publish-menu'&&method==='POST')result=await tenantOfficialAccounts.publishMenu(s,p[2],p[4],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='mini-program'){
        if(p.length===6&&p[5]==='ads'&&method==='GET')result=await tenantMiniAds.view(s,p[2],p[4]);
        else if(p.length===6&&p[5]==='ads'&&method==='PUT')result=await tenantMiniAds.save(s,p[2],p[4],req.body);
        else if(p.length===4&&method==='GET')result=await tenantMiniPrograms.view(s,p[2],req.query);
        else if(p.length===5&&method==='PUT')result=await tenantMiniPrograms.save(s,p[2],p[4],req.body);
        else if(p.length===6&&p[5]==='check'&&method==='POST')result=await tenantMiniPrograms.check(s,p[2],p[4],req.body);
        else if(p.length===6&&p[5]==='upload-catalog'&&method==='GET')result=await tenantMiniUpload.catalog(s,p[2],p[4]);
        else if(p.length===6&&p[5]==='upload-tasks'&&method==='GET')result=await tenantMiniUpload.history(s,p[2],p[4],req.query);
        else if(p.length===7&&p[5]==='upload-tasks'&&method==='GET')result=await tenantMiniUpload.detail(s,p[2],p[4],p[6]);
        else if(p.length===6&&p[5]==='upload-tasks'&&method==='POST')result=await tenantMiniUpload.create(s,p[2],p[4],req.body);
        else if(p.length===6&&p[5]==='upload-tasks'&&method==='DELETE')result=await tenantMiniUpload.remove(s,p[2],p[4],req.body);
        else if(p.length===8&&p[5]==='upload-tasks'&&p[7]==='refresh'&&method==='POST')result=await tenantMiniUpload.refresh(s,p[2],p[4],p[6]);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='page-sharing'){
        if(p.length===6&&method==='GET')result=await tenantPageSharing.view(s,p[2],p[4],p[5]);
        else if(p.length===7&&method==='PUT')result=await tenantPageSharing.save(s,p[2],p[4],p[5],p[6],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='page-routes'&&p.length===4&&method==='GET')result=await tenantDecoration.routes(s,p[2],req.query);
      else if(p[1]==='tenants'&&p[3]==='decoration'){
        if(p.length===4&&method==='GET')result=await tenantDecoration.view(s,p[2],req.query);
        else if(p.length===6&&p[5]==='preview'&&method==='POST')result=await decorationPreviews.create(s,p[2],p[4],req.body,req.headers.origin);
        else if(p.length===5&&method==='PUT')result=await tenantDecoration.mutate(s,p[2],p[4],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='consumer-settings'){
        if(p.length===4&&method==='GET')result=await tenantConsumerSettings.view(s,p[2],req.query);
        else if(p.length===6&&method==='PUT')result=await tenantConsumerSettings.save(s,p[2],p[4],p[5],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='site-settings'&&p.length===4){
        if(method==='GET')result=await tenantSiteSettings.view(s,p[2]);
        else if(method==='PUT')result=await tenantSiteSettings.save(s,p[2],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='branding'&&p.length===4&&method==='GET')result=await tenantSiteSettings.brand(s,p[2]);
      else if(p[1]==='tenants'&&p[3]==='subscription-settings'){
        if(p.length===4&&method==='GET')result=await tenantSubscriptions.view(s,p[2],req.query);
        else if(p.length===6&&p[5]==='select'&&method==='POST')result=await tenantSubscriptions.select(s,p[2],p[4],req.body);
        else if(p.length===6&&p[5]==='logs'&&method==='GET')result=await tenantSubscriptions.logs(s,p[2],p[4],req.query);
        else if(p.length===6&&method==='PUT')result=await tenantSubscriptions.save(s,p[2],p[4],p[5],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='sms-settings'){
        if(p.length===4&&method==='GET')result=await tenantSms.view(s,p[2],req.query);
        else if(p.length===7&&p[5]==='notifications'&&method==='PUT')result=await tenantSms.saveNotification(s,p[2],p[4],p[6],req.body);
        else if(p.length===6&&method==='PUT')result=await tenantSms.save(s,p[2],p[4],p[5],req.body);
        else if(p.length===6&&p[5]==='logs'&&method==='GET')result=await tenantSms.logs(s,p[2],p[4],req.query);
        else if(p.length===7&&p[6]==='check'&&method==='POST')result=await tenantSms.check(s,p[2],p[4],p[5],req.body);
        else if(p.length===7&&p[6]==='test'&&method==='POST')result=await tenantSms.sendTest(s,p[2],p[4],p[5],req.body,req.ip||req.socket.remoteAddress||'local');
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='payment-settings'){
        if(p.length===4&&method==='GET')result=await tenantPayments.view(s,p[2],req.query);
        else if(p.length===6&&method==='PUT')result=await tenantPayments.save(s,p[2],p[4],p[5],req.body);
        else if(p.length===7&&p[6]==='check'&&method==='POST')result=await tenantPayments.check(s,p[2],p[4],p[5],req.body);
        else if(p[5]==='wechat-virtual'&&p[6]==='goods'&&p.length===7&&method==='GET')result=await virtualGoods.view(s,p[2],p[4]);
        else if(p[5]==='wechat-virtual'&&p[6]==='goods'&&p.length===8&&method==='PUT')result=await virtualGoods.save(s,p[2],p[4],p[7],req.body);
        else if(p[5]==='wechat-virtual'&&p[6]==='goods'&&p.length===7&&method==='POST')result=await virtualGoods.start(s,p[2],p[4],req.body);
        else if(p[5]==='wechat-virtual'&&p[6]==='goods'&&p[7]==='advance'&&p.length===8&&method==='POST')result=await virtualGoods.advance(s,p[2],p[4],req.body);
        else if(p[5]==='wechat-virtual'&&p[6]==='orders'&&p.length===7&&method==='GET')result=await payments.virtual.adminOrders(s,p[2],p[4],req.query);
        else if(p[5]==='wechat-virtual'&&p[6]==='orders'&&p.length===8&&method==='GET')result=await payments.virtual.adminOrders(s,p[2],p[4],req.query,p[7]);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='payment-methods'){
        if(p.length===4&&method==='GET')result=await paymentClientPolicy.list(s,p[2],req.query);
        else if(p.length===5&&method==='PUT')result=await paymentClientPolicy.save(s,p[2],p[4],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='recharge'&&(p.length===5||p.length===4)){
        if(method==='GET')result=await recharge.config(s,p[2],p[4]);
        else if(method==='PUT')result=await recharge.saveConfig(s,p[2],p[4],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='recharge-orders'&&(p.length===5||p.length===4)&&method==='GET')result=await recharge.adminOrders(s,p[2],p[4],req.query);
      else if(p[1]==='tenants'&&p[3]==='recharge-orders'&&p.length===7&&p[6]==='refund'&&method==='POST')result=await payments.requestRefund(s,p[2],p[4],p[5],req.body);
      else if(p[1]==='tenants'&&['points-ledger','entitlements','entitlement-ledger','transactions'].includes(p[3])){
        const records=p[3]==='points-ledger'?pointsLedger:p[3]==='entitlements'?tenantEntitlements:p[3]==='entitlement-ledger'?tenantEntitlementLedger:tenantTransactions;
        if(p[3]==='entitlements'&&p.length===6&&p[5]==='grant'&&method==='POST')result=await standaloneBenefits.change(s,p[2],p[4],null,req.body);
        else if(p[3]==='entitlements'&&p.length===7&&p[6]==='redeem'&&method==='POST')result=await standaloneBenefits.change(s,p[2],p[4],p[5],req.body);
        else if(p.length===4&&method==='GET')result=await records.list(s,p[2],req.query);
        else if(p.length===6&&method==='GET')result=await records.detail(s,p[2],p[4],p[5],req.query);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='packages'){
        if(p.length===4&&method==='GET')result=await tenantPackages.list(s,p[2],req.query);
        else if(p.length===5&&method==='POST')result=await tenantPackages.save(s,p[2],p[4],null,req.body);
        else if(p.length===6&&p[5]==='delete'&&method==='POST')result=await tenantPackages.remove(s,p[2],p[4],req.body);
        else if(p.length===6&&method==='PUT')result=await tenantPackages.save(s,p[2],p[4],p[5],req.body);
        else if(p.length===7&&p[6]==='status'&&method==='PUT')result=await tenantPackages.setEnabled(s,p[2],p[4],p[5],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&['member-levels','member-tags'].includes(p[3])){
        const kind=p[3]==='member-levels'?'levels':'tags';
        if(p.length===4&&method==='GET')result=await memberManagement.list(s,p[2],kind,req.query);
        else if(p.length===6&&p[5]==='delete'&&method==='POST')result=await memberManagement.remove(s,p[2],p[4],kind,req.body);
        else if(p.length===6&&p[5]==='rules'&&kind==='levels'&&method==='PUT')result=await memberManagement.saveRule(s,p[2],p[4],req.body);
        else if(p.length===6&&method==='PUT')result=await memberManagement.save(s,p[2],p[4],kind,p[5],req.body);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='channels'&&p.length===4&&method==='GET')result=await tenantH5.channels(s,p[2],req.query);
      else if(p[1]==='tenants'&&p[3]==='h5'){
        if(p.length===4&&method==='GET')result=await tenantH5.view(s,p[2],req.query);
        else if(p.length===5&&method==='PUT')result=await tenantH5.save(s,p[2],p[4],req.body);
        else if(p.length===6&&p[5]==='verify-domain'&&method==='POST')result=await tenantH5.checkDomain(s,p[2],p[4]);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='consumers'){
        if(p.length===4&&method==='GET')result=await tenantConsumers.list(s,p[2],req.query);
        else if(p.length===4&&method==='POST')result=await tenantConsumers.create(s,p[2],req.body);
        else if(p.length===5&&p[4]==='delete'&&method==='POST')result=await tenantConsumers.remove(s,p[2],req.body);
        else if(p.length===7&&p[6]==='membership'&&method==='GET')result=await memberManagement.view(s,p[2],p[4],p[5],req.query);
        else if(p.length===7&&p[6]==='membership'&&method==='POST')result=await memberManagement.change(s,p[2],p[4],p[5],req.body);
        else if(p.length===7&&p[6]==='assets'&&method==='GET')result=await consumerAssets.view(s,p[2],p[4],p[5]);
        else if(p.length===7&&p[6]==='assets'&&method==='POST')result=await consumerAssets.change(s,p[2],p[4],p[5],req.body);
        else if(p.length===7&&p[6]==='wallet'&&method==='GET')result=await recharge.adminAssets(s,p[2],p[4],p[5]);
        else if(p.length===7&&p[6]==='wallet'&&method==='POST')result=await recharge.adminAssets(s,p[2],p[4],p[5],req.body);
        else if(p.length===9&&p[6]==='wallet'&&p[8]==='records'&&method==='GET')result=await recharge.adminRecords(s,p[2],p[4],p[5],p[7],req.query);
        else if(p.length===6&&method==='PUT')result=await tenantConsumers.update(s,p[2],p[4],p[5],req.body);
        else if(p.length===6&&method==='GET')result=await tenantConsumers.detail(s,p[2],p[4],p[5]);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[1]==='tenants'&&p[3]==='apps'&&p.length===6){
        const app=application(p[4]);
        if(p[5]==='config'&&method==='GET')result=await tenantApplications.config(s,p[2],app.key);
        else if(p[5]==='config'&&method==='PUT')result=await tenantApplications.updateConfig(s,p[2],app.key,req.body);
        else result=await applicationRuntime(app.key).admin(s,p,method,req);
      }
      else if(p[1]==='tenants'&&p[3]==='apps')result=await applicationRuntime(p[4]).admin(s,p,method,req);
      // The legacy URL owner is declared by the bundled application, never inferred by the host.
      else if(p[1]==='tenants'&&['config','records'].includes(p[3]))result=await applicationRuntime().admin(s,p,method,req);
      else fail('NOT_FOUND','接口不存在',404);
      if(p[1]==='environment')return res.json({data:result,dataMode:'live-runtime',integrationMode:'local-live'});
      if(p[1]==='materials')return res.json({data:result,dataMode:'mysql',integrationMode:'configured-storage'});
      if(['system-cache','scheduled-tasks'].includes(p[1]))return res.json({data:result,dataMode:p[1]==='system-cache'?'redis':'mysql',integrationMode:'local-live'});
      if(p[1]==='backups')return res.json({data:result,dataMode:'encrypted-archive',integrationMode:'local-live'});
      return res.json({data:result,dataMode:'mysql',integrationMode:process.env.NODE_ENV==='development'?'development-mock':'production'});
    }
    if(p[0]==='payments'&&p[1]==='wechat'&&p.length===4&&['notify','refund-notify'].includes(p[3])&&method==='POST'){
      const ack=await payments.accept(p[2],p[3]==='notify'?'payment':'refund',req.body,{get:(name:string)=>{const value=req.headers[name.toLowerCase()];return typeof value==='string'?value:null}});
      res.setHeader('Cache-Control','no-store');if(ack.type)res.type(ack.type);return res.status(ack.status).send(ack.body);
    }
    if(p[0]==='payments'&&p[1]==='alipay'&&p.length===4&&p[3]==='notify'&&method==='POST'){
      const ack=await payments.alipay.accept(p[2],req.body);res.setHeader('Cache-Control','no-store');return res.type(ack.type).status(ack.status).send(ack.body);
    }
    if(p[0]==='payments'&&p[1]==='wechat-virtual'&&p.length===5&&p[4]==='notify'&&['GET','POST'].includes(method)){
      const ack=await payments.virtual.callback(p[2],p[3],req.query,method==='POST'?req.body:undefined);res.setHeader('Cache-Control','no-store');return res.type(ack.type).send(ack.body);
    }
    licenseRuntime.assertAllowed();
    if(req.path==='/api/v1/consumer/auth/settings'&&method==='GET'){licenseRuntime.assertAllowed();res.setHeader('Cache-Control','no-store');return res.json({data:await consumerAuth.settings(scopedInput(company,req.query))})}
    if(req.path==='/api/v1/consumer/auth/login'&&method==='POST'){res.setHeader('Cache-Control','no-store, private');return res.json({data:await consumerAuth.login(scopedInput(company,req.body),req.ip||req.socket.remoteAddress||'local')})}
    if(p[0]==='consumer'&&p[1]==='auth'&&p[2]==='official'){
      res.set({'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'});
      if(p[3]==='start'&&p.length===4&&['GET','POST'].includes(method)){const flow=await officialConsumerAuth.start(scopedInput(company,method==='POST'?req.body:req.query),req.ip||req.socket.remoteAddress||'local');res.setHeader('Set-Cookie',flow.cookie);return method==='POST'?res.json({data:{url:flow.url}}):res.redirect(302,flow.url)}
      if(p[3]==='callback'&&p.length===4&&method==='GET'){const flow=await officialConsumerAuth.callback(req.query,req.headers.cookie);return res.redirect(302,flow.url)}
      if(p[3]==='exchange'&&p.length===4&&method==='POST'){const flow=await officialConsumerAuth.exchange(req.body,req.headers.cookie);res.setHeader('Set-Cookie',flow.cookie);return res.json({data:flow.data})}
      fail('NOT_FOUND','接口不存在',404);
    }
    if(p[0]==='consumer'&&p[1]==='auth'&&p[2]==='sms'&&p.length===4&&method==='POST'){res.setHeader('Cache-Control','no-store, private');if(p[3]==='send')return res.json({data:await consumerSmsAuth.send(scopedInput(company,req.body),req.ip||req.socket.remoteAddress||'local')});if(p[3]==='login')return res.json({data:await consumerSmsAuth.login(scopedInput(company,req.body))});if(p[3]==='reset')return res.json({data:await consumerSmsAuth.reset(scopedInput(company,req.body))});fail('NOT_FOUND','接口不存在',404);}
    if(req.path==='/api/v1/consumer/auth/register'&&method==='POST'){res.setHeader('Cache-Control','no-store, private');return res.json({data:await consumerAuth.register(scopedInput(company,req.body),req.ip||req.socket.remoteAddress||'local')})}
    if(req.path==='/api/v1/consumer/auth/wechat/settings'&&method==='GET'){res.setHeader('Cache-Control','no-store, private');return res.json({data:await tenantMiniPrograms.publicView(scopedInput(company,req.query))})}
    if(req.path==='/api/v1/consumer/auth/wechat/login'&&method==='POST'){res.setHeader('Cache-Control','no-store, private');return res.json({data:await wechatConsumerAuth.login(scopedInput(company,req.body),req.ip||req.socket.remoteAddress||'local')})}
    const applicationKey=p[0]==='apps'?p[1]:undefined;
    if(applicationKey)application(applicationKey);
    if(p[0]==='apps')p.splice(0,2);
    const routeOwner=appRuntimes.find(app=>applicationKey?app.key===applicationKey:app.legacyRoutes);
    if(!['session','phone','password','official-account','member-levels','growth-records','wallet','recharge','profile','subscriptions','sharing','decoration','orders'].includes(p[0])&&!routeOwner?.consumerPaths.includes(p[0]))fail('NOT_FOUND','接口不存在',404);
    if(p[0]==='dev'&&p[1]==='session'&&method==='POST') result=await applicationRuntime(applicationKey).devSession(req.body||{});
    else {
      const s=await consumerSessions.read(req.headers.authorization?.replace(/^Bearer /,''),applicationKey);
      if(s.tenantId!==company)fail('ENTERPRISE_SCOPE_MISMATCH','会话不属于当前站点',403);
      if(p[0]==='session'&&method==='DELETE'){await db.session.delete({where:{token:s.token}});result={loggedOut:true};}
      else if(p[0]==='phone'&&p.length===1&&method==='GET')result=await consumerSmsAuth.binding(s);
      else if(p[0]==='phone'&&p[1]==='send'&&method==='POST')result=await consumerSmsAuth.send({...req.body,tenantId:s.tenantId,applicationKey:s.applicationKey,purpose:'bind'},req.ip||'local',s);
      else if(p[0]==='phone'&&p.length===1&&method==='PUT')result=await consumerSmsAuth.bindPhone(s,req.body);
      else if(p[0]==='phone'&&p[1]==='wechat'&&p.length===2&&method==='PUT'){res.setHeader('Cache-Control','no-store, private');result=await wechatConsumerAuth.bindPhone(s,req.body,consumerSmsAuth);}
      else if(p[0]==='password'&&p.length===1&&method==='PUT')result=await consumerAuth.changePassword(s,req.body);
      else if(p[0]==='official-account'&&p[1]==='connect'&&p.length===2&&method==='POST'){const flow=await officialConsumerAuth.start({...req.body,tenantId:s.tenantId,applicationKey:s.applicationKey},req.ip||'local',s);res.setHeader('Set-Cookie',flow.cookie);result={url:flow.url};}
      else if(p[0]==='member-levels'&&p.length===1&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await consumerMemberLevels.view(s,req.query);}
      else if(p[0]==='growth-records'&&p.length===1&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await consumerGrowthRecords.list(s,req.query);}
      else if(p[0]==='growth-records'&&p.length===2&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await consumerGrowthRecords.detail(s,p[1],req.query);}
      else if(p[0]==='wallet'&&p.length===1&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await recharge.wallet.read(s);}
      else if(p[0]==='wallet'&&p.length===3&&p[2]==='records'&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await recharge.wallet.consumerRecords(s,p[1],req.query);}
      else if(p[0]==='wallet'&&p.length===4&&p[2]==='records'&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await recharge.wallet.consumerRecord(s,p[1],p[3]);}
      else if(p[0]==='recharge'&&p[1]==='catalog'&&p.length===2&&method==='GET')result=await recharge.catalog(s);
      else if(p[0]==='recharge'&&p[1]==='orders'){
        res.setHeader('Cache-Control','no-store, private');
        if(p.length===2&&method==='POST')result=await recharge.create(s,req.body);
        else if(p.length===2&&method==='GET')result=await recharge.consumerOrders(s,req.query);
        else if(p.length===4&&p[2]==='by-request'&&method==='GET')result=await recharge.byRequest(s,p[3]);
        else if(p.length===3&&method==='GET')result=await recharge.detail(s,p[2]);
        else if(p.length===4&&p[3]==='methods'&&method==='GET')result=await recharge.methods(s,p[2],req.query);
        else if(p.length===4&&p[3]==='cancel'&&method==='POST')result=await recharge.cancel(s,p[2]);
        else fail('NOT_FOUND','接口不存在',404);
      }
      else if(p[0]==='profile'&&p.length===1&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await consumerProfiles.view(s);}
      else if(p[0]==='profile'&&p.length===1&&method==='PUT'){res.setHeader('Cache-Control','no-store, private');result=await consumerProfiles.save(s,req.body);}
      else if(p[0]==='subscriptions'&&p.length===2&&method==='GET')result=await tenantSubscriptions.options(s,p[1]);
      else if(p[0]==='subscriptions'&&p.length===2&&method==='POST')result=await tenantSubscriptions.consent(s,p[1],req.body);
      else if(p[0]==='sharing'&&p.length===2&&method==='GET'){res.setHeader('Cache-Control','no-store');result=await tenantPageSharing.publicView(s.tenantId,s.applicationKey,p[1],'mini');}
      else if(p[0]==='decoration'&&p.length===1&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await tenantDecoration.published(s);}
      else if(p[0]==='decoration'&&p.length===3&&p[1]==='images'&&method==='GET'){
        return sendMaterialFile(req,res,await tenantDecoration.image(s,p[2]));
      }
      else if(p[0]==='orders'&&p.length===3&&p[2]==='pay'&&method==='POST')result=await payments.pay(s,p[1],req.body,{ip:req.ip||req.socket.remoteAddress,origin:req.headers.origin,userAgent:req.headers['user-agent']});
      else if(p[0]==='orders'&&p.length===3&&p[2]==='methods'&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await payments.methods(s,p[1],req.query);}
      else if(p[0]==='orders'&&p.length===3&&p[2]==='payment'&&method==='GET')result=await payments.status(s,p[1]);
      else if(p[0]==='orders'&&p.length===4&&p[2]==='payment'&&p[3]==='switch'&&method==='POST')result=await payments.switchPayment(s,p[1],req.body,{origin:req.headers.origin,ip:req.ip,userAgent:req.headers['user-agent']});
      else if(p[0]==='orders'&&p.length===3&&p[2]==='reconcile'&&method==='POST')result=await payments.status(s,p[1],true);
      else if(p[0]==='orders'&&p[2]==='cancel'&&method==='POST')result=await db.rechargeOrder.count({where:{id:p[1],tenantId:s.tenantId,applicationKey:s.applicationKey}})?await recharge.cancel(s,p[1]):await applicationRuntime(s.applicationKey).consumer(s,p,method,req,res);
      else if(p[0]==='orders'&&p.length===1&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await afterSales.consumerOrders(s,req.query);}
      else if(p[0]==='orders'&&p.length===2&&method==='DELETE')result=await afterSales.removeOrder(s,p[1]);
      else if(p[0]==='orders'&&p.length===3&&p[2]==='after-sales'&&method==='POST')result=await afterSales.apply(s,p[1],req.body);
      else if(p[0]==='orders'&&p.length===3&&p[2]==='after-sales'&&method==='GET'){res.setHeader('Cache-Control','no-store, private');result=await afterSales.consumerHistory(s,p[1]);}
      else if(p[0]==='orders'&&p.length===2&&method==='GET')result=await db.rechargeOrder.count({where:{id:p[1],tenantId:s.tenantId,applicationKey:s.applicationKey}})?await recharge.detail(s,p[1]):await applicationRuntime(s.applicationKey).consumer(s,p,method,req,res);
      else result=await applicationRuntime(s.applicationKey).consumer(s,p,method,req,res);
    }
    if(res.headersSent)return;
    return res.json(['wallet','recharge','orders'].includes(p[0])?{data:result}:{data:result,mock:process.env.NODE_ENV==='development'});
    }finally{inFlight--}
  }
}
const frameworkVersion=JSON.parse(readFileSync(new URL('../../../package.json',import.meta.url),'utf8')).version;
const licenseRuntime=LicenseRuntime.forStandalone(frameworkVersion,loadedComponents());
const resources=new PlatformResources({db:createApplicationDatabase(applicationDatabaseModels)});
const {db,storage}=resources;
const updates=new UpdateService(licenseRuntime,undefined,loadedComponents(),async keys=>{
  const rows=await db.tenantApplication.groupBy({by:['applicationKey'],where:{applicationKey:{in:keys},activeSlot:1},_count:{_all:true}});
  return Object.fromEntries(keys.map(key=>[key,rows.find(row=>row.applicationKey===key)?._count._all??0]));
});
bindApplicationLicensing(db,{allowed:(key:string)=>licenseRuntime.componentAllowed(application(key).licensePackageKey),assert:(key:string)=>licenseRuntime.assertComponentAllowed(application(key).licensePackageKey),limit:(key:string)=>{
  const packageKey=application(key).licensePackageKey;licenseRuntime.assertComponentAllowed(packageKey);
  return licenseRuntime.client.componentStatus(packageKey,'app').receipt?.entitlements.find(e=>e.packageKey===packageKey&&e.type==='app')?.tenantLimit;
}});
const appRuntimes:any[]=await createApplicationRuntimes({db,storage,pluginAllowed:(packageKey:string)=>licenseRuntime.componentAllowed(packageKey,'plugin')});
function applicationRuntime(key?:string):any{const runtime=key?appRuntimes.find(app=>app.key===key):appRuntimes.find(app=>app.legacyRoutes);if(!runtime)fail('NOT_FOUND','应用入口不可用',404);return runtime}
const platformOverview=new PlatformOverview(db);
const tenantApplications=new TenantApplications(db);
const tenantOverview=new TenantOverview(db);
const siteSettings=new SiteSettings(db,storage);
const tenantSiteSettings=new TenantSiteSettings(db,storage);
const tenantDecoration=new TenantDecoration(db,storage);
const tenantPageSharing=new TenantPageSharing(db,storage);
const decorationPreviews=new DecorationPreviews(db,storage);
const tenantConsumerSettings=new TenantConsumerSettings(db,storage);
const redisClient=new Redis.default(process.env.REDIS_URL!,{connectTimeout:3000,maxRetriesPerRequest:1,lazyConnect:true});
redisClient.on('error',()=>{});
const adminAuth=new AdminAuth(db,redisClient,{storage});
const roles=new RoleManagement(db);
const tenantPermissions=new TenantPermissions(db,()=>adminAuth.csrfKey);
const systemLogs=new SystemLogs(db);
const environment=new SystemEnvironment(db,redisClient,storage,()=>licenseRuntime.frameworkVersion);
const systemCache=new SystemCache(db,redisClient);
const scheduledTasks=new ScheduledTasks(db,systemCache,undefined,{enterpriseScope:()=>enterpriseId(db)});
const materials=new Materials(db,storage);
const tenantMaterials=new TenantMaterials(db,storage);
const tenantConsumers=new TenantConsumers(db,storage);
const memberManagement=new MemberManagement(db);
const tenantH5=new TenantH5(db,storage);
const consumerAssets=new ConsumerAssets(db);
const tenantPackages=new TenantPackages(db,storage);
const standaloneBenefits=new StandaloneBenefits(db);
const tenantPayments=new TenantPayments(db,storage.secrets);
const tenantSms=new TenantSms(db,redisClient,storage.secrets);
const recharge=new Recharge(db,{storage});
const paymentClientPolicy=new PaymentClientPolicy(db);
const payments=new PaymentExecution(db,tenantPayments,{[frameworkKey]:rechargePayments(recharge,frameworkKey,{orders:(tx:any,s:any,q:any)=>recharge.list(tx,s,q),lock:async()=>fail('NOT_FOUND','订单不存在',404)}),...Object.fromEntries(appRuntimes.filter(app=>app.key!==frameworkKey).map(app=>[app.key,rechargePayments(recharge,app.key,app.paymentAdapter)]))},{h5:tenantH5});
recharge.payments=payments;
const afterSales=new AfterSales(db,payments);
const tenantMiniPrograms=new TenantMiniPrograms(db,storage.secrets);
const tenantMiniAds=new TenantMiniAds(db);
const tenantPolicies=new TenantPolicies(db);
const helpCenter=new HelpCenter(db);
const tenantOfficialAccounts=new TenantOfficialAccounts(db,storage.secrets,{storage});
tenantH5.officialSettings=tenantOfficialAccounts;
const tenantSubscriptions=new TenantSubscriptions(db,tenantMiniPrograms);
for(const app of appRuntimes)await app.connect({payments,subscriptions:tenantSubscriptions});
const virtualGoods=new TenantVirtualGoods(db,tenantPayments,tenantMiniPrograms,{storage});
const tenantMiniUpload=new TenantMiniUpload(db,tenantMiniPrograms,licenseRuntime.licensedClient);
const wechatConsumerAuth=new WechatConsumerAuth(db,redisClient,tenantMiniPrograms);
const pointsLedger=new TenantRecords(db,'pointsLedger','entitlements.read');
const tenantEntitlements=new TenantRecords(db,'entitlements','entitlements.read');
const tenantEntitlementLedger=new TenantRecords(db,'entitlementLedger','entitlements.read');
const tenantTransactions=new TenantRecords(db,'transactions','orders.read');
const consumerAuth=new ConsumerAuth(db,redisClient,{phoneDigest:(tenantId,key,phone)=>tenantSms.digest(tenantId,key,phone)});
const consumerSmsAuth=new ConsumerSmsAuth(db,redisClient,tenantSms);
const officialConsumerAuth=new OfficialConsumerAuth(db,redisClient,tenantOfficialAccounts,tenantH5);
const consumerProfiles=new ConsumerProfiles(db,storage);
const consumerSessions=new ConsumerSessions(db);
const consumerMemberLevels=new ConsumerMemberLevels(db);
const consumerGrowthRecords=new ConsumerGrowthRecords(db);
const backups=new BackupService(db,()=>licenseRuntime.frameworkVersion);
let inFlight=0,workerBusy=false,draining=false;
const restoration=new Restoration(backups,{brand:()=>siteSettings.publicView(),pause:async()=>{const deadline=Date.now()+30000;while(inFlight||workerBusy||storage.sweeping||scheduledTasks.busy||payments.busy||tenantSms.busy||tenantSubscriptions.busy||tenantSubscriptions.selecting||tenantOfficialAccounts.busy){if(Date.now()>deadline)throw Error('BACKUP_DRAIN_TIMEOUT');await new Promise(r=>setTimeout(r,25))}}});
backups.restoration=restoration;
const platformAdmins=new PlatformAdmins(db,()=>{if(!adminAuth.csrfKey)throw Error('AUTH_NOT_READY');return adminAuth.csrfKey},storage);
const tenants=new TenantManagement(db,()=>{if(!adminAuth.csrfKey)throw Error('AUTH_NOT_READY');return adminAuth.csrfKey},storage);
let materialUploads=0;
function materialBody(purpose?:string,tenantScope=false){return async(req:Request,res:Response,next:NextFunction)=>{
  if(req.method!=='POST')return next();
  const reject=(e:unknown)=>{const tooLarge=(e as {type?:string})?.type==='entity.too.large';res.setHeader('Cache-Control','no-store, private');res.status(tooLarge?413:e instanceof Fault?e.status:400).json({error:{code:tooLarge?'MATERIAL_SIZE_INVALID':e instanceof Fault?e.code:'MATERIAL_UPLOAD_INVALID',message:tooLarge?'文件超过当前默认存储的大小限制':e instanceof Fault?e.message:'上传请求无效',requestId:randomUUID()}})};
  try{
    if(restoration.active||nativeMaintenance())fail('DATABASE_MAINTENANCE','系统正在维护，请稍后上传',503);
    const s=await adminAuth.session(req.headers.cookie,'tenant');
    assertEnterpriseSession(enterpriseId(db),s);
    adminAuth.assertWrite(s,req.headers['x-csrf-token'],req.headers.origin);licenseRuntime.assertAllowed();
    let policy;
    if(tenantScope){const tenant=await tenantMaterials.authorize(s,String(req.params.tenantId),String(req.params.scopeKey),true);policy=await tenantMaterials.policy(tenant,true)}
    else{materials.allow(s,purpose||String(req.query.purpose||'library'),true);policy=await storage.publicPolicy()}

    if(materialUploads>=2)fail('MATERIAL_UPLOAD_BUSY','已有文件正在上传，请稍后重试',429);
    materialUploads++;let released=false;const release=()=>{if(!released){released=true;materialUploads--}};res.once('finish',release);res.once('close',release);
    express.raw({type:['application/octet-stream','image/png','image/jpeg','image/webp'],limit:Math.min(100,policy.maxFileMb)*1024*1024})(req,res,error=>{if(error){release();reject(error)}else next()});
  }catch(e){reject(e)}
}}
function sendMaterialFile(req:Request,res:Response,file:{redirect?:string;data?:Buffer;stream?:Readable;length?:number;range?:{start:number;end:number;total:number}|null;mime:string;name:string;inline:boolean}){
  if(file.redirect){res.setHeader('Cache-Control','no-store');return res.redirect(302,file.redirect)}
  res.set({'Content-Type':file.mime,'X-Content-Type-Options':'nosniff','Content-Disposition':`${file.inline?'inline':'attachment'}; filename="material"; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Accept-Ranges':'bytes'});
        if(!file.inline)res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
        if(file.stream){
          if(file.stream.errored)throw file.stream.errored;
          res.setHeader('Content-Length',String(file.length));if(file.range){res.status(206);res.setHeader('Content-Range',`bytes ${file.range.start}-${file.range.end}/${file.range.total}`)}
          pipeline(file.stream,res,error=>{if(error&&error.code!=='ERR_STREAM_PREMATURE_CLOSE')logFailure(error,{requestId:res.locals.requestId,operation:'material.stream'})});return;
        }
        if(!file.data)throw Error('MATERIAL_CONTENT_MISSING');
        if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range),size=file.data.length;let start=match?.[1]?Number(match[1]):0,end=match?.[2]?Number(match[2]):size-1;if(match&&!match[1]&&match[2]){start=Math.max(0,size-Number(match[2]));end=size-1}if(!match||!match[1]&&!match[2]||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.setHeader('Content-Range',`bytes */${size}`);return res.status(416).end()}end=Math.min(end,size-1);res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);return res.status(206).send(file.data.subarray(start,end+1));}
        return res.send(file.data);
}
@Module({controllers:[Api]})
class App {}
async function main() {
  const host=process.env.API_HOST||'127.0.0.1';
  if(host!=='127.0.0.1')throw new Error('企业 API 应监听回环地址并由站点网关提供服务');
  backups.init();
  const recoveryBlocked=restoration.bootGuard();
  if(recoveryBlocked)throw Error('STANDALONE_RECOVERY_REQUIRED');
  if(!recoveryBlocked){
    // Refuse an unbound or multi-enterprise database before running startup writes.
    if(await db.tenant.count())await bindStandaloneEnterprise(db);
    else if(!developmentBootstrapAllowed()||await db.adminAccount.count()>1)throw Error('STANDALONE_INSTALLATION_REQUIRED');
    await resources.init();await siteSettings.init();
  }
  await redisClient.connect();await redisClient.ping();
  if(!recoveryBlocked){
  for(const application of appRuntimes)await application.initialize();
  await adminAuth.bootstrap();
  await bindStandaloneEnterprise(db);
  }
  if(!licenseRuntime.view().allowed)await licenseRuntime.check();
  const app=await NestFactory.create(App,{bodyParser:false,logger:['error','warn']});
  app.getHttpAdapter().getInstance().set('trust proxy','loopback');
  app.use(requestContext);
  // Evaluate paths and credential origins before accepting large bodies.
  app.use((req:Request,res:Response,next:NextFunction)=>{
    try {assertEnterpriseRequest(enterpriseId(db),req);next()}
    catch(error){const fault=error instanceof Fault?error:null;res.status(fault?.status??503).json({error:{code:fault?.code??'ENTERPRISE_NOT_READY',message:fault?.message??'实例暂未就绪'}})}
  });
  app.enableCors({origin:process.env.ADMIN_ORIGIN||'http://127.0.0.1:3500',credentials:true,methods:['GET','POST','PUT','DELETE'],allowedHeaders:['Content-Type','Authorization','X-Consent-Local','X-CSRF-Token','X-Console-Portal','X-Consent-External-Storage']});
  app.use((_req:Request,res:Response,next:NextFunction)=>{if(draining){res.setHeader('Connection','close');return res.status(503).json({error:{code:'RUNTIME_DRAINING',message:'服务正在重启，请稍后重试'}})}next()});
  app.use('/api/v1/admin/materials/upload',materialBody());
  app.use('/api/v1/admin/tenants/:tenantId/materials/:scopeKey/upload',materialBody(undefined,true));
  app.use('/api/v1/admin/site/assets',materialBody('site'));
  app.use('/api/v1/public/wechat-official',express.raw({type:()=>true,limit:'64kb'}));
  app.use('/api/v1/payments/wechat',express.raw({type:()=>true,limit:'256kb'}));
  app.use('/api/v1/payments/wechat-virtual',(req:Request,res:Response,next:NextFunction)=>express.raw({type:()=>true,limit:'64kb'})(req,res,error=>{
    if(error)return res.status(error.type==='entity.too.large'?413:400).json({error:{code:'VIRTUAL_NOTICE_INVALID',message:'消息格式或大小无效'}});next();
  }));
  app.use('/api/v1/payments/alipay',(req:Request,res:Response,next:NextFunction)=>express.raw({type:()=>true,limit:'256kb'})(req,res,error=>{
    if(error){res.setHeader('Cache-Control','no-store');return res.status(error.type==='entity.too.large'?413:400).json({error:{code:'PAYMENT_NOTICE_INVALID',message:'支付通知格式或大小无效',requestId:res.locals.requestId}})}next();
  }));
  app.use(express.raw({type:['application/octet-stream','image/png','image/jpeg','image/webp'],limit:'20mb'}));
  app.use('/api/v1/admin/tenants/:tenantId/official-account',express.json({limit:'512kb'}));
  app.use('/api/v1/admin/tenants/:tenantId/decoration',express.json({limit:'1mb'}));
  app.use('/api/v1/admin/tenants/:tenantId/policies',express.json({limit:'2mb'}));
  app.use('/api/v1/admin/tenants/:tenantId/help',express.json({limit:'2mb'}));
  app.use('/api/v1/admin/tenants/:tenantId/site-settings',express.json({limit:'400kb'}));
  app.use('/api/v1/admin/tenants/:tenantId/consumer-settings',express.json({limit:'256kb'}));
  app.use(express.json({limit:'128kb'}));
  app.useGlobalFilters(new Errors());
  await app.listen(Number(process.env.API_PORT||3501),host);
  licenseRuntime.start();
  const timer=appRuntimes.length?setInterval(async()=>{if(workerBusy||restoration.active||nativeMaintenance())return;workerBusy=true;try{for(const runtime of appRuntimes)await runtime.tick(runtime.key===frameworkKey||licenseRuntime.componentAllowed(application(runtime.key).licensePackageKey))}catch(e){logFailure(e,{operation:'application.worker'})}finally{workerBusy=false}},1000):undefined;
  const taskTimer=setInterval(()=>{if(!restoration.active&&!nativeMaintenance()&&licenseRuntime.view().allowed)void scheduledTasks.tick().catch(e=>logFailure(e,{operation:'scheduler'}))},5000);
  const paymentTimer=setInterval(()=>{if(!restoration.active&&!nativeMaintenance())void payments.tick().catch(e=>logFailure(e,{operation:'payment.recovery'}))},30000);
  const smsTimer=setInterval(()=>{if(!restoration.active&&!nativeMaintenance())void tenantSms.recover().catch(e=>logFailure(e,{operation:'sms.recovery'}))},60000);
  const officialTimer=setInterval(()=>{if(!restoration.active&&!nativeMaintenance()&&licenseRuntime.view().allowed)void tenantOfficialAccounts.tick().catch(e=>logFailure(e,{operation:'official.worker'}))},5000);
  const subscriptionTimer=setInterval(()=>{if(!restoration.active&&!nativeMaintenance()&&licenseRuntime.view().allowed)void tenantSubscriptions.tick().catch(e=>logFailure(e,{operation:'subscription.worker'}))},15000);
  const sweepStorage=()=>{if(!restoration.active&&!nativeMaintenance()&&licenseRuntime.view().allowed)void storage.sweep().catch((e:unknown)=>logFailure(e,{operation:'storage.expiry'}))};
  const storageTimer=setInterval(sweepStorage,60000);sweepStorage();
  // Keep the deadline referenced until every async close settles, even after all sockets have closed.
  const stop=async()=>{if(draining)return;draining=true;const deadline=setTimeout(()=>{console.error('RUNTIME_DRAIN_TIMEOUT');process.exit(1)},60000);try{clearInterval(timer);clearInterval(storageTimer);clearInterval(taskTimer);clearInterval(paymentTimer);clearInterval(smsTimer);clearInterval(subscriptionTimer);clearInterval(officialTimer);licenseRuntime.stop();await restoration.close();await backups.close();while(workerBusy||storage.sweeping||scheduledTasks.busy||payments.busy||tenantSms.busy||tenantSubscriptions.busy||tenantSubscriptions.selecting||tenantOfficialAccounts.busy)await new Promise(r=>setTimeout(r,20));await app.close();await scheduledTasks.close();for(const runtime of appRuntimes)await runtime.close();redisClient.disconnect();await resources.close();clearTimeout(deadline);process.exit(0)}catch{clearTimeout(deadline);console.error('RUNTIME_DRAIN_FAILED');process.exit(1)}};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  console.log(`QiCore API: http://${host}:${process.env.API_PORT||3501}（企业单开实例）`);
}
main().catch(error=>{console.error('STARTUP_BLOCKED: 请检查环境、迁移及正式接入限制');if(process.env.NODE_ENV==='development'&&process.env.QICORE_DEV_WORKSPACE)console.error(error);process.exitCode=1;});
