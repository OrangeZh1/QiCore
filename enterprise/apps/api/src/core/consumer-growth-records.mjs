import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {ConsumerProfiles} from '../applications/consumer-profiles.mjs';
import {readDefaultMemberLevel} from './member-defaults.mjs';
import {fail} from './errors.mjs';

const paging=z.object({type:z.enum(['growth','levels']).default('growth'),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(n=>[10,20,50].includes(n)).default(20)}).strict();
const parse=(schema,input)=>{const value=schema.safeParse(input);if(!value.success)fail('MEMBER_INPUT_INVALID','请检查记录类型和分页参数');return value.data};
const before=Prisma.sql`levelBefore`,after=Prisma.sql`levelAfter`;
const defined=column=>Prisma.sql`COALESCE(JSON_TYPE(JSON_EXTRACT(${column}, '$.name')) = 'STRING' AND JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.name')) <> '' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.deleted')), 'false') <> 'true' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.defined')), 'true') <> 'false', FALSE)`;
const rank=column=>Prisma.sql`CASE WHEN JSON_TYPE(JSON_EXTRACT(${column}, '$.rank')) = 'INTEGER' THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.rank')) AS SIGNED) WHEN JSON_TYPE(JSON_EXTRACT(${column}, '$.threshold')) = 'INTEGER' THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.threshold')) AS SIGNED) ELSE NULL END`;
const levelChange=Prisma.sql`kind <> 'tags' AND ${defined(after)} AND (NOT ${defined(before)} OR (${rank(after)} > ${rank(before)} AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(levelAfter, '$.id')), 'null') <> COALESCE(JSON_UNQUOTE(JSON_EXTRACT(levelBefore, '$.id')), 'null')))`;
const growthChange=Prisma.sql`\`after\` <> \`before\``;
const scope=s=>Prisma.sql`tenantId=${s.tenantId} AND applicationKey=${s.applicationKey} AND userId=${s.userId}`;
const fields=Prisma.sql`requestId, kind, \`before\`, \`after\`, levelBefore, levelAfter, createdAt`;
function level(value){
 if(typeof value==='string'){try{value=JSON.parse(value)}catch{return null}}
 if(!value||typeof value!=='object'||typeof value.name!=='string'||!value.name||value.deleted===true||value.defined===false)return null;
 return{id:typeof value.id==='string'?value.id:null,name:value.name,rank:Number.isInteger(value.rank)?value.rank:Number.isInteger(value.threshold)?value.threshold:null};
}
function expose(row){
 const levelBefore=level(row.levelBefore),levelAfter=level(row.levelAfter),event=levelAfter&&!levelBefore?'initial':levelAfter&&levelBefore&&levelAfter.id!==levelBefore.id&&levelAfter.rank!==null&&levelBefore.rank!==null&&levelAfter.rank>levelBefore.rank?'upgrade':null;
 const descriptions={registration:'注册赠送成长值',purchase:'按原订单规则获得成长值',purchase_refund:'按原订单规则扣回成长值',growth:'管理员调整成长值',level:'管理员设置会员等级',order:'有效订单满足等级条件',recalculate:'重新核对等级条件'};
 return{id:row.requestId,kind:row.kind,before:row.before,after:row.after,levelBefore,levelAfter,event,reason:descriptions[row.kind]||'会员记录变动',createdAt:row.createdAt};
}
export class ConsumerGrowthRecords {
 constructor(db){this.db=db;this.profiles=new ConsumerProfiles(db)}
 async list(s,input={}){
  const q=parse(paging,input);await this.profiles.authorize(s);
  const result=await this.db.$transaction(async db=>{
   await this.profiles.authorize(s,db);
   const profile=await db.consumerProfile.findUnique({where:this.profiles.where(s),include:{memberLevel:true}}),fallback=await readDefaultMemberLevel(db,s.tenantId,s.applicationKey),current=profile?.memberLevel||fallback;
   const where=Prisma.sql`${scope(s)} AND (${q.type==='growth'?growthChange:levelChange})`;
   const counts=await db.$queryRaw(Prisma.sql`SELECT COUNT(*) AS total FROM MemberGrowthRecord WHERE ${where}`),total=Number(counts[0].total),page=Math.min(q.page,Math.max(1,Math.ceil(total/q.pageSize)));
   const rows=await db.$queryRaw(Prisma.sql`SELECT ${fields} FROM MemberGrowthRecord WHERE ${where} ORDER BY createdAt DESC, requestId DESC LIMIT ${q.pageSize} OFFSET ${(page-1)*q.pageSize}`);
   return{growth:profile?.growth??0,current:{id:current.id,name:current.name,rank:current.rank,defined:!current.deleted},items:rows.map(expose),total,page,pageSize:q.pageSize,type:q.type};
  },{isolationLevel:'RepeatableRead'});
  await this.profiles.authorize(s);return result;
 }
 async detail(s,id,input={}){
  try{id=decodeURIComponent(id)}catch{fail('MEMBER_INPUT_INVALID','记录编号无效')}
  parse(z.object({}).strict(),input);parse(z.string().min(1).max(64).regex(/^[A-Za-z0-9:_-]+$/),id);await this.profiles.authorize(s);
  const result=await this.db.$transaction(async db=>{
   await this.profiles.authorize(s,db);
   const rows=await db.$queryRaw(Prisma.sql`SELECT ${fields} FROM MemberGrowthRecord WHERE ${scope(s)} AND requestId=${id} AND (${growthChange} OR (${levelChange})) LIMIT 1`);
   if(!rows.length)fail('NOT_FOUND','成长记录不存在',404);return expose(rows[0]);
  },{isolationLevel:'RepeatableRead'});
  await this.profiles.authorize(s);return result;
 }
}
