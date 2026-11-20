import {randomUUID,randomInt} from 'node:crypto';
import {z} from 'zod';
import {Wallet,walletScope,walletHash,walletParse,walletEntry} from './wallet.mjs';
import {fail} from './errors.mjs';
import {assertConsumerActive} from './consumer-lifecycle.mjs';
import {hasApplicationPermission} from '../applications/registry.mjs';
import {frameworkKey} from '../applications/framework.mjs';
import {normalizeAccountImage} from './account-image.mjs';

const cents=z.number().int().min(1).max(100000000),points=z.number().int().min(1).max(100000000),gift=z.number().int().min(0).max(100000000).default(0);
const image=z.string().max(120000).nullable().optional();
const tier=z.object({id:z.uuid(),name:z.string().trim().min(1).max(64),image,priceCents:cents,points, giftPoints:gift,enabled:z.boolean(),sort:z.number().int().min(0).max(100000)}).strict();
const balanceTier=z.object({id:z.uuid(),image,amountCents:cents,giftCents:gift,enabled:z.boolean(),sort:z.number().int().min(0).max(100000)}).strict();
export const rechargeConfigSchema=z.object({points:z.array(tier).max(200),balance:z.object({tiers:z.array(balanceTier).max(100),customEnabled:z.boolean(),minCents:cents,maxCents:cents}).strict().refine(v=>v.minCents<=v.maxCents)}).strict().refine(v=>new Set([...v.points,...v.balance.tiers].map(t=>t.id)).size===v.points.length+v.balance.tiers.length);
export const rechargeDefaults=()=>({points:[],balance:{tiers:[],customEnabled:false,minCents:1,maxCents:100000000}});
const orderInput=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('points_recharge'),packageId:z.uuid(),version:z.number().int().positive(),requestKey:z.uuid()}).strict(),
 z.object({kind:z.literal('balance_recharge'),tierId:z.uuid(),version:z.number().int().positive(),requestKey:z.uuid()}).strict(),
 z.object({kind:z.literal('balance_custom'),amountCents:cents,version:z.number().int().positive(),requestKey:z.uuid()}).strict()
]);
const query=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20),status:z.enum(['all','pending','paid','refunded','cancelled']).default('all'),kind:z.enum(['all','points_recharge','balance_recharge']).default('all'),q:z.string().trim().max(100).default('')}).strict();
const orderSelect=o=>({id:o.id,kind:o.kind,name:o.product.name,originalAmountCents:o.amount,amountCents:o.amount,currency:o.currency,status:o.status,createdAt:o.createdAt,product:o.product});
const sorted=rows=>[...rows].sort((a,b)=>a.sort-b.sort||a.id.localeCompare(b.id));
export class Recharge {
 constructor(db,{storage=null}={}){this.db=db;this.storage=storage;this.wallet=new Wallet(db);this.apps=this.wallet.apps;this.payments=null}
 async audit(db,s,action,details){await db.audit.create({data:{id:randomUUID(),scope:'tenant',tenantId:s.tenantId,applicationKey:s.applicationKey,actor:s.impersonatedBy||s.id||'system',action,details:{...details,...(s.delegated?{targetAdminId:s.id}:{})}}})}
 async setting(db,s){const row=await db.rechargeSetting.findUnique({where:{tenantId_applicationKey:{tenantId:s.tenantId,applicationKey:s.applicationKey}}});return{version:row?.version||0,config:row?.config||rechargeDefaults()}}
 async adminContext(db,s,tenantId,key,permission='entitlements.read',lock=false){const context=await this.apps.featureContext(db,s,tenantId,key,'payments',permission);if(!context.selected)fail('APPLICATION_REQUIRED','请选择应用');await this.apps.admin(s,tenantId,context.selected.key,permission,db,lock);if(permission==='entitlements.write')await this.apps.admin(s,tenantId,context.selected.key,'entitlements.read',db);return{tenantId,applicationKey:context.selected.key,canWrite:context.permissions.includes('entitlements.write')}}
 async config(s,tenantId,key){return this.apps.transaction(async db=>{const ctx=await this.adminContext(db,s,tenantId,key);return{...await this.setting(db,ctx),...ctx}})}
 async saveConfig(s,tenantId,key,input){const q=walletParse(z.object({version:z.number().int().nonnegative(),config:rechargeConfigSchema}).strict(),input);return this.apps.transaction(async db=>{const ctx=await this.adminContext(db,s,tenantId,key,'entitlements.write',true),before=await this.setting(db,ctx);if(before.version!==q.version)fail('RECHARGE_CONFLICT','充值配置已变化，请刷新后再保存',409);for(const [rows,previous] of [[q.config.points,before.config.points],[q.config.balance.tiers,before.config.balance.tiers]])for(const tier of rows){const old=previous.find(item=>item.id===tier.id);if(tier.image===undefined){if(old&&Object.prototype.hasOwnProperty.call(old,'image'))tier.image=old.image;continue}if(tier.image!==old?.image)tier.image=await normalizeAccountImage(tier.image,{storage:this.storage,siteId:tenantId,size:512,fit:'contain'})}const row=await db.rechargeSetting.upsert({where:{tenantId_applicationKey:{tenantId,applicationKey:ctx.applicationKey}},create:{tenantId,applicationKey:ctx.applicationKey,config:q.config},update:{config:q.config,version:{increment:1}}});await this.audit(db,{...s,...ctx},'recharge.settings',{before,after:{version:row.version,config:row.config}});return{version:row.version,config:row.config,...ctx}})}
 async publicCatalog(input){const q=walletParse(z.object({tenantId:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),applicationKey:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)}).strict(),input);await this.apps.available(q.tenantId,q.applicationKey);const row=await this.setting(this.db,q);await this.apps.available(q.tenantId,q.applicationKey);return{version:row.version,points:sorted(row.config.points.filter(p=>p.enabled)),balance:{...row.config.balance,tiers:sorted(row.config.balance.tiers.filter(p=>p.enabled))}}}
 async catalog(s){return this.apps.transaction(async db=>{await this.wallet.authorize(db,s);const row=await this.setting(db,s),result={version:row.version,points:sorted(row.config.points.filter(p=>p.enabled)),balance:{...row.config.balance,tiers:sorted(row.config.balance.tiers.filter(p=>p.enabled))},policy:{expiresAt:null,customGiftCents:0,refund:'unused_order_all_assets'}};await this.wallet.authorize(db,s);return result})}
 async create(s,input){const q=walletParse(orderInput,input),payloadHash=walletHash(q);return this.apps.transaction(async db=>{
  await this.wallet.authorize(db,s,true);const old=await db.rechargeOrder.findUnique({where:{tenantId_applicationKey_userId_requestKey:{...walletScope(s),requestKey:q.requestKey}}});if(old){if(old.payloadHash!==payloadHash)fail('RECHARGE_REQUEST_CONFLICT','同一请求不能更换充值内容',409);return this.expose(db,old)}
  const row=await this.setting(db,s);if(row.version!==q.version)fail('RECHARGE_CONFLICT','充值档位已变化，请重新选择',409);
  let amount,product,kind=q.kind;
  if(kind==='points_recharge'){const pkg=row.config.points.find(p=>p.id===q.packageId&&p.enabled);if(!pkg)fail('RECHARGE_UNAVAILABLE','积分套餐已停用或不存在',409);amount=pkg.priceCents;product={...pkg,base:pkg.points,gift:pkg.giftPoints,asset:'points'}}
  else if(kind==='balance_recharge'){const pkg=row.config.balance.tiers.find(p=>p.id===q.tierId&&p.enabled);if(!pkg)fail('RECHARGE_UNAVAILABLE','余额充值档位已停用或不存在',409);amount=pkg.amountCents;product={...pkg,name:'余额充值',base:amount,gift:pkg.giftCents,asset:'balance'}}
  else {if(!row.config.balance.customEnabled||q.amountCents<row.config.balance.minCents||q.amountCents>row.config.balance.maxCents)fail('RECHARGE_AMOUNT_INVALID','充值金额不在允许范围内');kind='balance_recharge';amount=q.amountCents;product={name:'余额充值',base:amount,gift:0,asset:'balance'}}
  const o=await db.rechargeOrder.create({data:{id:Date.now().toString()+randomInt(10000000).toString().padStart(7,'0'),...walletScope(s),requestKey:q.requestKey,payloadHash,kind,amount,product:{...product,expiresAt:null,refundPolicy:'unused_order_all_assets',configVersion:row.version},currency:'CNY',status:'pending'}});await this.audit(db,s,'recharge.order.create',{orderId:o.id,kind,amountCents:amount});return this.expose(db,o);
 })}
 async paymentRows(db,orders){
  const grouped=new Map();if(!orders.length)return grouped;
  const rows=await db.paymentRecord.findMany({where:{OR:orders.map(o=>({...walletScope(o),orderId:o.id}))},orderBy:{sequence:'desc'},include:{refunds:{orderBy:{sequence:'desc'}}}});
  for(const row of rows){if(!grouped.has(row.orderId))grouped.set(row.orderId,[]);grouped.get(row.orderId).push(row)}return grouped;
 }
 async expose(db,o,attempts=null){attempts??=(await this.paymentRows(db,[o])).get(o.id)||[];const p=attempts.find(row=>row.currentSlot===1),refunds=p?.refunds||[];return{...orderSelect(o),paymentAttempts:this.payments?await this.payments.history(db,o,o.id,attempts):[],payment:p?this.payments?.view(p,refunds[0])||{provider:p.provider,state:p.state,paidAt:p.paidAt,payerTotalCents:p.payerTotal}:null,refundedCents:refunds.filter(r=>r.state==='SUCCESS').reduce((n,r)=>n+(r.amount??o.amount),0),fulfillment:['paid','partial_refund','refunded','refund_pending'].includes(o.status)?o.status==='paid'?'credited':'revoked':o.status==='compensation_due'?'compensation':'pending'}}
 async owned(db,s,id){const o=await db.rechargeOrder.findFirst({where:{id,...walletScope(s),consumerDeletedAt:null}});if(!o)fail('NOT_FOUND','充值订单不存在',404);return o}
 async detail(s,id){return this.apps.transaction(async db=>{await this.wallet.authorize(db,s);const result=await this.expose(db,await this.owned(db,s,id));await this.wallet.authorize(db,s);return result})}
 async byRequest(s,requestKey){const key=walletParse(z.uuid(),requestKey);return this.apps.transaction(async db=>{await this.wallet.authorize(db,s);const order=await db.rechargeOrder.findFirst({where:{...walletScope(s),requestKey:key,consumerDeletedAt:null}});const result=order?await this.expose(db,order):null;await this.wallet.authorize(db,s);return result})}
 async methods(s,id,input={}){await this.wallet.authorize(this.db,s);await this.owned(this.db,s,id);return this.payments.methods(s,id,input)}
 async list(db,s,input={},admin=false){const q=walletParse(query,input),where={tenantId:s.tenantId,applicationKey:s.applicationKey,...(!admin?{userId:s.userId,consumerDeletedAt:null}:{}),...(q.kind==='all'?{}:{kind:q.kind}),...(q.status==='all'?{}:{status:q.status==='paid'?{in:['paid','partial_refund','refund_pending','compensation_due']}:q.status}),...(q.q?{OR:[{id:{contains:q.q}},{userId:{contains:q.q}}]}:{})},total=await db.rechargeOrder.count({where}),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize))),rows=await db.rechargeOrder.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*q.pageSize,take:q.pageSize}),payments=await this.paymentRows(db,rows);return{items:await Promise.all(rows.map(async o=>{const view=await this.expose(db,o,payments.get(o.id)||[]);if(!admin)return view;const p=view.payment;return{...view,userId:o.userId,refundUnavailableReason:!p?'尚未支付':p.provider!=='balance'&&!this.payments?.enabled?'真实渠道退款尚未开放':p.provider==='alipay'&&p.payerTotalCents!==o.amount?'支付宝优惠订单需核查实际退款金额':null}})),total,page,pageSize:q.pageSize}}
 async consumerOrders(s,q){return this.apps.transaction(async db=>{await this.wallet.authorize(db,s);const result=await this.list(db,s,q);await this.wallet.authorize(db,s);return result})}
 async adminOrders(s,tenantId,key,q){return this.apps.transaction(async db=>{const ctx=await this.adminContext(db,s,tenantId,key,'orders.read');return{...await this.list(db,ctx,q,true),applicationKey:ctx.applicationKey,canManage:hasApplicationPermission((await this.apps.actor(db,s,'tenant',tenantId)).role.permissions,ctx.applicationKey,'orders.manage')&&hasApplicationPermission(s.permissions,ctx.applicationKey,'orders.manage')}})}
 async cancel(s,id){await this.wallet.authorize(this.db,s);const p=await this.db.paymentRecord.findFirst({where:{...walletScope(s),orderId:id,currentSlot:1}});if(p){await this.payments.cancel(s,id);return this.detail(s,id)}return this.apps.transaction(async db=>{await this.wallet.authorize(db,s,true);const o=await this.owned(db,s,id);if(await db.paymentRecord.count({where:{tenantId:s.tenantId,applicationKey:s.applicationKey,orderId:id}}))fail('PAYMENT_IN_PROGRESS','请查询原支付后取消',409);await db.rechargeOrder.updateMany({where:{id:o.id,status:'pending'},data:{status:'cancelled'}});return this.expose(db,await db.rechargeOrder.findUnique({where:{id}}))})}
 async adminAssets(s,tenantId,key,userId,input=null){return this.apps.transaction(async db=>{
  const ctx=await this.adminContext(db,s,tenantId,key,input?'entitlements.write':'entitlements.read',!!input);await this.apps.admin(s,tenantId,key,'consumers.read',db);
  const target={...ctx,userId};if(!await db.consumerProfile.count({where:walletScope(target)}))fail('NOT_FOUND','用户不存在',404);
  const enabled=(await this.setting(db,ctx)).version>0;
  if(input){
   // Saving recharge settings explicitly selects the public ledger; adjustments must not switch a legacy site implicitly.
   if(!enabled)fail('WALLET_NOT_ENABLED','请先在充值管理保存配置以启用公共钱包，再调整积分',409);
   await assertConsumerActive(db,tenantId,key,userId);
   const q=walletParse(z.object({requestKey:z.uuid(),version:z.number().int().nonnegative(),kind:z.enum(['gift','adjust']),amount:z.number().int().positive().max(1000000),reason:z.string().trim().min(1).max(200)}).strict(),input),a=await this.wallet.account(db,target,'points',true),data={requestKey:q.requestKey,kind:q.kind,amount:q.amount,reference:q.requestKey,reason:q.reason,actor:s.impersonatedBy||s.id};
   const existing=await db.walletEntry.findUnique({where:{accountId_requestKey:{accountId:a.id,requestKey:q.requestKey}}});if(!existing&&a.version!==q.version)fail('WALLET_CONFLICT','资产已变化，请刷新后操作',409);
   const entry=q.kind==='gift'?await this.wallet.credit(db,target,'points',data,{version:q.version}):await this.wallet.debit(db,target,'points',data,{version:q.version});
   if(!existing)await this.audit(db,{...s,...ctx},'wallet.'+q.kind,{userId,entryId:entry.id,amount:q.amount,reason:q.reason});
   return{enabled,assets:await this.wallet.summary(db,target),entry:walletEntry(entry)};
  }
  return{enabled,assets:await this.wallet.summary(db,target)};
 })}
 async adminRecords(s,tenantId,key,userId,asset,q){return this.apps.transaction(async db=>{const ctx=await this.adminContext(db,s,tenantId,key);await this.apps.admin(s,tenantId,key,'consumers.read',db);return this.wallet.records(db,{...ctx,userId},asset,q)})}
}

