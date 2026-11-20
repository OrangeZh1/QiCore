import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {TenantApplications} from '../applications/service.mjs';
import {assertConsumerActive} from './consumer-lifecycle.mjs';
import {fail} from './errors.mjs';

export const walletScope=s=>({tenantId:s.tenantId,applicationKey:s.applicationKey,userId:s.userId});
export const walletHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const limit=BigInt(Number.MAX_SAFE_INTEGER);
const assetSchema=z.enum(['points','balance']);
const identifier=z.string().min(1).max(64).refine(v=>!/[\u0000-\u001f\u007f]/.test(v));
const scopeSchema=z.object({tenantId:identifier,applicationKey:identifier,userId:identifier}).strict();
const entrySchema=z.object({requestKey:z.string().min(1).max(160),kind:z.string().min(1).max(32),reference:identifier,reason:z.string().trim().min(1).max(200),actor:identifier,amount:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict();
export function walletParse(schema,input){const p=schema.safeParse(input);if(!p.success)fail('WALLET_INPUT_INVALID','请检查资产、整数金额和请求参数');return p.data}
export function walletEntry(row){return{id:row.id,kind:row.kind,reference:row.reference,delta:Number(row.delta),beforeAmount:Number(row.beforeAmount),afterAmount:Number(row.afterAmount),createdAt:row.createdAt}}

// All mutations participate in the caller's transaction. Lock order is tenant,
// application, order/payment (when present), then account. No network work here.
export class Wallet {
 constructor(db){this.db=db;this.apps=new TenantApplications(db)}
 async authorize(db,s,lock=false){
  walletParse(scopeSchema,walletScope(s));await this.apps.available(s.tenantId,s.applicationKey,db,lock);await assertConsumerActive(db,s.tenantId,s.applicationKey,s.userId);
  const current=await db.session.findUnique({where:{token:s.token}});
  if(!current||current.expiresAt<=new Date()||current.role!=='user'||Object.entries(walletScope(s)).some(([k,v])=>current[k]!==v))fail('UNAUTHENTICATED','登录已失效',401);
 }
 async account(db,s,asset,lock=false){
  walletParse(scopeSchema,walletScope(s));walletParse(assetSchema,asset);const where={...walletScope(s),asset};
  if(lock){await db.walletAccount.upsert({where:{tenantId_applicationKey_userId_asset:where},create:{id:randomUUID(),...where},update:{}});await db.$queryRaw`SELECT id FROM WalletAccount WHERE tenantId=${s.tenantId} AND applicationKey=${s.applicationKey} AND userId=${s.userId} AND asset=${asset} FOR UPDATE`}
  return db.walletAccount.findUnique({where:{tenantId_applicationKey_userId_asset:where}});
 }
 async summary(db,s){const rows=await db.walletAccount.findMany({where:walletScope(s)});return Object.fromEntries(['points','balance'].map(asset=>{const row=rows.find(r=>r.asset===asset);return[asset,{amount:Number(row?.amount||0),version:row?.version||0,unit:asset==='balance'?'CNY_CENT':'POINT'}]}))}
 async read(s){return this.apps.transaction(async db=>{await this.authorize(db,s);const result=await this.summary(db,s);await this.authorize(db,s);return result})}
 async entry(db,account,q,delta,parts,payloadHash){
  const after=account.amount+delta;if(after<0n)fail('WALLET_INSUFFICIENT','可用资产不足',409);if(after>limit)fail('WALLET_RANGE','资产余额超出允许范围',409);
  const row=await db.walletEntry.create({data:{id:randomUUID(),accountId:account.id,requestKey:q.requestKey,payloadHash,kind:q.kind,reference:q.reference,delta,beforeAmount:account.amount,afterAmount:after,parts,reason:q.reason,actor:q.actor}});
  await db.walletAccount.update({where:{id:account.id},data:{amount:after,version:{increment:1}}});return row;
 }
 async duplicate(db,a,q,payloadHash){const row=await db.walletEntry.findUnique({where:{accountId_requestKey:{accountId:a.id,requestKey:q.requestKey}}});if(row&&row.payloadHash!==payloadHash)fail('WALLET_REQUEST_CONFLICT','请求编号已用于其他内容，请查询原结果',409);return row}
 async credit(db,s,asset,input,{version=null}={}){
  const q=walletParse(entrySchema,input),a=await this.account(db,s,asset,true),hash=walletHash(['credit',q,version]),old=await this.duplicate(db,a,q,hash);if(old)return old;
  if(version!==null&&a.version!==version)fail('WALLET_CONFLICT','资产已变化，请刷新后再操作',409);
  const lot=await db.walletLot.create({data:{id:randomUUID(),accountId:a.id,sourceKey:q.requestKey,sourceOrder:q.kind.startsWith('recharge.')?q.reference:null,kind:q.kind,original:BigInt(q.amount),remaining:BigInt(q.amount)}});
  return this.entry(db,a,q,BigInt(q.amount),[{lotId:lot.id,amount:q.amount}],hash);
 }
 async debit(db,s,asset,input,{sourceOrder=null,untouched=false,version=null}={}){
  const q=walletParse(entrySchema,input),a=await this.account(db,s,asset,true),hash=walletHash(['debit',q,sourceOrder,untouched,version]),old=await this.duplicate(db,a,q,hash);if(old)return old;
  if(version!==null&&a.version!==version)fail('WALLET_CONFLICT','资产已变化，请刷新后再操作',409);
  const lots=await db.walletLot.findMany({where:{accountId:a.id,...(sourceOrder?{sourceOrder}:{remaining:{gt:0}})},orderBy:[{createdAt:'asc'},{id:'asc'}]});
  if(untouched&&lots.some(l=>l.spent!==0n||l.remaining!==l.original))fail('REFUND_ASSET_USED','该充值资产已使用或调整，不能自动退款',409);
  let remaining=BigInt(q.amount);if(a.amount<remaining||lots.reduce((n,l)=>n+l.remaining,0n)<remaining)fail('WALLET_INSUFFICIENT','可用资产不足',409);
  const parts=[];for(const lot of lots){if(!remaining)break;const amount=remaining<lot.remaining?remaining:lot.remaining;if(!amount)continue;await db.walletLot.update({where:{id:lot.id},data:{remaining:{decrement:amount},spent:{increment:amount}}});parts.push({lotId:lot.id,amount:Number(amount)});remaining-=amount}
  return this.entry(db,a,q,-BigInt(q.amount),parts,hash);
 }
 async restore(db,s,asset,input,originalId){
  const q=walletParse(entrySchema,input),a=await this.account(db,s,asset,true),hash=walletHash(['restore',q,originalId]),old=await this.duplicate(db,a,q,hash);if(old)return old;
  const original=await db.walletEntry.findFirst({where:{id:originalId,accountId:a.id,delta:{lt:0}}});if(!original)fail('WALLET_SOURCE_INVALID','原扣款记录不存在',409);
  const returned=await db.walletEntry.findMany({where:{accountId:a.id,kind:'return',reference:originalId}}),restored=new Map();
  for(const row of returned)for(const part of row.parts)restored.set(part.lotId,(restored.get(part.lotId)||0)+part.amount);
  if(q.kind!=='return'||q.reference!==originalId||returned.reduce((n,e)=>n+e.delta,0n)+BigInt(q.amount)>-original.delta)fail('WALLET_RETURN_INVALID','退回金额超过原扣款',409);
  let left=q.amount;const parts=[];
  for(const part of original.parts){if(!left)break;const amount=Math.min(left,part.amount-(restored.get(part.lotId)||0));if(!amount)continue;const lot=await db.walletLot.findFirst({where:{id:part.lotId,accountId:a.id}});if(!lot||lot.remaining+BigInt(amount)>lot.original)fail('WALLET_SOURCE_INVALID','原资产批次需要核查',409);await db.walletLot.update({where:{id:lot.id},data:{remaining:{increment:BigInt(amount)}}});parts.push({lotId:lot.id,amount});left-=amount}
  if(left)fail('WALLET_SOURCE_INVALID','原资产分配需要核查',409);return this.entry(db,a,q,BigInt(q.amount),parts,hash);
 }
 async records(db,s,asset,input={}){
  walletParse(assetSchema,asset);const q=walletParse(z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20),type:z.enum(['all','recharge','spend','return','gift','adjust','refund']).default('all')}).strict(),input),a=await this.account(db,s,asset);
  const kinds={recharge:['recharge.paid'],spend:['spend'],return:['return'],gift:['recharge.gift','gift'],adjust:['adjust'],refund:['refund.revoke']};
  if(!a)return{items:[],total:0,page:1,pageSize:q.pageSize};const where={accountId:a.id,...(q.type==='all'?{}:{kind:{in:kinds[q.type]}})},total=await db.walletEntry.count({where}),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize)));
  return{items:(await db.walletEntry.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*q.pageSize,take:q.pageSize})).map(walletEntry),total,page,pageSize:q.pageSize};
 }
 async consumerRecords(s,asset,q){return this.apps.transaction(async db=>{await this.authorize(db,s);const result=await this.records(db,s,asset,q);await this.authorize(db,s);return result})}
 async consumerRecord(s,asset,id){walletParse(identifier,id);return this.apps.transaction(async db=>{await this.authorize(db,s);const a=await this.account(db,s,asset),row=a?await db.walletEntry.findFirst({where:{id,accountId:a.id}}):null;if(!row)fail('NOT_FOUND','资产流水不存在',404);await this.authorize(db,s);return{...walletEntry(row),asset,unit:asset==='balance'?'CNY_CENT':'POINT'}})}
}
