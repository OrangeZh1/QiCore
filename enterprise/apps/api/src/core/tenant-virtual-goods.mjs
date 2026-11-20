import {virtualRechargeSources} from '../payments/virtual-recharge.mjs';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import sharp from 'sharp';
import {z} from 'zod';
import {application} from '../applications/registry.mjs';
import {miniProgramDomains} from '../channels/mini-domains.mjs';
import {validatePaymentKeys} from '../payments/config.mjs';
import {VirtualGoodsClient} from '../payments/virtual-goods-client.mjs';
import {fail} from './errors.mjs';
import {normalizeAccountImage} from './account-image.mjs';

const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const active=t=>t&&['RUNNING','UNKNOWN'].includes(t.state);
const scope=(tenantId,applicationKey)=>({tenantId,applicationKey});
const taskId=c=>hash(['virtual-goods',c.appId,c.env]);
const field=t=>t.action==='upload'?'uploadState':'publishState';
const parse=(schema,value)=>{const p=schema.safeParse(value);if(!p.success)fail('VIRTUAL_INPUT_INVALID','请检查商品任务和配置版本');return p.data};
const key=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const selection=z.object({operationId:z.uuid(),version:z.number().int().positive(),catalogHash:z.string().regex(/^[a-f0-9]{64}$/),action:z.enum(['upload','publish'])}).strict();
const goodsInput=z.object({version:z.number().int().nonnegative(),name:z.string().trim().min(1).refine(v=>[...v].length<=20&&!/[\u0000-\u001f\u007f]/.test(v)),price:z.number().int().min(1).max(100000000),image:z.string().max(120000).nullable(),productId:z.string().regex(/^[A-Za-z0-9_-]{1,20}$/)}).strict();