// The host combines framework recharge fulfilment with an application's existing
// order adapter; the shared payment executor still owns receipts and refunds.
export function rechargePayments(recharge,key,legacy){
 const dbScope=o=>({tenantId:o.tenantId,applicationKey:key,userId:o.userId});
 const own={
  paymentKind:o=>o.product?.asset==='points'?'virtual':legacy.paymentKind?.(o)||'unknown',
  async refundPreview(db,p){
   const o=await db.rechargeOrder.findFirst({where:{id:p.orderId,tenantId:p.tenantId,applicationKey:key,userId:p.userId}});if(!o)fail('NOT_FOUND','原充值订单不存在',404);
   if(!['points','balance'].includes(o.product.asset)||!Number.isSafeInteger(o.product.base)||o.product.base<=0||!Number.isSafeInteger(o.product.gift)||o.product.gift<0||!Number.isSafeInteger(o.product.base+o.product.gift))return{orderName:o.product.name||'充值订单',orderKind:o.kind,refundEffect:'原充值资产快照需要核查。',refundUnavailableReason:'原充值资产快照需要核查'};
   const a=await recharge.wallet.account(db,dbScope(o),o.product.asset),revoked=a?await db.walletEntry.findUnique({where:{accountId_requestKey:{accountId:a.id,requestKey:'refund:'+o.id}}}):null;
   const lots=a?await db.walletLot.findMany({where:{accountId:a.id,sourceOrder:o.id}}):[],amount=BigInt(o.product.base+o.product.gift);
   let unavailable=!['paid','partial_refund','compensation_due'].includes(o.status)?'订单当前不能退款':null;
   if(!unavailable&&o.status!=='compensation_due'&&!revoked){if(lots.some(l=>l.spent!==0n||l.remaining!==l.original))unavailable='该充值资产已使用或调整，不能自动退款';else if(!a||a.amount<amount||lots.reduce((n,l)=>n+l.remaining,0n)<amount)unavailable='原充值资产不足，请先核查';}
   return{orderName:o.product.name,orderKind:o.kind,refundEffect:o.status==='compensation_due'?'本订单未发放充值资产，退款不回收其他订单的资产。':revoked?'本订单充值资产已回收，后续退余款不会重复回收。':o.product.asset==='balance'?'首次退款（包括部分退款）回收本订单到账的全部余额及赠送余额，不影响其他来源的余额。':'首次退款（包括部分退款）回收本订单到账的全部积分及赠送积分，不影响会员等级或其他来源的积分。',refundUnavailableReason:unavailable};
  },
  async lock(db,tenantId,id){await db.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} FOR UPDATE`;await db.$queryRaw`SELECT tenantId FROM TenantApplication WHERE tenantId=${tenantId} AND applicationKey=${key} FOR UPDATE`;await db.$queryRaw`SELECT id FROM RechargeOrder WHERE id=${id} FOR UPDATE`;const o=await db.rechargeOrder.findFirst({where:{id,tenantId,applicationKey:key}});if(!o)fail('NOT_FOUND','充值订单不存在',404);return{...o,_recharge:true,description:o.product.name}},
  async payable(db,o){await recharge.apps.available(o.tenantId,key,db);if(o.status!=='pending'||o.consumerDeletedAt)fail('ORDER_NOT_PAYABLE','订单当前不能支付',409)},
  async balancePayable(db,o){if(o.kind==='balance_recharge')fail('BALANCE_SELF_RECHARGE','余额充值不能使用余额支付',409);await own.payable(db,o)},
  async settle(db,o,p){
   const s=dbScope(o),tenant=await db.tenant.findUnique({where:{id:o.tenantId}}),app=await db.tenantApplication.findUnique({where:{tenantId_applicationKey:{tenantId:o.tenantId,applicationKey:key}}}),user=await db.consumerProfile.findUnique({where:{tenantId_applicationKey_userId:s}}),now=new Date();const compensate=o.status!=='pending'||!recharge.apps.licenseAllowed(key)||!tenant?.enabled||tenant.expiresAt&&tenant.expiresAt<=now||!app?.enabled||key!==frameworkKey&&app.activeSlot!==1||app.expiresAt&&app.expiresAt<=now||user?.enabled===false||user?.deletedAt;
   if(!compensate){const product=o.product;if(!['points','balance'].includes(product.asset)||!Number.isSafeInteger(product.base)||product.base<=0||!Number.isSafeInteger(product.gift)||product.gift<0)fail('ORDER_SNAPSHOT_INVALID','充值快照需要核查',409);for(const [name,amount] of [['paid',product.base],['gift',product.gift]])if(amount)await recharge.wallet.credit(db,s,product.asset,{requestKey:'recharge:'+o.id+':'+name,kind:'recharge.'+name,reference:o.id,amount,reason:name==='paid'?'充值到账':'充值赠送',actor:'system'})}
   await db.rechargeOrder.update({where:{id:o.id},data:{status:compensate?'compensation_due':'paid'}});await recharge.audit(db,s,'recharge.settle',{orderId:o.id,paymentId:p.id,compensate:!!compensate});return!!compensate;
  },
  async afterSettlement(){/* Deposits and buying currency do not award consumption growth twice. */},
  async cancel(db,o){await db.rechargeOrder.updateMany({where:{id:o.id,status:'pending'},data:{status:'cancelled'}})},
  async reserveRefund(db,o){if(!['paid','partial_refund','compensation_due'].includes(o.status))fail('REFUND_NOT_ALLOWED','订单当前不能退款',409);if(o.status!=='compensation_due')await recharge.wallet.debit(db,dbScope(o),o.product.asset,{requestKey:'refund:'+o.id,kind:'refund.revoke',reference:o.id,amount:o.product.base+o.product.gift,reason:'退款回收原充值全部资产',actor:'system'},{sourceOrder:o.id,untouched:true});await db.rechargeOrder.update({where:{id:o.id},data:{status:'refund_pending'}})},
  async refunded(db,o,full){await db.rechargeOrder.update({where:{id:o.id},data:{status:full?'refunded':'partial_refund'}})},
  async removeFromConsumer(db,o){await db.rechargeOrder.update({where:{id:o.id},data:{consumerDeletedAt:new Date()}})}
 };
 const adapter={...legacy,paymentKind:o=>o._recharge?own.paymentKind(o):legacy.paymentKind?.(o)||'unknown',authorize:(db,s)=>recharge.wallet.authorize(db,s,true),lock:async(db,tenantId,id)=>await db.rechargeOrder.count({where:{id,tenantId,applicationKey:key}})?own.lock(db,tenantId,id):legacy.lock(db,tenantId,id)};
 adapter.refundPreview=async(db,p)=>await db.rechargeOrder.count({where:{id:p.orderId,tenantId:p.tenantId,applicationKey:key,userId:p.userId}})?own.refundPreview(db,p):legacy.refundPreview?.(db,p);
 adapter.orders=(db,s,q)=>legacy.ordersWithRecharge?legacy.ordersWithRecharge(db,s,q,recharge):legacy.orders(db,s,q);
 for(const method of ['payable','balancePayable','settle','afterSettlement','cancel','reserveRefund','refunded','removeFromConsumer'])adapter[method]=(db,o,...args)=>(o._recharge?own:legacy)[method]?.(db,o,...args);
 return adapter;
}
