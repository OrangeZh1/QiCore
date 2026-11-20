import {fail} from './errors.mjs';

export async function consumerPolicies(db,tenantId,applicationKey){
 const rows=await db.tenantPolicyDocument.findMany({where:{tenantId,applicationKey,currentVersion:{not:null}},select:{kind:true,title:true,currentVersion:true}});
 return rows.filter(row=>['terms','privacy'].includes(row.kind)).map(row=>({kind:row.kind,title:row.title,version:row.currentVersion}));
}
export async function assertConsumerConsent(db,tenantId,applicationKey,consent){
 const policies=await consumerPolicies(db,tenantId,applicationKey);
 if(policies.some(p=>consent?.[p.kind]!==p.version))fail('POLICY_CONSENT_REQUIRED','请阅读并同意本站最新的用户协议和隐私政策',409);
 return policies;
}