export class TenantVirtualGoods {
  constructor(db,payments,mini,{client=new VirtualGoodsClient(),origin=()=>process.env.PUBLIC_API_ORIGIN,storage=null}={}){this.db=db;this.storage=storage;this.payments=payments;this.mini=mini;this.apps=payments.apps;this.client=client;this.origin=origin}
  async context(db,s,tenantId,applicationKey,write=false){
    parse(key,tenantId);parse(key,applicationKey);
    const ctx=await this.apps.featureContext(db,s,tenantId,applicationKey,'virtualGoods','settings.read');
    const app=await this.apps.admin(s,tenantId,applicationKey,write?'settings.write':'settings.read',db,write);
    const row=await db.tenantPaymentRevision.findFirst({where:{...scope(tenantId,applicationKey),provider:'wechat-virtual'},orderBy:{version:'desc'}});
    const mini=await db.tenantMiniProgramSetting.findUnique({where:{tenantId_applicationKey:scope(tenantId,applicationKey)}});
    const drafts=await db.virtualGoodsSetting.findMany({where:scope(tenantId,applicationKey)});
    return{ctx,app,row,mini,drafts,sources:[...application(applicationKey).virtualGoods(app.config),...await virtualRechargeSources(db,tenantId,applicationKey)]};
  }
  candidates(tenantId,applicationKey,ctx){
    const c=ctx.row?.config||{appId:'',offerId:'',env:1};
    return ctx.sources.map(source=>{
      const defaults={name:source.name,price:source.price,image:source.image??null,productId:'v'+hash([tenantId,applicationKey,c.appId,c.offerId,source.localId,hash({...source,image:source.image??null})]).slice(0,19)};
      const draft=ctx.drafts.find(d=>d.localId===source.localId),item={...source,...draft?.config,...(source.rechargeSnapshot?{name:source.name,price:source.price,...(source.image!==undefined?{image:source.image}:{})}:{})};
      item.image??=null;
      const snapshotHash=hash({localId:item.localId,name:item.name,price:item.price,remark:item.remark,image:item.image,...(source.rechargeSnapshot?{rechargeSnapshot:source.rechargeSnapshot}:{})}),productId=draft?.config.productId||defaults.productId;
      const reason=!item.name||[...item.name].length>20?(source.rechargeSnapshot?'请到充值配置将套餐名称调整为 1–20 字':'请编辑虚拟套餐，将名称调整为 1–20 字'):!item.image?(source.rechargeSnapshot?'请到充值配置补充套餐封面':'请编辑虚拟套餐，补充商品封面'):!Number.isSafeInteger(item.price)||item.price<=0?'商品价格必须大于 0':!item.remark||[...item.remark].length>1024?'商品说明不符合微信要求':'';
      return{...item,sourceType:source.rechargeSnapshot?.asset||'legacy',priceLocked:!!source.rechargeSnapshot,snapshotHash,productId,reason,draftVersion:draft?.version||0,sourceName:source.name,defaults};
    });
  }
  async save(s,tenantId,applicationKey,localId,input){
    parse(key,localId);const q=parse(goodsInput,input);
    await this.apps.transaction(async db=>{
      const ctx=await this.context(db,s,tenantId,applicationKey,true),source=ctx.sources.find(i=>i.localId===localId);
      if(source?.rechargeSnapshot&&q.name!==source.name)fail('VIRTUAL_NAME_MISMATCH','充值商品名称由充值配置决定，请重新读取',409);
      if(source?.rechargeSnapshot&&q.price!==source.price)fail('VIRTUAL_PRICE_MISMATCH','充值商品售价由充值配置决定，不能单独改价',409);
      if(!source)fail('VIRTUAL_GOODS_MISSING','原套餐不存在或已停用，请重新读取',404);
      if(await db.virtualGoodsTask.count({where:{...scope(tenantId,applicationKey),state:{in:['RUNNING','UNKNOWN']}}}))fail('VIRTUAL_TASK_BUSY','请先确认当前商品任务的结果，再编辑虚拟套餐',409);
      const old=ctx.drafts.find(row=>row.localId===localId);if((old?.version||0)!==q.version)fail('VIRTUAL_EDIT_CONFLICT','虚拟套餐已修改，请重新打开后编辑',409);
      const image=source.rechargeSnapshot&&source.image!==undefined?source.image:q.image===old?.config.image||q.image===source.image?q.image:await normalizeAccountImage(q.image,{storage:this.storage,siteId:tenantId,size:512,fit:'contain'});
      const config={name:q.name,price:q.price,image,productId:q.productId},c=ctx.row?.config;
      const snapshotHash=hash({localId,name:config.name,price:config.price,remark:source.remark,image:config.image,...(source.rechargeSnapshot?{rechargeSnapshot:source.rechargeSnapshot}:{})});
      if(c){const saved=await db.virtualGoods.findUnique({where:{appId_env_productId:{appId:c.appId,env:c.env,productId:q.productId}}});if(saved&&(saved.tenantId!==tenantId||saved.applicationKey!==applicationKey||saved.localId!==localId||saved.offerId!==c.offerId||saved.snapshotHash!==snapshotHash))fail('VIRTUAL_PRODUCT_ID_USED','该微信商品 ID 已用于其他内容，请更换新的 ID；历史商品记录保留',409)}
      if(ctx.drafts.some(row=>row.localId!==localId&&row.config.productId===q.productId))fail('VIRTUAL_PRODUCT_ID_USED','该微信商品 ID 已被本站其他虚拟套餐使用',409);
      const where={tenantId_applicationKey_localId:{tenantId,applicationKey,localId}};await db.virtualGoodsSetting.upsert({where,create:{tenantId,applicationKey,localId,config,version:1},update:{config,version:q.version+1}});
      await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'virtual.goods.save',details:{localId,version:q.version+1,productId:q.productId,...(s.delegated?{targetAdminId:s.id}:{})}}});
    });return this.view(s,tenantId,applicationKey);
  }
  readiness(ctx){
    if(!ctx.row?.config.appId||!ctx.row.config.offerId)return'请先保存虚拟支付 AppID 和 OfferID';
    if(!ctx.mini?.config.appId||ctx.mini.config.appId!==ctx.row.config.appId||!ctx.mini.keyCipher)return'请在渠道管理中配置同一 AppID 的微信小程序';
    const name=ctx.row.config.env===0?'appKey':'sandboxAppKey';if(!ctx.row.secretFields.includes(name))return'请先保存当前环境的 AppKey';
    if(!miniProgramDomains(this.origin()).available)return'请配置服务端公网 HTTPS 地址，微信需要读取商品图片';
    return'';
  }
  taskView(t,tenantId,applicationKey){if(!t||t.tenantId!==tenantId||t.applicationKey!==applicationKey)return null;return{operationId:t.operationId,action:t.action,state:t.state,completed:t.cursor,total:t.itemIds.length,message:t.message,updatedAt:t.updatedAt}}
  async view(s,tenantId,applicationKey){
    const result=await this.db.$transaction(async db=>{
      const ctx=await this.context(db,s,tenantId,applicationKey),items=this.candidates(tenantId,applicationKey,ctx),catalogHash=hash(items.map(({image,...item})=>item));
      const saved=ctx.row?await db.virtualGoods.findMany({where:{...scope(tenantId,applicationKey),appId:ctx.row.config.appId,env:ctx.row.config.env,productId:{in:items.map(i=>i.productId)}}}):[];
      const task=ctx.row?await db.virtualGoodsTask.findUnique({where:{id:taskId(ctx.row.config)}}):null;
      return{version:ctx.row?.version||0,catalogHash,env:ctx.row?.config.env??1,canWrite:ctx.ctx.permissions.includes('settings.write'),ready:!this.readiness(ctx),message:this.readiness(ctx),task:this.taskView(task,tenantId,applicationKey),sharedBusy:!!active(task)&&(task.tenantId!==tenantId||task.applicationKey!==applicationKey),items:items.map(({image,...item})=>{const row=saved.find(r=>r.productId===item.productId);const changed=!!row&&(row.snapshotHash!==item.snapshotHash||row.offerId!==ctx.row.config.offerId);return{...item,image,reason:changed?'该微信商品 ID 对应旧内容，请编辑并更换 ID':item.reason,uploadState:changed?'CONFLICT':row?.uploadState||'PENDING',publishState:changed?'CONFLICT':row?.publishState||'PENDING',message:row?.message||'',updatedAt:row?.updatedAt||null}})};
    },{isolationLevel:'RepeatableRead'});
    await this.context(this.db,s,tenantId,applicationKey);return result;
  }
  async start(s,tenantId,applicationKey,input){
    const q=parse(selection,input);
    await this.apps.transaction(async db=>{
      const ctx=await this.context(db,s,tenantId,applicationKey,true);
      if(ctx.row?.version!==q.version)fail('PAYMENT_CONFIG_CONFLICT','虚拟支付配置已变化，请重新读取',409);
      const reason=this.readiness(ctx);if(reason)fail('VIRTUAL_NOT_READY',reason,409);
      const items=this.candidates(tenantId,applicationKey,ctx);if(hash(items.map(({image,...item})=>item))!==q.catalogHash)fail('VIRTUAL_CATALOG_CHANGED','套餐已变化，请重新读取后上传',409);
      const id=taskId(ctx.row.config);await db.$queryRaw`SELECT id FROM VirtualGoodsTask WHERE id=${id} FOR UPDATE`;
      const old=await db.virtualGoodsTask.findUnique({where:{id}});
      if(old?.operationId===q.operationId){if(old.tenantId!==tenantId||old.applicationKey!==applicationKey||old.action!==q.action)fail('VIRTUAL_TASK_CONFLICT','任务标识冲突',409);return}
      if(active(old))fail('VIRTUAL_TASK_BUSY','该小程序当前环境已有商品任务，请先查询原任务',409);
      const itemIds=[];
      for(const item of items.filter(i=>!i.reason)){
        let row=await db.virtualGoods.findUnique({where:{appId_env_productId:{appId:ctx.row.config.appId,env:ctx.row.config.env,productId:item.productId}}});
        if(row&&(row.tenantId!==tenantId||row.applicationKey!==applicationKey||row.offerId!==ctx.row.config.offerId||row.snapshotHash!==item.snapshotHash))fail('VIRTUAL_GOODS_CONFLICT','商品映射冲突',409);
        if(!row&&q.action==='upload')row=await db.virtualGoods.create({data:{id:randomUUID().replaceAll('-',''),...scope(tenantId,applicationKey),appId:ctx.row.config.appId,offerId:ctx.row.config.offerId,env:ctx.row.config.env,localId:item.localId,productId:item.productId,snapshotHash:item.snapshotHash,payload:{id:item.productId,name:item.name,price:item.price,remark:item.remark,image:item.image,...(item.rechargeSnapshot?{rechargeSnapshot:item.rechargeSnapshot}: {})}}});
        if(!row||q.action==='publish'&&row.uploadState!=='SUCCESS')continue;
        const state=q.action==='upload'?row.uploadState:row.publishState;
        if(['SUCCESS','CONFLICT','UNKNOWN','RUNNING'].includes(state))continue;
        itemIds.push(row.id);await db.virtualGoods.update({where:{id:row.id},data:{[q.action==='upload'?'uploadState':'publishState']:'PENDING',message:''}});
      }
      if(!itemIds.length)fail('VIRTUAL_NOTHING_TO_DO',q.action==='upload'?'没有待上传且符合要求的商品':'没有已上传且待发布的商品',409);
      const task={...scope(tenantId,applicationKey),operationId:q.operationId,revisionId:ctx.row.id,miniVersion:ctx.mini.version,action:q.action,itemIds,cursor:0,stage:'START',state:'RUNNING',message:'任务已保存，正在逐个处理',leaseToken:null,leaseUntil:null};
      await db.virtualGoodsTask.upsert({where:{id},create:{id,...task},update:task});
      await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId,applicationKey,actor:s.impersonatedBy||s.id,action:'virtual.goods.'+q.action,details:{operationId:q.operationId,env:ctx.row.config.env,count:itemIds.length,...(s.delegated?{targetAdminId:s.id}:{})}}});
    });
    return this.view(s,tenantId,applicationKey);
  }
  imageSignature(id,expires){return createHmac('sha256',this.payments.secrets.key(false)).update('virtual-goods-image:'+id+':'+expires).digest('hex')}
  imageUrl(row){const expires=String(Math.floor(Date.now()/1000)+86400);return miniProgramDomains(this.origin()).request+'/api/v1/public/virtual-goods/'+row.id+'/image.png?'+new URLSearchParams({expires,signature:this.imageSignature(row.id,expires)})}
  async image(id,input){
    parse(z.string().regex(/^[a-f0-9]{32}$/),id);const q=parse(z.object({expires:z.string().regex(/^\d{10}$/),signature:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),input);
    const row=await this.db.virtualGoods.findUnique({where:{id}});if(!row)fail('NOT_FOUND','商品图片不存在',404);
    let valid=false;try{valid=Number(q.expires)>=Date.now()/1000&&Number(q.expires)<=Date.now()/1000+86500&&timingSafeEqual(Buffer.from(q.signature),Buffer.from(this.imageSignature(id,q.expires)))}catch{}
    if(!valid)fail('NOT_FOUND','图片链接已失效',404);
    const match=/^data:image\/(?:webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(row.payload.image||'');if(!match){if(!this.storage)fail('VIRTUAL_IMAGE_INVALID','商品图片无效');return sharp(await this.storage.imageBytes(row.payload.image,row.tenantId),{limitInputPixels:1048576}).rotate().resize(512,512,{fit:'inside',withoutEnlargement:true}).png().toBuffer()}
    return sharp(Buffer.from(match[1],'base64'),{limitInputPixels:1048576}).rotate().resize(512,512,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
  }
  async advance(s,tenantId,applicationKey,input){
    const q=parse(z.object({operationId:z.uuid()}).strict(),input);
    const prepared=await this.apps.transaction(async db=>{
      const ctx=await this.context(db,s,tenantId,applicationKey,true),row=ctx.row;if(!row)fail('VIRTUAL_NOT_READY','请先保存虚拟支付配置');
      const id=taskId(row.config);await db.$queryRaw`SELECT id FROM VirtualGoodsTask WHERE id=${id} FOR UPDATE`;
      const task=await db.virtualGoodsTask.findUnique({where:{id}});
      if(!task||task.tenantId!==tenantId||task.applicationKey!==applicationKey||task.operationId!==q.operationId)fail('VIRTUAL_TASK_CONFLICT','原任务不属于当前站点或环境',409);
      if(!active(task))return null;
      if(task.leaseUntil&&task.leaseUntil>new Date())return null;
      const original=await db.tenantPaymentRevision.findFirst({where:{id:task.revisionId,...scope(tenantId,applicationKey),provider:'wechat-virtual'}});
      if(!original||ctx.mini?.config.appId!==original.config.appId||!ctx.mini?.keyCipher||!ctx.mini.config.appId)fail('VIRTUAL_CREDENTIALS_CHANGED','原小程序凭据已变化，请恢复原 AppID 后查询任务',409);
      if(task.stage==='START'&&(row.id!==task.revisionId||ctx.mini.version!==task.miniVersion)){
        await db.virtualGoodsTask.update({where:{id},data:{state:'FAILED',message:'配置已变化，未继续上传；已提交商品仍保留'}});return null;
      }
      const keys=this.payments.decrypt(original),c=original.config;validatePaymentKeys('wechat-virtual',c,keys,true);
      const goods=await db.virtualGoods.findUnique({where:{id:task.itemIds[task.cursor]}});
      if(!goods||goods.tenantId!==tenantId||goods.applicationKey!==applicationKey||goods.appId!==c.appId||goods.offerId!==c.offerId||goods.env!==c.env)fail('VIRTUAL_TASK_CONFLICT','商品任务归属不匹配',409);
      const leaseToken=randomUUID();await db.virtualGoodsTask.update({where:{id},data:{leaseToken,leaseUntil:new Date(Date.now()+30000)}});
      return{task,goods,leaseToken,credentials:{appId:c.appId,appSecret:this.mini.decrypt(ctx.mini),appKey:c.env===0?keys.appKey:keys.sandboxAppKey,env:c.env}};
    });
    if(!prepared)return this.view(s,tenantId,applicationKey);
    const {task,goods,leaseToken,credentials}=prepared;let outcome,submitted=false;
    try{
      if(task.stage==='START'){
        // Global task per AppID/environment: never overlap batches or overwrite an unconfirmed result.
        const remote=await this.client.call(credentials,'query_'+task.action+'_goods',{env:credentials.env});
        if(remote.status===1){outcome={wait:true,message:'微信侧已有任务运行，等待其完成'};}
        else if(![0,2,3].includes(remote.status))throw Error('INVALID_REMOTE_STATUS');
        else{
          const permitted=await this.apps.transaction(async db=>{const latest=await this.context(db,s,tenantId,applicationKey,true);if(latest.row.id!==task.revisionId||latest.mini.version!==task.miniVersion)fail('VIRTUAL_CREDENTIALS_CHANGED','配置已变化，请重新读取',409);const held=await db.virtualGoodsTask.updateMany({where:{id:task.id,leaseToken},data:{stage:'QUERY'}});if(held.count)await db.virtualGoods.update({where:{id:goods.id},data:{[field(task)]:'RUNNING'}});return held.count});
          if(!permitted)fail('VIRTUAL_TASK_BUSY','任务已经由其他请求接管',409);
          const payload=task.action==='upload'?{upload_item:[{id:goods.productId,name:goods.payload.name,price:goods.payload.price,remark:goods.payload.remark,item_url:this.imageUrl(goods)}],env:credentials.env}:{publish_item:[{id:goods.productId}],env:credentials.env};
          submitted=true;await this.client.call(credentials,'start_'+task.action+'_goods',payload);outcome={wait:true,message:task.action==='upload'?'已提交上传，等待微信处理':'已提交发布，等待微信处理'};
        }
      }else{
        const response=await this.client.call(credentials,'query_'+task.action+'_goods',{env:credentials.env}),items=response[task.action+'_item'];
        if(![0,1,2,3].includes(response.status)||items!==undefined&&!Array.isArray(items))throw Error('INVALID_REMOTE_STATUS');
        const matches=(items||[]).filter(item=>item.id===goods.productId);if(matches.length!==1)outcome={unknown:true,message:'微信任务中未找到原商品，保留原任务等待核对，不重新上传'};
        else{const item=matches[0],state=item[task.action+'_status'];
          if(task.action==='upload'&&state===2&&(item.name!==goods.payload.name||item.price!==goods.payload.price||item.remark!==goods.payload.remark))outcome={state:'CONFLICT',message:'微信商品内容与本地快照不一致，请核对'};
          else if(response.status===1||state===0)outcome={wait:true,message:'微信正在处理原商品'};
          else if(state===2)outcome={state:'SUCCESS',message:task.action==='upload'?'上传成功':'发布成功'};
          else if(state===1)outcome={state:'CONFLICT',message:'微信提示商品 ID 已存在，未将其当作本次成功，请核对'};
          else if(state===3)outcome={state:'FAILED',message:'微信处理失败，请核对商品名称、价格、图片和平台规则后重试'};
          else throw Error('INVALID_REMOTE_STATUS');
        }
      }
    }catch(e){
      outcome=task.stage==='START'&&submitted&&e.code==='VIRTUAL_PROVIDER_REJECTED'&&![268490011,268490012,-1].includes(e.providerCode)?{state:'FAILED',message:'微信拒绝处理，错误码 '+e.providerCode}:{unknown:true,message:'接口结果未确认，请继续查询原任务；不会重复提交'};
    }
    await this.apps.transaction(async db=>{
      const current=await db.virtualGoodsTask.findUnique({where:{id:task.id}});if(current?.leaseToken!==leaseToken)return;
      const data={leaseToken:null,leaseUntil:null,message:outcome.message,state:outcome.unknown?'UNKNOWN':'RUNNING'};
      if(outcome.state){await db.virtualGoods.update({where:{id:goods.id},data:{[field(task)]:outcome.state,message:outcome.message}});data.cursor=task.cursor+1;data.stage='START';if(data.cursor>=task.itemIds.length){data.state='DONE';data.message='本次任务已结束，请查看各商品处理结果'}}
      else if(outcome.unknown&&current.stage==='QUERY')await db.virtualGoods.update({where:{id:goods.id},data:{[field(task)]:'UNKNOWN',message:outcome.message}});
      await db.virtualGoodsTask.updateMany({where:{id:task.id,leaseToken},data});
    });
    return this.view(s,tenantId,applicationKey);
  }
}
