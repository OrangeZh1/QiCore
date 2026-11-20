// IDs are scoped by the containing tenant/application record, never used as authorization.
export const defaultCurrentDecorationId='00000000-0000-4000-8000-000000000001';
/** Read-only projection; old inactive schemes become independent personal templates on the next explicit write. */
export function currentDecorationState(row,defaults){
 const records=structuredClone(row?.schemes||[]);
 const schemes=records.filter(r=>r.kind!=='template');
 const current=schemes.find(r=>r.id===row?.activeId)||schemes[0]||{id:defaultCurrentDecorationId,kind:'scheme',name:'当前装修',scheme:structuredClone(defaults),updatedAt:''};
 const convertedIds=[];
 for(const record of records){if(record.kind!=='template'&&record.id!==current.id){record.kind='template';record.legacyScheme=true;convertedIds.push(record.id)}}
 return {current,saved:schemes.length>0,templates:records.filter(r=>r.kind==='template'),records,convertedIds};
}
