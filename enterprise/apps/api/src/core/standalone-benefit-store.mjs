import { fail } from './errors.mjs'

export async function systemBenefitCatalog(db,tenantId,key) {
  const target={tenantId,applicationKey:key}
  const row=await db.standaloneBenefitCatalog.findUnique({where:{tenantId_applicationKey:target}})
  return {config:row?.config||{packages:[]},version:row?.version||1,exists:!!row}
}
export async function saveSystemBenefitCatalog(db,tenantId,key,previous,config) {
  if(!previous.exists){await db.standaloneBenefitCatalog.create({data:{tenantId,applicationKey:key,config,version:previous.version+1}});return}
  const result=await db.standaloneBenefitCatalog.updateMany({where:{tenantId,applicationKey:key,version:previous.version},data:{config,version:{increment:1}}})
  if(!result.count)fail('PACKAGE_CONFLICT','服务套餐已更新，请刷新后重试',409)
}
