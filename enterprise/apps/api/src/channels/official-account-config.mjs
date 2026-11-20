import {z} from 'zod';
const text=max=>z.string().trim().max(max).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v),'不能包含非换行控制字符');
const url=text(1024).refine(v=>{if(!v)return true;try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password}catch{return false}},'须为 HTTP 或 HTTPS 链接，不能包含账号或密码，可留空');
const appId=z.string().trim().refine(v=>!v||/^wx[a-fA-F0-9]{16}$/.test(v),'须以 wx 开头，后接 16 位十六进制字符，可留空');
const menuLeaf=z.object({name:text(60).min(1),type:z.enum(['view','miniprogram']),url,appId,pagePath:text(1024),children:z.array(z.never()).optional()}).strict().superRefine((v,ctx)=>{
 if(!v.url)ctx.addIssue({code:'custom',path:['url'],message:'请填写网页链接'});
 if(v.type==='miniprogram'){
  if(!v.appId)ctx.addIssue({code:'custom',path:['appId'],message:'请填写小程序 AppID'});
  if(!v.pagePath||/^\w+:|^\/\//.test(v.pagePath))ctx.addIssue({code:'custom',path:['pagePath'],message:'请填写小程序页面路径，不能包含协议或以 // 开头'});
 }
});
const menuParent=z.object({name:text(16).min(1),type:z.enum(['view','miniprogram','group']),url,appId,pagePath:text(1024),children:z.array(menuLeaf).max(5)}).strict().superRefine((v,ctx)=>{
 if(Buffer.byteLength(v.name)>16)ctx.addIssue({code:'custom',path:['name'],message:'一级菜单名称最多 16 字节，中文通常最多 5 个字'});
 if(v.type==='group'){if(!v.children.length)ctx.addIssue({code:'custom',path:['children'],message:'分组菜单至少需要一个子菜单'})}
 else{
  if(v.children.length)ctx.addIssue({code:'custom',path:['children'],message:'非分组菜单不能包含子菜单'});
  const parsed=menuLeaf.safeParse({name:v.name,type:v.type,url:v.url,appId:v.appId,pagePath:v.pagePath});
  if(!parsed.success)for(const issue of parsed.error.issues)ctx.addIssue(issue);
 }
 v.children.forEach((child,index)=>{if(Buffer.byteLength(child.name)>60)ctx.addIssue({code:'custom',path:['children',index,'name'],message:'子菜单名称最多 60 字节，中文通常最多 20 个字'})});
});
export const officialAccountDefaults={enabled:false,displayName:'',accountType:'service',originalId:'',appId:'',qrMaterialId:null,messageEnabled:false,messageMode:'safe',menu:[],templates:[],replies:{welcome:{enabled:false,text:''},fallback:{enabled:false,text:''},keywords:[]}};
export const replyFields={enabled:z.boolean().default(false),type:z.enum(['text','image','video','news','miniprogram']).default('text'),text:text(600).default(''),materialId:z.uuid().nullable().default(null),coverMaterialId:z.uuid().nullable().default(null),title:text(60).default(''),description:text(300).default(''),url,appId,pagePath:text(1024)};
replyFields.url=replyFields.url.default('');replyFields.appId=replyFields.appId.default('');replyFields.pagePath=replyFields.pagePath.default('');
export function replyConfigured(v){return v.type==='text'||!v.type?!!v.text.trim():v.type==='image'||v.type==='video'?!!v.materialId:v.type==='news'?!!v.title&&!!v.url&&!!v.coverMaterialId:!!v.appId&&!!v.title&&!!v.pagePath&&!!v.coverMaterialId}
function replyIssue(v,ctx){
 const required=v.type==='text'?['text']:['image','video'].includes(v.type)?['materialId']:v.type==='news'?['title','url','coverMaterialId']:['appId','title','pagePath','coverMaterialId'];
 const missing=required.find(key=>!v[key]||key==='text'&&!v.text.trim());
 if(missing)ctx.addIssue({code:'custom',path:[missing],message:'此回复类型必须填写该字段'});
}
const reply=z.object(replyFields).strict().superRefine((v,ctx)=>{
 if((v.type==='text'?['text']:v.type==='image'?['materialId']:v.type==='video'?['materialId','title','description']:v.type==='news'?['coverMaterialId','title','description','url']:['coverMaterialId','title','appId','pagePath']).some(k=>!!v[k])&&!replyConfigured(v))replyIssue(v,ctx);
}).transform(v=>({...v,enabled:replyConfigured(v)}));
export function officialMaterialRefs(config){const refs=[];if(config.qrMaterialId)refs.push({id:config.qrMaterialId,kind:'image'});for(const row of [config.replies?.welcome,config.replies?.fallback,...(config.replies?.keywords||[])].filter(Boolean)){if(['image','video'].includes(row.type)&&row.materialId)refs.push({id:row.materialId,kind:row.type==='video'?'video':'image'});if(['news','miniprogram'].includes(row.type)&&row.coverMaterialId)refs.push({id:row.coverMaterialId,kind:'image'})}return refs}

export const officialAccountConfig=z.object({enabled:z.boolean(),displayName:text(32),accountType:z.enum(['service','subscription']),originalId:text(64).refine(v=>!v||/^gh_[a-zA-Z0-9]+$/.test(v),'须以 gh_ 开头，后接英文字母或数字，可留空'),appId,qrMaterialId:z.uuid().nullable(),messageEnabled:z.boolean().default(false),messageMode:z.enum(['plain','compatible','safe']).default('safe'),menu:z.array(menuParent).max(3).default([]),templates:z.array(z.object({id:z.uuid(),name:text(60).min(1),templateId:text(128).min(1).regex(/^[A-Za-z0-9_-]+$/,'只能包含英文字母、数字、下划线或短横线'),enabled:z.boolean(),remark:text(300)}).strict().transform(v=>({...v,enabled:true}))).default([]),replies:z.object({welcome:reply,fallback:reply,keywords:z.array(z.object({...replyFields,id:z.uuid(),name:text(60).min(1),keyword:text(100).min(1),match:z.enum(['exact','contains'])}).strict().superRefine((v,ctx)=>{if(!replyConfigured(v))replyIssue(v,ctx)}).transform(v=>({...v,enabled:true}))).max(100)}).strict().default(()=>structuredClone(officialAccountDefaults.replies))}).strict().superRefine((v,ctx)=>{for(const [path,rows] of [[['templates'],v.templates],[['replies','keywords'],v.replies.keywords]]){const seen=new Set();rows.forEach((row,index)=>{if(seen.has(row.id))ctx.addIssue({code:'custom',path:[...path,index,'id'],message:'记录编号不能重复'});seen.add(row.id)})}const seenRules=new Set();v.replies.keywords.forEach((row,index)=>{if(!row.enabled)return;const key=row.match+':'+row.keyword;if(seenRules.has(key))ctx.addIssue({code:'custom',path:['replies','keywords',index,'keyword'],message:'同一种匹配方式下的关键词不能重复'});seenRules.add(key)})});
export function officialMenuPayload(menu){return{button:menu.map(parent=>parent.type==='group'?{name:parent.name,sub_button:parent.children.map(leaf)}:leaf(parent))}}
function leaf(item){return item.type==='miniprogram'?{name:item.name,type:'miniprogram',url:item.url,appid:item.appId,pagepath:item.pagePath}:{name:item.name,type:'view',url:item.url}}
