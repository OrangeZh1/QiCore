// Matching follows school-shop's conservative semantics; unknown fields are never guessed.
export function templateFields(adapter,event,template){
 const matches=[...template.content.matchAll(/([^\n{}]+?)\s*[：:]?\s*\{\{\s*((?:thing|phrase|character_string|time)\d+)\.DATA\s*\}\}/g)];
 if(matches.length<2||matches.length>5||matches.length!==(template.content.match(/\{\{/g)||[]).length)return null;
 const fields=[];for(const [,label,key] of matches){const source=adapter.sourceFor(event,label,key.replace(/\d+$/,''));if(!source||fields.some(f=>f.key===key))return null;const restriction=template.keywordEnumValueList?.find(x=>x.keywordCode===key);if(restriction&&(source!=='status'||!Array.isArray(restriction.enumValueList)||!restriction.enumValueList.includes(adapter.statusValue(event))))return null;fields.push({key,source})}
 if(!fields.some(f=>f.source==='status')&&adapter.titleScore(event,template.title)<90)return null;return fields;
}
export async function selectTemplates(transport,token,adapter,{guard=async()=>{},beforeAdd=async()=>{},uncertainTitles=[]}={}){
 const deadline=Date.now()+110000,check=async()=>{if(Date.now()>deadline)throw Error('WECHAT_SELECTION_TIMEOUT');await guard()};
 await check();let privateRows=await transport.templates(token),catalog=null,categories=[];const rows=[],config={},uncertain=new Set(uncertainTitles);
 for(const event of adapter.events){let addingTitle=null;try{
  await check();let selected=privateRows.filter(t=>t.type===2&&adapter.titleScore(event.key,t.title)>0&&templateFields(adapter,event.key,t)).sort((a,b)=>adapter.titleScore(event.key,b.title)-adapter.titleScore(event.key,a.title))[0],added=false;
  if(!selected){
   if(!catalog){await check();categories=await transport.categories(token);catalog=categories.length?await transport.titles(token,categories.map(c=>c.id),check):[]}
   for(const candidate of catalog.filter(t=>t.type===2&&categories.some(c=>c.id===t.categoryId)&&adapter.titleScore(event.key,t.title)>0).sort((a,b)=>adapter.titleScore(event.key,b.title)-adapter.titleScore(event.key,a.title)||a.tid-b.tid)){
    if(uncertain.has(candidate.title))continue;await check();const keywords=await transport.keywords(token,candidate.tid),sources=new Set(),kids=[];
    for(const field of [...keywords].sort((a,b)=>Number(adapter.sourceFor(event.key,b.name,b.rule)==='status')-Number(adapter.sourceFor(event.key,a.name,a.rule)==='status'))){const source=adapter.sourceFor(event.key,field.name,field.rule);if(!source||sources.has(source)||field.rule==='phrase')continue;sources.add(source);kids.push(field.kid);if(kids.length===5)break}
    if(kids.length<2||!sources.has('status')&&adapter.titleScore(event.key,candidate.title)<90)continue;
    await check();await beforeAdd(candidate.title,event.key);addingTitle=candidate.title;uncertain.add(addingTitle);
    const id=await transport.add(token,candidate.tid,kids,event.label);await check();privateRows=await transport.templates(token);selected=privateRows.find(t=>t.priTmplId===id&&t.title===candidate.title&&t.type===2&&templateFields(adapter,event.key,t));if(!selected)throw Error('WECHAT_ADDED_TEMPLATE_UNCONFIRMED');added=true;break;
   }
  }
  if(!selected){rows.push({...event,state:'unmatched',message:uncertain.size?'未找到可确认的模板；存在添加结果未知的模板，请先在微信后台核对，原配置保留。':'当前类目没有可自动匹配的模板，原配置保留。'});continue}
  uncertain.delete(selected.title);config[event.key]={enabled:true,templateId:selected.priTmplId,fields:templateFields(adapter,event.key,selected)};
  rows.push({...event,state:added?'added':'reused',templateId:selected.priTmplId,title:selected.title,message:added?'已选用微信模板并匹配字段':'已复用现有模板并匹配字段'});
 }catch{rows.push({...event,state:addingTitle?'unknown':'failed',message:addingTitle?'模板添加结果未确认，原配置保留；后续获取会先核查现有模板。':'模板读取未完成，原配置保留。'})}}
 return{config,rows,uncertainTitles:[...uncertain]};
}
